import { useState, useEffect, useCallback } from 'react';
import { getTemplates, templateToFiles, buildAndPushProject, getSkills, listTrackedProjects, countTokens, getSystemMetrics, clearKvCache } from '../lib/api';
import { useQwen } from '../hooks/useQwen';
import type { ProjectTemplate, GeneratedFile, QwenLocation, Skill, ProjectRecord, SystemMetrics } from '../types';

interface Props {
  qwenLocation: QwenLocation | null;
  ghLoggedIn: boolean;
  onProjectCreated: () => void;
  activeProjectPath: string | null;
}

const SYSTEM_PROMPT = `You are an expert software engineer and code generator.
When asked to generate project files, respond ONLY with a valid JSON array of file objects.
NO text before the opening bracket, NO text after the closing bracket.
NO markdown code blocks. NO explanations.

Format:
[
  {"path": "src/main.py", "content": "full file content"},
  {"path": "README.md", "content": "# Title\\nDescription..."}
]

CRITICAL RULES:
1. Output MUST start with [ and end with ]
2. Each file object must have exactly two fields: "path" (string) and "content" (string)
3. Escape ALL special JSON characters in content strings
4. Include ALL files needed to run the project
5. Always include a README.md
6. Write complete, working, well-commented code`;

type Step = 'setup' | 'preview' | 'building' | 'done';

export default function BuilderPanel({ qwenLocation, ghLoggedIn, onProjectCreated, activeProjectPath }: Props) {
  const [step, setStep] = useState<Step>('setup');
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [mode, setMode] = useState<'template' | 'freeform'>('template');
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [freeformPrompt, setFreeformPrompt] = useState('');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [pastProjects, setPastProjects] = useState<ProjectRecord[]>([]);
  const [useMemory, setUseMemory] = useState(true);
  const [isPrivate, setIsPrivate] = useState(false);
  const [outputDir, setOutputDir] = useState('D:\\Users\\CASE\\Projects');
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [buildResult, setBuildResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [streamPreview, setStreamPreview] = useState('');
  const [promptTokenCount, setPromptTokenCount] = useState<number>(0);

  // System metrics state
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  // Use useQwen for generate function and tokenProgress, use qwenLocation from props for location
  const { generate, tokenProgress } = useQwen();
  const location = qwenLocation;

  // Load initial data
  useEffect(() => {
    getTemplates().then(setTemplates).catch(console.error);
    getSkills().then(setSkills).catch(console.error);
    listTrackedProjects().then(setPastProjects).catch(console.error);
  }, []);

  // Update project name from path
  useEffect(() => {
    if (activeProjectPath) {
      const parts = activeProjectPath.split(/[/\\]/);
      const name = parts[parts.length - 1];
      const dir = parts.slice(0, -1).join('\\');
      if (name) setProjectName(name);
      if (dir) setOutputDir(dir);
    }
  }, [activeProjectPath]);

  // Token count estimation
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (freeformPrompt) {
        try {
          const result = await countTokens(freeformPrompt);
          setPromptTokenCount(result.count);
        } catch (e) {
          setPromptTokenCount(Math.floor(freeformPrompt.length / 4));
        }
      } else {
        setPromptTokenCount(0);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [freeformPrompt]);

  // Poll system metrics during generation
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    
    if (generating) {
      interval = setInterval(async () => {
        try {
          const metrics = await getSystemMetrics();
          setSystemMetrics(metrics);
        } catch (e) {
          console.error('Failed to get metrics:', e);
        }
      }, 2000);
    }
    
    return () => clearInterval(interval);
  }, [generating]);

  const refreshMetrics = useCallback(async () => {
    setMetricsLoading(true);
    try {
      const metrics = await getSystemMetrics();
      setSystemMetrics(metrics);
    } catch (e) {
      console.error('Failed to get metrics:', e);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  const handleClearCache = useCallback(async () => {
    setClearingCache(true);
    try {
      const result = await clearKvCache();
      alert(result);
      // Refresh metrics after clearing
      setTimeout(refreshMetrics, 1000);
    } catch (e: any) {
      alert(`Failed to clear cache: ${e.message}`);
    } finally {
      setClearingCache(false);
    }
  }, [refreshMetrics]);

  const generateFiles = async () => {
    if (!projectName.trim()) { setError('Project name is required'); return; }
    setError(null);
    setGenerating(true);
    setStreamPreview('');

    try {
      let files: GeneratedFile[] = [];
      const skillPrompts = skills
        .filter(s => selectedSkills.has(s.id))
        .map(s => `[Skill: ${s.name}]\n${s.prompt}`);

      if (mode === 'template' && selectedTemplate) {
        const template = templates.find(t => t.id === selectedTemplate);
        if (!template) throw new Error('Template not found');
        files = await templateToFiles(selectedTemplate, projectName, description);
      } else {
        const fullPrompt = `${freeformPrompt}\n\nProject: ${projectName}\nDescription: ${description}`;
        const combinedSystem = skillPrompts.length > 0
          ? `${SYSTEM_PROMPT}\n\n${skillPrompts.join('\n\n')}`
          : SYSTEM_PROMPT;

        const result = await generate(fullPrompt, combinedSystem, setStreamPreview, null);
        
        // Parse JSON from result
        const jsonMatch = result.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          files = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Model did not return valid JSON. Try enabling JSON Strict Mode or using a larger model.');
        }
      }

      setGeneratedFiles(files);
      setStep('preview');
    } catch (e: any) {
      setError(e.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const buildProject = async () => {
    setError(null);
    setGenerating(true);

    try {
      const result = await buildAndPushProject({
        project_name: projectName,
        description,
        template_id: mode === 'template' ? selectedTemplate : null,
        freeform_prompt: mode === 'freeform' ? freeformPrompt : null,
        generated_files: generatedFiles,
        private_repo: isPrivate,
        output_dir: outputDir,
      });

      setBuildResult({
        success: result.success,
        message: result.message,
        url: result.repo_url || undefined,
      });
      setStep('done');
      onProjectCreated();
    } catch (e: any) {
      setError(e.message || 'Build failed');
    } finally {
      setGenerating(false);
    }
  };

  const resetForm = () => {
    setStep('setup');
    setGeneratedFiles([]);
    setBuildResult(null);
    setStreamPreview('');
  };

  return (
    <div style={{ display: 'grid', gap: '24px' }}>
      {/* System Metrics Bar */}
      <div style={{
        padding: '16px',
        background: 'var(--surface1)',
        borderRadius: '8px',
        border: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)' }}>📊 System Metrics</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={refreshMetrics} disabled={metricsLoading}>
              {metricsLoading ? '...' : '🔄 Refresh'}
            </button>
            <button className="btn btn-secondary" onClick={handleClearCache} disabled={clearingCache}>
              {clearingCache ? '...' : '🧹 Clear Cache to Boost Inference'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <MetricCard label="GPU Utilization" value={`${systemMetrics?.gpu_utilization.toFixed(1) || 0}%`} active={systemMetrics?.inference_active} />
          <MetricCard label="VRAM Usage" value={`${systemMetrics?.vram_used_gb.toFixed(2) || 0} GB`} subtitle={`/ ${systemMetrics?.vram_total_gb.toFixed(1) || 0} GB`} />
          <MetricCard label="CPU Utilization" value={`${systemMetrics?.cpu_utilization.toFixed(1) || 0}%`} />
          <MetricCard label="System RAM" value={`${systemMetrics?.ram_used_gb.toFixed(2) || 0} GB`} subtitle={`/ ${systemMetrics?.ram_total_gb.toFixed(1) || 0} GB`} />
          <MetricCard label="KV Cache Size" value={`${(systemMetrics?.kv_cache_size_mb || 0).toFixed(0)} MB`} highlight={!!systemMetrics?.kv_cache_size_mb} />
          <MetricCard label="Active Model" value={systemMetrics?.model_name || 'None'} subtitle={systemMetrics?.inference_active ? '🟢 Loaded' : '⚪ Unloaded'} />
        </div>
      </div>

      {/* Model Status */}
      <div style={{
        padding: '16px',
        background: 'var(--surface1)',
        borderRadius: '8px',
        border: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)' }}>🤖 Ollama Model Status</h3>
        </div>

        <div style={{ 
          padding: '16px',
          background: location?.found ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          borderRadius: '8px',
          border: `2px solid ${location?.found ? 'var(--green)' : 'var(--red)'}`,
        }}>
          <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '8px' }}>
            {location?.found ? '✅ Ollama Model Detected' : '⚠️ No Ollama Model Found'}
          </div>
          {location?.found ? (
            <div style={{ fontSize: '14px', color: 'var(--text)' }}>
              <div><strong>Model:</strong> {location.model || 'Using default'}</div>
              <div><strong>Platform:</strong> Ollama</div>
              <div style={{ marginTop: '8px', color: 'var(--green)', fontSize: '13px' }}>
                ✓ Ready to generate projects with AI
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '14px', color: 'var(--text)' }}>
              <div style={{ marginBottom: '8px' }}>
                Install Ollama and pull any model (Qwen recommended for coding):
              </div>
              <code style={{ 
                display: 'block', 
                padding: '12px', 
                background: 'var(--surface2)',
                borderRadius: '6px',
                fontFamily: 'monospace',
                fontSize: '13px',
              }}>
                # Install: winget install Ollama.Ollama{"\n"}
                # Recommended for coding: ollama pull qwen2.5-coder:7b{"\n"}
                # Other options: ollama pull llama3.2{"\n"}
                #              ollama pull mistral{"\n"}
                #              ollama pull gemma2
              </code>
            </div>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid var(--red)',
          borderRadius: '6px',
          color: 'var(--red)',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Success Display */}
      {buildResult && (
        <div style={{
          padding: '16px',
          background: 'rgba(34, 197, 94, 0.1)',
          border: '1px solid var(--green)',
          borderRadius: '6px',
        }}>
          <div style={{ color: 'var(--green)', marginBottom: '8px', fontWeight: 'bold' }}>
            ✅ {buildResult.message}
          </div>
          {buildResult.url && (
            <a
              href={buildResult.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
              style={{ display: 'inline-block' }}
            >
              🚀 Open on GitHub
            </a>
          )}
          <button className="btn btn-secondary" onClick={resetForm} style={{ marginLeft: '12px' }}>
            📝 Create Another Project
          </button>
        </div>
      )}

      {/* Step Indicator */}
      {step === 'setup' && (
        <>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`btn ${mode === 'template' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('template')}
            >
              📋 From Template
            </button>
            <button
              className={`btn ${mode === 'freeform' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('freeform')}
            >
              🤖 AI Freeform
            </button>
          </div>

          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g., cnc.woodwork"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Autonomous CNC Woodworking Fabrication System"
                style={inputStyle}
              />
            </div>

            {mode === 'freeform' && (
              <div>
                <label style={labelStyle}>Describe what you want built</label>
                <textarea
                  value={freeformPrompt}
                  onChange={(e) => setFreeformPrompt(e.target.value)}
                  placeholder="Describe your project in detail..."
                  rows={12}
                  style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '13px' }}
                />
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  📝 Prompt tokens: ~{promptTokenCount}
                </div>
              </div>
            )}

            {mode === 'template' && (
              <div>
                <label style={labelStyle}>Select Template</label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => setSelectedTemplate(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Choose a template...</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} - {t.description}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label style={labelStyle}>Skills & Memory</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                {skills.map(skill => (
                  <label key={skill.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    background: selectedSkills.has(skill.id) ? 'var(--primary)' : 'var(--surface2)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}>
                    <input
                      type="checkbox"
                      checked={selectedSkills.has(skill.id)}
                      onChange={(e) => {
                        const newSkills = new Set(selectedSkills);
                        if (e.target.checked) {
                          newSkills.add(skill.id);
                        } else {
                          newSkills.delete(skill.id);
                        }
                        setSelectedSkills(newSkills);
                      }}
                    />
                    <span style={{ fontSize: '13px' }}>{skill.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={useMemory}
                  onChange={(e) => setUseMemory(e.target.checked)}
                />
                Use Memory
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                Private Repo
              </label>
              <div style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-muted)' }}>
                Output: {outputDir}
              </div>
            </div>

            <button
              className="btn btn-primary"
              onClick={generateFiles}
              disabled={generating || !projectName.trim()}
              style={{ padding: '16px 32px', fontSize: '16px' }}
            >
              {generating ? '⏳ Generating...' : '✨ Generate Project'}
            </button>
          </div>
        </>
      )}

      {/* Preview Step */}
      {step === 'preview' && (
        <div style={{ display: 'grid', gap: '16px' }}>
          <h3>📁 Generated Files Preview</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: '16px', minHeight: '400px' }}>
            {/* File List */}
            <div style={{
              background: 'var(--surface1)',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              overflow: 'hidden',
            }}>
              <div style={{ padding: '12px', borderBottom: '1px solid var(--border)', fontWeight: 'bold' }}>
                Files ({generatedFiles.length})
              </div>
              <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                {generatedFiles.map((file, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedFile(file.path)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: selectedFile === file.path ? 'var(--primary)' : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--text)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    {getFileIcon(file.path)} {file.path}
                  </button>
                ))}
              </div>
            </div>

            {/* File Content */}
            <div style={{
              background: 'var(--surface1)',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              overflow: 'hidden',
            }}>
              <div style={{ padding: '12px', borderBottom: '1px solid var(--border)', fontWeight: 'bold' }}>
                {selectedFile || 'Select a file'}
              </div>
              <pre style={{
                padding: '16px',
                margin: 0,
                overflow: 'auto',
                fontSize: '12px',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                maxHeight: '500px',
              }}>
                {generatedFiles.find(f => f.path === selectedFile)?.content || 'Select a file to preview'}
              </pre>
            </div>
          </div>

          {/* Stream Preview */}
          {streamPreview && (
            <div style={{
              padding: '12px',
              background: 'var(--surface1)',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              maxHeight: '200px',
              overflow: 'auto',
              fontSize: '12px',
              fontFamily: 'monospace',
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                📡 Generation Stream ({tokenProgress?.tokens || 0} tokens, {tokenProgress?.elapsed.toFixed(1)}s)
              </div>
              {streamPreview}
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" onClick={resetForm} disabled={generating}>
              ← Back
            </button>
            <button
              className="btn btn-primary"
              onClick={buildProject}
              disabled={generating}
              style={{ padding: '16px 32px' }}
            >
              {generating ? '⏳ Building & Pushing...' : '🚀 Build & Push to GitHub'}
            </button>
          </div>
        </div>
      )}

      {/* Building Step */}
      {step === 'building' && (
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <h2>Building and pushing to GitHub...</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Files are being committed and pushed to your new repository
          </p>
        </div>
      )}
    </div>
  );
}

// Metric Card Component
function MetricCard({ label, value, subtitle, active, highlight }: {
  label: string;
  value: string | number;
  subtitle?: string;
  active?: boolean;
  highlight?: boolean;
}) {
  return (
    <div style={{
      padding: '12px',
      background: active ? 'rgba(34, 197, 94, 0.1)' : highlight ? 'rgba(59, 130, 246, 0.1)' : 'var(--surface2)',
      borderRadius: '6px',
      border: active ? '1px solid var(--green)' : highlight ? '1px solid var(--blue)' : '1px solid var(--border)',
    }}>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: '18px', fontWeight: 'bold', color: active ? 'var(--green)' : highlight ? 'var(--blue)' : 'var(--text)' }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function getFileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const icons: Record<string, string> = {
    ts: '📘', tsx: '📘', js: '📗', jsx: '📗', py: '🐍', rs: '🦀',
    md: '📝', json: '📋', yaml: '📋', yml: '📋', html: '🌐', css: '🎨',
  };
  return icons[ext || ''] || '📄';
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '13px',
  fontWeight: '500',
  color: 'var(--text)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text)',
  fontSize: '14px',
  boxSizing: 'border-box',
};

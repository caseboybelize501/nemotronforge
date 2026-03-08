import { useState, useEffect, useRef } from 'react';
import { getTemplates, templateToFiles, buildAndPushProject, listTrackedProjects, countTokens, getSystemMetrics, saveGithubToken, getGithubTokenStatus, clearGithubToken, getGithubUserInfo } from '../lib/api';
import { useModel } from '../hooks/useModel';
import { parseModelJSON } from '../lib/jsonCleaner';
import type { ProjectTemplate, GeneratedFile, ModelLocation, ProjectRecord, SystemMetrics, GithubUserInfo } from '../types';

// Hardcoded model - NO switching
const HARD_CODED_MODEL = 'qwen3-coder:30b';

interface Props {
  modelLocation: ModelLocation | null;
  onGithubTokenSaved?: (token: string) => void;
  onProjectCreated: () => void;
  activeProjectPath: string | null;
}

/**
 * SYSTEM PROMPT - removed
 */
const SYSTEM_PROMPT = '';

export default function BuilderPanel({ modelLocation, onProjectCreated, activeProjectPath }: Props) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [mode, setMode] = useState<'template' | 'freeform'>('template');
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [freeformPrompt, setFreeformPrompt] = useState('');
  const [pastProjects, setPastProjects] = useState<ProjectRecord[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [outputDir, setOutputDir] = useState('D:\\Users\\CASE\\Projects');
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [buildResult, setBuildResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [building, setBuilding] = useState(false);
  const [rawOutput, setRawOutput] = useState<string | null>(null);
  const [promptTokenCount, setPromptTokenCount] = useState<number>(0);
  const [generationStartTime, setGenerationStartTime] = useState<number>(0);
  const [exportMode, setExportMode] = useState<'local' | 'github'>('github');
  const [githubToken, setGithubToken] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [ghLoggedIn, setGhLoggedIn] = useState(false);
  const [githubUser, setGithubUser] = useState<GithubUserInfo | null>(null);

  // Check GitHub token status and fetch user info on mount
  useEffect(() => {
    const checkAuth = async () => {
      const isLoggedIn = await getGithubTokenStatus().catch(() => false);
      setGhLoggedIn(isLoggedIn);
      if (isLoggedIn) {
        const userInfo = await getGithubUserInfo().catch(console.error);
        if (userInfo) {
          setGithubUser(userInfo);
        }
      }
    };
    checkAuth();
  }, []);

  // Use useModel for generate function
  const { generate, streamedText, charCount, tokenCount, tokensPerSec, elapsedSec } = useModel();
  const location = modelLocation;

  // Detailed runtime metrics state
  const [runtimeMetrics, setRuntimeMetrics] = useState<SystemMetrics | null>(null);

  // Poll runtime metrics during generation only (every 3 seconds)
  useEffect(() => {
    if (!generating) {
      setRuntimeMetrics(null);
      return;
    }

    const pollMetrics = async () => {
      try {
        const metrics = await getSystemMetrics();
        setRuntimeMetrics(metrics);
      } catch (e) {
        console.error('Failed to get runtime metrics:', e);
      }
    };

    pollMetrics();
    const interval = setInterval(pollMetrics, 3000);
    return () => clearInterval(interval);
  }, [generating]);

  // Load initial data
  useEffect(() => {
    getTemplates().then(setTemplates).catch(console.error);
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

  const generateFiles = async () => {
    if (!projectName.trim()) { setError('Project name is required'); return; }

    setError(null);
    setGenerating(true);
    setRawOutput(null);
    setBuildResult(null);
    setGeneratedFiles([]);
    setSelectedFile(null);
    setGenerationStartTime(Date.now());

    try {
      let files: GeneratedFile[] = [];

      if (mode === 'template' && selectedTemplate) {
        const template = templates.find(t => t.id === selectedTemplate);
        if (!template) throw new Error('Template not found');
        files = await templateToFiles(selectedTemplate, projectName, description);
      } else {
        const fullPrompt = `${freeformPrompt}\n\nProject: ${projectName}\nDescription: ${description}`;

        const result = await generate(fullPrompt, SYSTEM_PROMPT, undefined, null);
        setRawOutput(result);

        try {
          files = parseModelJSON(result);
        } catch (parseError: any) {
          console.error('JSON Parse Error:', parseError);
          throw parseError;
        }
      }

      setGeneratedFiles(files);
      setGenerating(false);

      console.log('[BuilderPanel] Generation complete! Files:', files.length);

      // Auto-select first file for preview
      if (files.length > 0) {
        setSelectedFile(files[0].path);
      }

      // Scroll to the generated output section
      setTimeout(() => {
        const outputSection = document.getElementById('generated-output-section');
        if (outputSection) {
          outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 150);
    } catch (e: any) {
      console.error('Generation error:', e);
      setError(e.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const buildProject = async () => {
    setError(null);
    setBuilding(true);

    // Validate generated files exist
    if (!generatedFiles || generatedFiles.length === 0) {
      setError('No files generated. Please generate project files first.');
      setBuilding(false);
      return;
    }

    // Check if GitHub token is set (required for push)
    if (!ghLoggedIn) {
      setError('GitHub token not set. Please save your GitHub token in settings above.');
      setShowTokenInput(true);
      setBuilding(false);
      return;
    }

    try {
      // Always push to GitHub AND save locally
      const result = await buildAndPushProject({
        project_name: projectName,
        description,
        template_id: mode === 'template' ? selectedTemplate : null,
        freeform_prompt: mode === 'freeform' ? freeformPrompt : null,
        generated_files: generatedFiles,
        private_repo: isPrivate,
        output_dir: outputDir,
        push_to_github: true,  // Always push to GitHub
      });

      setBuildResult({
        success: result.success,
        message: result.message,
        url: result.repo_url || undefined,
      });
      onProjectCreated();
    } catch (e: any) {
      console.error('Build error:', e);
      setError(typeof e === 'string' ? e : (e?.message || 'Build failed'));
    } finally {
      setBuilding(false);
    }
  };

  const resetForm = () => {
    setGeneratedFiles([]);
    setBuildResult(null);
    setRawOutput(null);
    setBuilding(false);
    setError(null);
    setSelectedFile(null);
  };

  const handleSaveGithubToken = async () => {
    if (!githubToken.trim()) {
      setError('GitHub token cannot be empty');
      return;
    }
    try {
      await saveGithubToken(githubToken);
      const userInfo = await getGithubUserInfo().catch(console.error);
      if (userInfo) {
        setGithubUser(userInfo);
        setGhLoggedIn(true);
        setShowTokenInput(false);
        setGithubToken('');
        setError(null);
      }
    } catch (e: any) {
      setError('Failed to save GitHub token: ' + (e.message || 'Unknown error'));
    }
  };

  const handleClearGithubToken = async () => {
    try {
      await clearGithubToken();
      setGhLoggedIn(false);
      setGithubUser(null);
      setError(null);
    } catch (e: any) {
      setError('Failed to clear GitHub token: ' + (e.message || 'Unknown error'));
    }
  };

  const [showRawOutput, setShowRawOutput] = useState(false);

  // Derived state: has generated code ready
  const hasGeneratedCode = generatedFiles.length > 0 && !generating;

  return (
    <div style={{ display: 'grid', gap: '24px' }}>
      {/* Error Display */}
      {error && (
        <div style={{
          padding: '16px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid var(--red)',
          borderRadius: '8px',
          color: 'var(--red)',
        }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
            ⚠️ {error.split('\n')[0]}
          </div>
          <div style={{
            fontSize: '13px',
            whiteSpace: 'pre-wrap',
            background: 'rgba(0,0,0,0.2)',
            padding: '12px',
            borderRadius: '6px',
            marginTop: '8px',
            maxHeight: '200px',
            overflow: 'auto',
            fontFamily: 'monospace',
          }}>
            {error.split('\n').slice(1).join('\n')}
          </div>
          {rawOutput && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowRawOutput(true)}
                style={{ padding: '8px 16px', fontSize: '13px' }}
              >
                📄 View Raw Model Output
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  navigator.clipboard.writeText(rawOutput);
                }}
                style={{ padding: '8px 16px', fontSize: '13px' }}
              >
                📋 Copy Raw Output
              </button>
            </div>
          )}
        </div>
      )}

      {/* Raw Output Modal */}
      {showRawOutput && rawOutput && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
        }}>
          <div style={{
            background: 'var(--surface1)',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '900px',
            width: '100%',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>📄 Raw Model Output</h3>
              <button
                className="btn btn-secondary"
                onClick={() => setShowRawOutput(false)}
                style={{ padding: '6px 12px' }}
              >
                ✕ Close
              </button>
            </div>
            <div style={{
              flex: 1,
              overflow: 'auto',
              background: 'var(--surface2)',
              borderRadius: '8px',
              padding: '16px',
              fontFamily: 'Consolas, Monaco, monospace',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {rawOutput}
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  navigator.clipboard.writeText(rawOutput);
                }}
                style={{ padding: '8px 16px' }}
              >
                📋 Copy to Clipboard
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  const blob = new Blob([rawOutput], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `raw-output-${Date.now()}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{ padding: '8px 16px' }}
              >
                💾 Download as TXT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Display */}
      {buildResult && (
        <div style={{
          padding: '20px',
          background: buildResult.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: `2px solid ${buildResult.success ? 'var(--green)' : 'var(--red)'}`,
          borderRadius: '10px',
        }}>
          <div style={{ color: buildResult.success ? 'var(--green)' : 'var(--red)', marginBottom: '12px', fontWeight: 'bold', fontSize: '18px' }}>
            {buildResult.success ? '✅' : '❌'} {buildResult.message}
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {buildResult.url && (
              <a
                href={buildResult.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ display: 'inline-block', padding: '10px 20px' }}
              >
                🚀 Open on GitHub
              </a>
            )}
            <button className="btn btn-secondary" onClick={resetForm} style={{ padding: '10px 20px' }}>
              📝 Create Another Project
            </button>
          </div>
        </div>
      )}

      {/* GitHub Token Section */}
      {!ghLoggedIn && (
        <div style={{
          padding: '16px',
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid var(--blue)',
          borderRadius: '8px',
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: 'var(--blue)' }}>🔑 GitHub Authentication Required</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Enter your GitHub Personal Access Token (PAT) to push projects to GitHub.
          </p>
          <input
            type="password"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder="ghp_..."
            style={{ ...inputStyle, fontFamily: 'monospace', marginBottom: '12px' }}
          />
          <button className="btn btn-primary" onClick={handleSaveGithubToken} disabled={!githubToken.trim()}>
            Save GitHub Token
          </button>
        </div>
      )}

      {ghLoggedIn && githubUser && (
        <div style={{
          padding: '12px',
          background: 'rgba(34, 197, 94, 0.1)',
          border: '1px solid var(--green)',
          borderRadius: '8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ fontSize: '14px', color: 'var(--green)' }}>
            ✅ Logged in as <strong>@{githubUser.login}</strong>
          </div>
          <button className="btn btn-secondary" onClick={handleClearGithubToken} style={{ padding: '6px 12px', fontSize: '13px' }}>
            Logout
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1: PROJECT SETUP (always visible when not building)
          ═══════════════════════════════════════════════════════════════════════ */}
      {!building && !buildResult && (
        <>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`btn ${mode === 'template' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('template')}
              disabled={generating}
            >
              📋 From Template
            </button>
            <button
              className={`btn ${mode === 'freeform' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('freeform')}
              disabled={generating}
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
                disabled={generating}
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
                disabled={generating}
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
                  disabled={generating}
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
                  disabled={generating}
                >
                  <option value="">Choose a template...</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} - {t.description}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  disabled={generating}
                />
                Private Repo
              </label>
              <div style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-muted)' }}>
                Output: {outputDir}
              </div>
            </div>

            {/* Generate Button */}
            <button
              className="btn btn-primary"
              onClick={generateFiles}
              disabled={generating || !projectName.trim()}
              style={{ padding: '16px 32px', fontSize: '16px' }}
            >
              {generating ? '⏳ Generating...' : hasGeneratedCode ? '🔄 Regenerate Project' : '✨ Generate Project'}
            </button>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 2: GENERATION PROGRESS (inline, during active generation)
          ═══════════════════════════════════════════════════════════════════════ */}
      {generating && (() => {
        // Performance ceiling ranges by model size (tok/s)
        const getExpectedRange = (model: string): [number, number, string] => {
          const m = model.toLowerCase();
          if (m.includes('70b')) return [30, 50, '70B'];
          if (m.includes('35b') || m.includes('32b') || m.includes('30b')) return [70, 100, '35B'];
          if (m.includes('14b')) return [80, 140, '14B'];
          if (m.includes('9b')) return [120, 200, '9B'];
          if (m.includes('7b')) return [180, 300, '7B'];
          return [80, 200, '?'];
        };
        const [expectedLow, expectedHigh, modelSizeLabel] = getExpectedRange(HARD_CODED_MODEL);

        // GPU load interpretation
        const getGpuInterpretation = (metrics: SystemMetrics | null): { label: string; color: string; emoji: string } => {
          if (!metrics) return { label: 'Waiting for metrics...', color: 'var(--text-muted)', emoji: '⏳' };
          const powerRatio = (metrics.gpu_power_limit_w ?? 0) > 0
            ? (metrics.gpu_power_w ?? 0) / (metrics.gpu_power_limit_w ?? 1)
            : 0;
          if (powerRatio > 0.5) return { label: `Active inference (${(powerRatio * 100).toFixed(0)}% TDP)`, color: 'var(--green)', emoji: '🟢' };
          if (powerRatio > 0.15) return { label: `Moderate GPU load (${(powerRatio * 100).toFixed(0)}% TDP)`, color: '#f59e0b', emoji: '🟡' };
          if (metrics.inference_active) return { label: 'Low GPU load — model may be CPU-bound', color: '#f59e0b', emoji: '🟠' };
          return { label: 'GPU idle', color: 'var(--text-muted)', emoji: '⚪' };
        };

        return (
          <div data-generating-panel style={{
            padding: '20px',
            background: 'rgba(59, 130, 246, 0.05)',
            borderRadius: '12px',
            border: '2px solid var(--blue)',
          }}>
            {/* GPU Identity Header */}
            <div style={{ fontWeight: 'bold', marginBottom: '16px', fontSize: '16px', color: 'var(--blue)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>CODE PROD. IN PROGRESS </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {runtimeMetrics?.gpu_name && (
                  <span style={{ fontSize: '12px', padding: '3px 8px', background: 'rgba(139, 92, 246, 0.15)', borderRadius: '4px', color: '#a78bfa' }}>
                    🎮 {runtimeMetrics.gpu_name}
                  </span>
                )}
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Model: {HARD_CODED_MODEL}
                </span>
              </div>
            </div>

            {/* Primary Metrics Row */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', fontSize: '13px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ padding: '4px 10px', background: 'var(--primary)', borderRadius: '4px' }}>
                📝 <strong>{charCount.toLocaleString()}</strong> chars
              </span>
              <span style={{ padding: '4px 10px', background: 'var(--primary)', borderRadius: '4px' }}>
                🎯 <strong>{tokenCount.toLocaleString()}</strong> tokens
              </span>
              <span style={{ padding: '4px 10px', background: 'var(--primary)', borderRadius: '4px', minWidth: '100px' }}>
                ⚡ <strong style={{ minWidth: '60px', display: 'inline-block' }}>{tokensPerSec.toLocaleString()}</strong> tok/s
              </span>
              <span style={{ padding: '4px 10px', background: 'var(--surface2)', borderRadius: '4px' }}>
                ⏱️ <strong>{Math.floor(elapsedSec / 60)}:{(elapsedSec % 60).toString().padStart(2, '0')}</strong> elapsed
              </span>
              {/* Performance Ceiling Indicator */}
              <span style={{
                padding: '4px 10px',
                background: tokensPerSec >= expectedLow ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                borderRadius: '4px',
                border: `1px solid ${tokensPerSec >= expectedLow ? 'var(--green)' : '#f59e0b'}`,
              }}>
                📊 {modelSizeLabel}: <strong>{tokensPerSec}</strong>/{expectedLow}-{expectedHigh} tok/s
                <span style={{ marginLeft: '4px' }}>{tokensPerSec >= expectedLow ? '✅' : '⚠️'}</span>
              </span>
            </div>

            {/* Model Configuration Panel */}
            {runtimeMetrics && (
              <div style={{
                marginBottom: '12px',
                padding: '10px 14px',
                background: 'var(--surface1)',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                display: 'flex',
                gap: '16px',
                flexWrap: 'wrap',
                fontSize: '12px',
                alignItems: 'center',
              }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  🏷️ <strong>{runtimeMetrics.model_name || HARD_CODED_MODEL}</strong>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  🧠 Layers: <strong>{runtimeMetrics.gpu_layers_current}/{runtimeMetrics.gpu_layers_total} GPU</strong>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  📦 Batch: <strong>{runtimeMetrics.batch_size}</strong>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  📐 Context: <strong>64K</strong>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  💾 KV Cache: <strong>{(runtimeMetrics.kv_cache_used_mb ?? 0).toFixed(0)} MB</strong>
                </span>
                {(runtimeMetrics.gpu_fan_speed_pct ?? 0) > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    🌀 Fan: <strong>{(runtimeMetrics.gpu_fan_speed_pct ?? 0).toFixed(0)}%</strong>
                  </span>
                )}
              </div>
            )}

            {/* NVIDIA GPU Statistics Table */}
            {runtimeMetrics && (
              <div style={{
                marginBottom: '12px',
                padding: '14px',
                background: 'var(--surface1)',
                borderRadius: '8px',
                border: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span>🎮 {runtimeMetrics.gpu_name || 'NVIDIA'} — GPU Statistics</span>
                  {/* GPU Utilization Interpretation Badge */}
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    background: getGpuInterpretation(runtimeMetrics).color === 'var(--green)' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                    color: getGpuInterpretation(runtimeMetrics).color === 'var(--green)' ? 'var(--green)' : '#f59e0b',
                    border: `1px solid ${getGpuInterpretation(runtimeMetrics).color === 'var(--green)' ? 'var(--green)' : '#f59e0b'}`,
                  }}>
                    {getGpuInterpretation(runtimeMetrics).emoji} {getGpuInterpretation(runtimeMetrics).label}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', fontSize: '12px' }}>
                  {/* GPU Core Clock */}
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>GPU Clock</div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{(runtimeMetrics.gpu_core_clock_mhz ?? 0).toFixed(0)} MHz</div>
                  </div>
                  {/* GPU Power with TDP bar */}
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>GPU Power</div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{(runtimeMetrics.gpu_power_w ?? 0).toFixed(0)}W
                      {(runtimeMetrics.gpu_power_limit_w ?? 0) > 0 && (
                        <span style={{ fontSize: '10px', fontWeight: 'normal', color: 'var(--text-muted)' }}> / {(runtimeMetrics.gpu_power_limit_w ?? 0).toFixed(0)}W</span>
                      )}
                    </div>
                    {(runtimeMetrics.gpu_power_limit_w ?? 0) > 0 && (
                      <div style={{ marginTop: '4px', height: '4px', background: 'var(--surface2)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min(100, ((runtimeMetrics.gpu_power_w ?? 0) / (runtimeMetrics.gpu_power_limit_w ?? 1)) * 100)}%`,
                          background: ((runtimeMetrics.gpu_power_w ?? 0) / (runtimeMetrics.gpu_power_limit_w ?? 1)) > 0.8 ? '#ef4444' : 'var(--blue)',
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                    )}
                  </div>
                  {/* GPU Temperature */}
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>GPU Temperature</div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: (runtimeMetrics.gpu_temp_c ?? 0) > 80 ? '#ef4444' : (runtimeMetrics.gpu_temp_c ?? 0) > 65 ? '#f59e0b' : 'var(--text)' }}>
                      {(runtimeMetrics.gpu_temp_c ?? 0).toFixed(0)} °C
                    </div>
                  </div>
                  {/* GPU Memory Clock */}
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{(runtimeMetrics.gpu_mem_clock_mhz ?? 0).toFixed(0)} MHz</div>
                  </div>
                  {/* GPU Utilization */}
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>GPU Utilization</div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: runtimeMetrics.gpu_utilization > 70 ? 'var(--green)' : runtimeMetrics.gpu_utilization > 40 ? '#f59e0b' : '#ef4444' }}>
                      {runtimeMetrics.gpu_utilization.toFixed(0)} %
                    </div>
                  </div>
                  {/* VRAM with bar */}
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                      {(runtimeMetrics.vram_used_gb ?? 0).toFixed(1)}
                      <span style={{ fontSize: '10px', fontWeight: 'normal', color: 'var(--text-muted)' }}> / {(runtimeMetrics.vram_total_gb ?? 0).toFixed(0)} GB</span>
                    </div>
                    {(runtimeMetrics.vram_total_gb ?? 0) > 0 && (
                      <div style={{ marginTop: '4px', height: '4px', background: 'var(--surface2)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min(100, ((runtimeMetrics.vram_used_gb ?? 0) / (runtimeMetrics.vram_total_gb ?? 1)) * 100)}%`,
                          background: ((runtimeMetrics.vram_used_gb ?? 0) / (runtimeMetrics.vram_total_gb ?? 1)) > 0.85 ? '#ef4444' : 'var(--green)',
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                    )}
                  </div>
                  {/* CPU Utilization */}
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{runtimeMetrics.cpu_utilization.toFixed(0)} %</div>
                  </div>
                  {/* GPU Fan Speed */}
                  {(runtimeMetrics.gpu_fan_speed_pct ?? 0) > 0 && (
                    <div>
                      <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>GPU Fan</div>
                      <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{(runtimeMetrics.gpu_fan_speed_pct ?? 0).toFixed(0)} %</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* RAM and Swap Usage */}
            {runtimeMetrics && (
              <div style={{
                marginBottom: '12px',
                padding: '14px',
                background: 'var(--surface1)',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                display: 'grid',
                gridTemplateColumns: (runtimeMetrics.swap_total_gb ?? 0) > 0 ? '1fr 1fr' : '1fr',
                gap: '16px',
              }}>
                {/* System RAM */}
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '6px', fontSize: '12px' }}>System RAM</div>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '4px' }}>
                    {(runtimeMetrics.ram_used_gb ?? 0).toFixed(1)} / {(runtimeMetrics.ram_total_gb ?? 0).toFixed(0)} GB
                    <span style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--text-muted)', marginLeft: '8px' }}>
                      ({((runtimeMetrics.ram_used_gb ?? 0) / (runtimeMetrics.ram_total_gb ?? 1) * 100).toFixed(0)}%)
                    </span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--surface2)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, ((runtimeMetrics.ram_used_gb ?? 0) / (runtimeMetrics.ram_total_gb ?? 1)) * 100)}%`,
                      background: ((runtimeMetrics.ram_used_gb ?? 0) / (runtimeMetrics.ram_total_gb ?? 1)) > 0.85 ? '#ef4444' : 'var(--blue)',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>

                {/* Swap Usage */}
                {(runtimeMetrics.swap_total_gb ?? 0) > 0 && (
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: '6px', fontSize: '12px' }}>Swap</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '4px', color: (runtimeMetrics.swap_used_gb ?? 0) > 1 ? '#f59e0b' : 'var(--text)' }}>
                      {(runtimeMetrics.swap_used_gb ?? 0).toFixed(1)} / {(runtimeMetrics.swap_total_gb ?? 0).toFixed(0)} GB
                    </div>
                    <div style={{ height: '6px', background: 'var(--surface2)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, ((runtimeMetrics.swap_used_gb ?? 0) / (runtimeMetrics.swap_total_gb ?? 1)) * 100)}%`,
                        background: (runtimeMetrics.swap_used_gb ?? 0) > 1 ? '#f59e0b' : 'var(--green)',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Secondary Metrics Row */}
            {runtimeMetrics && (
              <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                <span>
                  ⚙️ Core: <strong>{(runtimeMetrics.gpu_core_clock_mhz ?? 0).toFixed(0)} MHz</strong>
                </span>
                <span>
                  📊 Mem: <strong>{(runtimeMetrics.gpu_mem_clock_mhz ?? 0).toFixed(0)} MHz</strong>
                </span>
                <span>
                  🧠 Layers: <strong>{runtimeMetrics.gpu_layers_current ?? 0}/{runtimeMetrics.gpu_layers_total ?? 0}</strong>
                </span>
                <span>
                  📝 Seq: <strong>{runtimeMetrics.seq_len ?? 0}</strong>
                </span>
                <span>
                  🗂️ Proc Mem: <strong>{(runtimeMetrics.process_memory_mb ?? 0).toFixed(0)}MB</strong>
                </span>
                {(runtimeMetrics.vram_free_gb ?? 0) > 0 && (
                  <span>
                    🆓 VRAM Free: <strong>{(runtimeMetrics.vram_free_gb ?? 0).toFixed(1)} GB</strong>
                  </span>
                )}
              </div>
            )}

            {/* CPU Per-Core Utilization */}
            {runtimeMetrics && (runtimeMetrics.cpu_per_core ?? []).length > 0 && (
              <div style={{
                marginTop: '12px',
                padding: '12px',
                background: 'var(--surface2)',
                borderRadius: '6px',
              }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  💻 CPU Cores ({runtimeMetrics.cpu_utilization.toFixed(0)}% total):
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: '2px' }}>
                  {(runtimeMetrics.cpu_per_core ?? []).slice(0, 16).map((core, i) => (
                    <div
                      key={i}
                      title={`Core ${i}: ${core.toFixed(0)}%`}
                      style={{
                        height: '20px',
                        background: core > 70 ? 'var(--green)' : core > 30 ? '#f59e0b' : 'var(--surface1)',
                        borderRadius: '2px',
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 3: GENERATED OUTPUT (file preview + build)
          ═══════════════════════════════════════════════════════════════════════ */}
      {hasGeneratedCode && !building && (
        <div id="generated-output-section" style={{ display: 'grid', gap: '16px' }}>
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

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setGeneratedFiles([]);
                setSelectedFile(null);
              }}
              disabled={building}
            >
              ← Regenerate
            </button>
            <button
              className="btn btn-primary"
              onClick={buildProject}
              disabled={building || !ghLoggedIn}
              style={{ padding: '16px 32px' }}
            >
              {building ? '⏳ Building & Pushing...' : '🚀 Build & Push to GitHub'}
            </button>
          </div>
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

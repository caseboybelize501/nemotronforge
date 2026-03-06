import { useState, useEffect } from 'react';
import { getTemplates, templateToFiles, buildAndPushProject, getSkills, readFileContent, listTrackedProjects, countTokens } from '../lib/api';
import { useQwen } from '../hooks/useQwen';
import type { ProjectTemplate, GeneratedFile, QwenLocation, Skill, ProjectRecord } from '../types';

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
  
  const { generate, tokenProgress } = useQwen();

  useEffect(() => {
    getTemplates().then(setTemplates).catch(console.error);
    getSkills().then(setSkills).catch(console.error);
    listTrackedProjects().then(setPastProjects).catch(console.error);
  }, []);

  useEffect(() => {
    if (activeProjectPath) {
      const parts = activeProjectPath.split(/[/\\]/);
      const name = parts[parts.length - 1];
      const dir = parts.slice(0, -1).join('\\');
      if (name) setProjectName(name);
      if (dir) setOutputDir(dir);
    }
  }, [activeProjectPath]);

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
    setStreamPreview('');

    try {
      let files: GeneratedFile[] = [];
      const skillPrompts = skills
        .filter(s => selectedSkills.has(s.id))
        .map(s => `[Skill: ${s.name}]\\n${s.prompt}`)
        .join('\\n\\n');

      let memoryPrompt = '';
      if (useMemory && pastProjects.length > 0) {
        memoryPrompt = `\\n\\nPast Projects Context:\\n` +
          pastProjects.slice(0, 15).map(p => `- ${p.name} (Tech: ${p.tech_stack.join(', ')})`).join('\\n');
      }

      const enhancedSystemPrompt = skillPrompts
        ? `${SYSTEM_PROMPT}\\n\\nAdditional Skills:\\n${skillPrompts}${memoryPrompt}`
        : `${SYSTEM_PROMPT}${memoryPrompt}`;

      if (activeProjectPath) {
        if (!qwenLocation?.found) {
          setError('Modifying a project requires a local AI model.');
          return;
        }
        const prompt = `I am making modifications to "${projectName}". Requirements: ${freeformPrompt}. Return a JSON array of files to update or create.`;
        const raw = await generate(prompt, enhancedSystemPrompt, tok => setStreamPreview(p => p + tok), activeProjectPath);
        files = parseFilesFromResponse(raw);
        if (!files.length) {
          setError(`AI did not return valid files. Check console for raw response.`);
          return;
        }
      } else if (mode === 'template' && selectedTemplate) {
        files = await templateToFiles(selectedTemplate, projectName, description);
      } else if (mode === 'freeform') {
        if (!qwenLocation?.found) {
          setError('Freeform generation requires a local AI model.');
          return;
        }
        const prompt = `Generate a complete software project called "${projectName}". Description: ${description}. Requirements: ${freeformPrompt}. Return a JSON array of ALL project files.`;
        const raw = await generate(prompt, enhancedSystemPrompt, tok => setStreamPreview(p => p + tok), activeProjectPath);
        files = parseFilesFromResponse(raw);
        if (!files.length) {
          setError(`AI did not return valid files. Check console for raw response.`);
          return;
        }
      }

      setGeneratedFiles(files);
      setSelectedFile(files[0]?.path ?? null);
      setStreamPreview('');
      setStep('preview');
    } catch (e: any) {
      console.error('[generateFiles] Error:', e);
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const buildProject = async () => {
    setStep('building');
    setError(null);
    try {
      const result = await buildAndPushProject({
        project_name: projectName,
        description,
        template_id: selectedTemplate || null,
        freeform_prompt: freeformPrompt || null,
        generated_files: generatedFiles,
        private_repo: isPrivate,
        output_dir: outputDir,
      });
      setBuildResult({
        success: result.success,
        message: result.message,
        url: result.repo_url ?? undefined,
      });
      setStep('done');
      if (result.success) onProjectCreated();
    } catch (e: any) {
      setError(String(e));
      setStep('preview');
    }
  };

  const reset = () => {
    setStep('setup');
    setProjectName('');
    setDescription('');
    setFreeformPrompt('');
    setGeneratedFiles([]);
    setSelectedFile(null);
    setBuildResult(null);
    setError(null);
    setSelectedTemplate('');
  };

  const selectedFileContent = generatedFiles.find(f => f.path === selectedFile)?.content ?? '';

  return (
    <div className="panel">
      <div className="panel-header">
        <h1>{activeProjectPath ? `🛠️ Modifying Project` : `🏗️ Project Builder`}</h1>
        <p>{activeProjectPath
          ? `Generating modifications for ${projectName}`
          : `Generate a modular project with AI and push to GitHub`}</p>
      </div>

      {error && <div className="error-banner">⚠️ {error}</div>}

      {step === 'setup' && (
        <div className="builder-setup">
          {!activeProjectPath && (
            <div className="form-group">
              <label>Project Name</label>
              <input
                className="input"
                placeholder="my-awesome-project"
                value={projectName}
                onChange={e => setProjectName(e.target.value.replace(/\\s+/g, '-').toLowerCase())}
              />
            </div>
          )}

          {!activeProjectPath && (
            <>
              <div className="form-group">
                <label>Description</label>
                <input
                  className="input"
                  placeholder="A brief description of what this project does"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>

              <div className="mode-toggle">
                <button className={`mode-btn ${mode === 'template' ? 'active' : ''}`} onClick={() => setMode('template')}>
                  📋 From Template
                </button>
                <button className={`mode-btn ${mode === 'freeform' ? 'active' : ''}`} onClick={() => setMode('freeform')}>
                  🤖 AI Freeform
                </button>
              </div>

              {mode === 'template' && (
                <div className="template-grid">
                  {templates.map(t => (
                    <div
                      key={t.id}
                      className={`template-card ${selectedTemplate === t.id ? 'selected' : ''}`}
                      onClick={() => setSelectedTemplate(t.id)}
                    >
                      <div className="template-name">{t.name}</div>
                      <div className="template-lang">{t.language}</div>
                      <div className="template-desc">{t.description}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="form-group">
                <label>{mode === 'freeform' ? 'Describe what you want built' : 'Additional AI requirements (optional)'}</label>
                <textarea
                  className="textarea"
                  rows={4}
                  placeholder={mode === 'freeform' ? 'e.g. A REST API with authentication and database' : 'e.g. Add dark mode, use Tailwind CSS'}
                  value={freeformPrompt}
                  onChange={e => setFreeformPrompt(e.target.value)}
                />
              </div>
            </>
          )}

          {activeProjectPath && (
            <div className="form-group">
              <label>What would you like to build or modify?</label>
              <textarea
                className="textarea"
                rows={8}
                placeholder="Describe the modifications..."
                value={freeformPrompt}
                onChange={e => setFreeformPrompt(e.target.value)}
              />
            </div>
          )}

          {/* Model Status */}
          {qwenLocation?.found && (
            <div style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: '6px', fontSize: '13px', marginBottom: '12px' }}>
              <span style={{ color: 'var(--green)' }}>✅</span>
              <span style={{ color: 'var(--text)', marginLeft: '8px' }}>
                Model: <strong>{qwenLocation.model || 'Unknown'}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>({qwenLocation.method})</span>
              </span>
            </div>
          )}

          {!qwenLocation?.found && qwenLocation?.method === 'ollama_no_model' && (
            <div className="warning-box">
              ⚠️ Ollama is installed but no models found. Run <code>ollama pull qwen2.5-coder</code>
            </div>
          )}

          {!qwenLocation && (
            <div className="warning-box">⏳ Scanning for models...</div>
          )}

          {/* Token Input Gauge */}
          {freeformPrompt && (
            <div style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: '6px', fontSize: '12px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>📝 Prompt tokens</span>
                <span style={{ color: promptTokenCount > 8000 ? 'var(--red)' : 'var(--text)' }}>{promptTokenCount} tokens</span>
              </div>
              <div style={{ height: '4px', background: 'var(--surface3)', borderRadius: '2px' }}>
                <div style={{ width: `${Math.min((promptTokenCount / 8000) * 100, 100)}%`, height: '100%', background: promptTokenCount > 8000 ? 'var(--red)' : 'var(--green)', borderRadius: '2px' }} />
              </div>
            </div>
          )}

          {/* Token Progress During Generation */}
          {generating && tokenProgress && (
            <div className="stream-preview">
              <div className="stream-label">🤖 {qwenLocation?.model || 'Model'} is generating...</div>
              <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
                <span>📊 Tokens: {tokenProgress.tokens}</span>
                <span>⏱️ {tokenProgress.elapsed.toFixed(1)}s</span>
                <span>⚡ {(tokenProgress.tokens / Math.max(tokenProgress.elapsed, 0.1)).toFixed(1)} tok/s</span>
              </div>
              <pre className="stream-text">{streamPreview || '▌'}</pre>
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={generateFiles}
            disabled={generating || (!activeProjectPath && (!projectName || (mode === 'template' && !selectedTemplate)))}
            style={{ marginTop: '16px' }}
          >
            {generating ? '⏳ Generating...' : (activeProjectPath ? '⚡ Generate Modifications' : '→ Generate Project')}
          </button>
        </div>
      )}

      {step === 'preview' && (
        <div className="preview-panel">
          <div className="preview-header">
            <h2>Preview — {generatedFiles.length} files</h2>
            <div className="preview-actions">
              <button className="btn btn-secondary" onClick={() => setStep('setup')}>← Back</button>
              <button className="btn btn-primary" onClick={buildProject}>
                {activeProjectPath ? '🚀 Apply Changes' : '🚀 Build & Push to GitHub'}
              </button>
            </div>
          </div>

          <div className="preview-layout">
            <div className="file-tree">
              {generatedFiles.map(f => (
                <div
                  key={f.path}
                  className={`file-item ${selectedFile === f.path ? 'active' : ''}`}
                  onClick={() => setSelectedFile(f.path)}
                >
                  <span className="file-icon">📄</span>
                  <span className="file-path">{f.path}</span>
                </div>
              ))}
            </div>
            <div className="file-content">
              {selectedFile && (
                <>
                  <div className="file-content-header">{selectedFile}</div>
                  <textarea
                    className="code-editor"
                    value={selectedFileContent}
                    onChange={e => setGeneratedFiles(files =>
                      files.map(f => f.path === selectedFile ? { ...f, content: e.target.value } : f)
                    )}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 'building' && (
        <div className="building-state">
          <div className="spinner">⚙️</div>
          <h2>Building & Pushing...</h2>
          <p>Creating files, initializing git, creating GitHub repo, pushing...</p>
        </div>
      )}

      {step === 'done' && buildResult && (
        <div className="done-state">
          <div className="done-icon">{buildResult.success ? '✅' : '❌'}</div>
          <h2>{buildResult.success ? 'Project Created!' : 'Build Failed'}</h2>
          <p>{buildResult.message}</p>
          {buildResult.url && (
            <a href={buildResult.url} target="_blank" rel="noreferrer" className="repo-link">
              📁 {buildResult.url}
            </a>
          )}
          <button className="btn btn-primary" onClick={reset}>Build Another Project</button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFilesFromResponse(raw: string): GeneratedFile[] {
  console.log('[parseFilesFromResponse] Raw response length:', raw.length);
  console.log('[parseFilesFromResponse] Raw preview:', raw.slice(0, 500));

  if (!raw || raw.trim().length === 0) return [];

  // Strategy 1: Try direct JSON parse
  try {
    const cleaned = raw.replace(/```json\\s*/gi, '').replace(/```\\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    
    // Handle { "files": [...] } format
    if (parsed && parsed.files && Array.isArray(parsed.files)) {
      const validFiles = parsed.files
        .filter((f: any) => f && f.path && typeof f.content === 'string')
        .map((f: any) => ({ path: String(f.path), content: String(f.content) }));
      console.log('[parseFilesFromResponse] Parsed { files: [...] } format:', validFiles.length);
      return validFiles;
    }
    
    // Handle direct array format [...]
    if (Array.isArray(parsed)) {
      const validFiles = parsed
        .filter((f: any) => f && f.path && typeof f.content === 'string')
        .map((f: any) => ({ path: String(f.path), content: String(f.content) }));
      console.log('[parseFilesFromResponse] Parsed [...] format:', validFiles.length);
      return validFiles;
    }
  } catch (e) {
    console.log('[parseFilesFromResponse] Direct JSON parse failed:', e);
  }

  // Strategy 2: Extract { "files": [...] } using regex
  try {
    const filesMatch = raw.match(/"files"\\s*:\\s*(\\[.*?\\])/s);
    if (filesMatch && filesMatch[1]) {
      const parsed = JSON.parse(filesMatch[1]);
      const validFiles = parsed
        .filter((f: any) => f && f.path && typeof f.content === 'string')
        .map((f: any) => ({ path: String(f.path), content: String(f.content) }));
      console.log('[parseFilesFromResponse] Extracted files array:', validFiles.length);
      return validFiles;
    }
  } catch (e) {
    console.log('[parseFilesFromResponse] Files extraction failed:', e);
  }

  // Strategy 3: Extract JSON array from text
  try {
    const cleaned = raw.replace(/```json\\s*/gi, '').replace(/```\\s*/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      const json = cleaned.slice(start, end + 1);
      const parsed = JSON.parse(json);
      const validFiles = parsed
        .filter((f: any) => f && f.path && typeof f.content === 'string')
        .map((f: any) => ({ path: String(f.path), content: String(f.content) }));
      console.log('[parseFilesFromResponse] Extracted JSON array:', validFiles.length);
      return validFiles;
    }
  } catch (e) {
    console.log('[parseFilesFromResponse] Array extraction failed:', e);
  }

  // Strategy 4: Extract individual file objects
  const files: GeneratedFile[] = [];
  const seenPaths = new Set<string>();
  const pathMatch = raw.match(/"path"\\s*:\\s*"([^"]+)"/g);
  const contentMatch = raw.match(/"content"\\s*:\\s*"([^"]+)"/g);
  
  if (pathMatch && contentMatch && pathMatch.length === contentMatch.length) {
    for (let i = 0; i < pathMatch.length; i++) {
      const path = pathMatch[i].match(/"path"\\s*:\\s*"([^"]+)"/)?.[1];
      const content = contentMatch[i].match(/"content"\\s*:\\s*"([^"]+)"/)?.[1];
      if (path && content && !seenPaths.has(path)) {
        files.push({ path, content: content.replace(/\\\\n/g, '\\n') });
        seenPaths.add(path);
      }
    }
  }

  console.log('[parseFilesFromResponse] Regex extraction:', files.length);
  return files;
}

function getFileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const icons: Record<string, string> = {
    ts: '📘', tsx: '📘', js: '📗', jsx: '📗', py: '🐍', rs: '🦀',
    md: '📝', json: '📋', yaml: '📋', yml: '📋', html: '🌐', css: '🎨',
  };
  return icons[ext || ''] || '📄';
}

import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { scanOllamaModels, ollamaChat, scanSystemModels, testSandboxEnvironment } from '../lib/api';
import type { OllamaModel, ScanResult, SandboxTestResult } from '../types';

export default function OllamaScannerPanel() {
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(`You are an expert software engineer. Generate complete, working code files.

CRITICAL: Return ONLY valid JSON. No markdown, no explanations.

Format:
{
  "files": [
    { "path": "src/main.py", "content": "...", "language": "python" }
  ]
}`);
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState('');
  const [streamedOutput, setStreamedOutput] = useState('');
  const [tokenCount, setTokenCount] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [activeTab, setActiveTab] = useState<'scanner' | 'generator' | 'sandbox'>('scanner');
  const [jsonStrictMode, setJsonStrictMode] = useState(true);
  const [sandboxResult, setSandboxResult] = useState<SandboxTestResult | null>(null);
  const [testingSandbox, setTestingSandbox] = useState(false);

  const scanModels = async () => {
    setScanning(true);
    try {
      const models = await scanOllamaModels();
      setOllamaModels(models);
      if (models.length > 0 && !selectedModel) {
        const qwenModel = models.find(m => m.name.toLowerCase().includes('qwen'));
        setSelectedModel(qwenModel?.name || models[0].name);
      }
    } catch (e) {
      console.error('Scan failed:', e);
    } finally {
      setScanning(false);
    }
  };

  const scanFullSystem = async () => {
    setScanning(true);
    try {
      const result = await scanSystemModels();
      setScanResult(result);
    } catch (e) {
      console.error('System scan failed:', e);
    } finally {
      setScanning(false);
    }
  };

  const generateResponse = async () => {
    if (!selectedModel) return;
    
    setGenerating(true);
    setOutput('');
    setStreamedOutput('');
    setTokenCount(0);
    setElapsedTime(0);
    
    const startTime = Date.now();
    let tokens = 0;
    
    const unlisten = await listen<string>('ollama-token', (event) => {
      setStreamedOutput(prev => prev + event.payload);
      tokens++;
      setTokenCount(tokens);
      setElapsedTime((Date.now() - startTime) / 1000);
    });

    try {
      const fullSystemPrompt = jsonStrictMode 
        ? `${systemPrompt}\n\nSTRICT JSON MODE: Output ONLY the JSON object. No text before or after.`
        : systemPrompt;

      const result = await ollamaChat(selectedModel, customPrompt, fullSystemPrompt);
      setOutput(result);
    } catch (e: any) {
      console.error('Generation failed:', e);
      setOutput(`Error: ${e.message}`);
    } finally {
      unlisten();
      setGenerating(false);
    }
  };

  const runSandboxTest = async () => {
    setTestingSandbox(true);
    try {
      const result = await testSandboxEnvironment();
      setSandboxResult(result);
    } catch (e: any) {
      console.error('Sandbox test failed:', e);
      setSandboxResult({
        all_passed: false,
        tests: [{ name: 'Sandbox test error', passed: false, output: '', error: e.message }]
      });
    } finally {
      setTestingSandbox(false);
    }
  };

  useEffect(() => {
    scanModels();
  }, []);

  const tokensPerSecond = elapsedTime > 0 ? (tokenCount / elapsedTime).toFixed(1) : '0';

  return (
    <div className="panel">
      <div className="panel-header">
        <h1>🧠 Ollama Model Scanner</h1>
        <p>Scan available models and generate JSON-strict responses</p>
      </div>

      <nav style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <button
          className={`btn ${activeTab === 'scanner' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('scanner')}
        >
          📊 Model Scanner
        </button>
        <button
          className={`btn ${activeTab === 'generator' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('generator')}
        >
          ✨ JSON Generator
        </button>
        <button
          className={`btn ${activeTab === 'sandbox' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('sandbox')}
        >
          🧪 Sandbox Test
        </button>
      </nav>

      {activeTab === 'scanner' && (
        <>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
            <button className="btn btn-primary" onClick={scanModels} disabled={scanning}>
              {scanning ? '⏳ Scanning...' : '🔄 Scan Ollama Models'}
            </button>
            <button className="btn btn-secondary" onClick={scanFullSystem} disabled={scanning}>
              🔍 Full System Scan
            </button>
          </div>

          {ollamaModels.length > 0 && (
            <div className="model-list">
              <h3>Available Ollama Models ({ollamaModels.length})</h3>
              <div style={{ display: 'grid', gap: '8px' }}>
                {ollamaModels.map(model => (
                  <div
                    key={model.name}
                    className={`model-card ${selectedModel === model.name ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedModel(model.name);
                      setActiveTab('generator');
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{model.name}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                          Size: {model.size} • Modified: {model.modified}
                        </div>
                      </div>
                      {selectedModel === model.name && (
                        <span style={{ color: 'var(--green)' }}>✓ Selected</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {scanResult && (
            <div style={{ marginTop: '24px' }}>
              <h3>System Scan Results</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginTop: '12px' }}>
                <div style={{ padding: '16px', background: 'var(--surface2)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{scanResult.total_models}</div>
                  <div style={{ color: 'var(--text-muted)' }}>Total Models</div>
                </div>
                <div style={{ padding: '16px', background: 'var(--surface2)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{scanResult.total_size_human}</div>
                  <div style={{ color: 'var(--text-muted)' }}>Total Size</div>
                </div>
                {scanResult.recommended_for_coding && (
                  <div style={{ padding: '16px', background: 'var(--surface2)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '4px' }}>Recommended for Coding</div>
                    <div style={{ fontWeight: 'bold' }}>{scanResult.recommended_for_coding}</div>
                  </div>
                )}
                {scanResult.recommended_for_chat && (
                  <div style={{ padding: '16px', background: 'var(--surface2)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '4px' }}>Recommended for Chat</div>
                    <div style={{ fontWeight: 'bold' }}>{scanResult.recommended_for_chat}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {ollamaModels.length === 0 && !scanning && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p>No Ollama models found.</p>
              <p>Run <code style={{ background: 'var(--surface2)', padding: '4px 8px', borderRadius: '4px' }}>ollama pull qwen3.5:35b-a3b</code> to download a model.</p>
            </div>
          )}
        </>
      )}

      {activeTab === 'generator' && (
        <div className="generator-panel">
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Select Model</label>
            <select
              className="input"
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              style={{ width: '100%', maxWidth: '400px' }}
            >
              {ollamaModels.map(model => (
                <option key={model.name} value={model.name}>{model.name}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="json-strict"
              checked={jsonStrictMode}
              onChange={e => setJsonStrictMode(e.target.checked)}
            />
            <label htmlFor="json-strict">JSON Strict Mode</label>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>System Prompt</label>
            <textarea
              className="textarea"
              rows={4}
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: '12px' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>User Prompt</label>
            <textarea
              className="textarea"
              rows={8}
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="Describe what you want to build..."
              style={{ fontFamily: 'monospace', fontSize: '12px' }}
            />
          </div>

          <button
            className="btn btn-primary"
            onClick={generateResponse}
            disabled={generating || !selectedModel}
            style={{ marginBottom: '16px' }}
          >
            {generating ? '⏳ Generating...' : '🚀 Generate JSON Response'}
          </button>

          {generating && (
            <div style={{ padding: '12px', background: 'var(--surface2)', borderRadius: '8px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                <span>📊 Tokens: <strong>{tokenCount}</strong></span>
                <span>⏱️ Time: <strong>{elapsedTime.toFixed(1)}s</strong></span>
                <span>⚡ Speed: <strong>{tokensPerSecond} tok/s</strong></span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto' }}>
                {streamedOutput || '▌'}
              </div>
            </div>
          )}

          {(output || streamedOutput) && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontWeight: 'bold' }}>Output</label>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(output || streamedOutput);
                  }}
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                >
                  📋 Copy
                </button>
              </div>
              <textarea
                className="code-editor"
                rows={20}
                value={output || streamedOutput}
                onChange={e => setOutput(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
            </div>
          )}
        </div>
      )}

      {activeTab === 'sandbox' && (
        <div className="sandbox-panel">
          <div style={{ marginBottom: '24px' }}>
            <h3>🧪 Sandbox Test Environment</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
              Verify Tauri compilation and all required tools are installed
            </p>
            <button
              className="btn btn-primary"
              onClick={runSandboxTest}
              disabled={testingSandbox}
            >
              {testingSandbox ? '⏳ Running Tests...' : '🔬 Run Sandbox Test'}
            </button>
          </div>

          {sandboxResult && (
            <div>
              <div style={{ 
                padding: '16px', 
                borderRadius: '8px', 
                marginBottom: '16px',
                background: sandboxResult.all_passed ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)',
                border: `1px solid ${sandboxResult.all_passed ? 'var(--green)' : 'var(--red)'}`
              }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: sandboxResult.all_passed ? 'var(--green)' : 'var(--red)' }}>
                  {sandboxResult.all_passed ? '✅ All Tests Passed' : '❌ Some Tests Failed'}
                </div>
              </div>

              <div style={{ display: 'grid', gap: '8px' }}>
                {sandboxResult.tests.map((test: { name: string; passed: boolean; output: string; error: string }, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      padding: '12px',
                      background: 'var(--surface2)',
                      borderRadius: '6px',
                      border: `1px solid ${test.passed ? 'var(--green)' : 'var(--red)'}`
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 'bold' }}>{test.name}</span>
                      <span style={{ fontSize: '18px' }}>{test.passed ? '✅' : '❌'}</span>
                    </div>
                    {test.output && (
                      <pre style={{ 
                        marginTop: '8px', 
                        padding: '8px', 
                        background: 'var(--surface1)', 
                        borderRadius: '4px',
                        fontSize: '11px',
                        overflow: 'auto',
                        maxHeight: '100px'
                      }}>
                        {test.output}
                      </pre>
                    )}
                    {test.error && (
                      <pre style={{ 
                        marginTop: '8px', 
                        padding: '8px', 
                        background: 'rgba(244, 67, 54, 0.1)', 
                        borderRadius: '4px',
                        fontSize: '11px',
                        color: 'var(--red)',
                        overflow: 'auto',
                        maxHeight: '100px'
                      }}>
                        {test.error}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!sandboxResult && !testingSandbox && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Click "Run Sandbox Test" to verify your development environment
            </div>
          )}
        </div>
      )}

      <style>{`
        .model-list h3 {
          margin-bottom: 12px;
          color: var(--text);
        }
        
        .model-card {
          padding: 16px;
          background: var(--surface2);
          border: 2px solid transparent;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .model-card:hover {
          border-color: var(--primary);
          background: var(--surface3);
        }
        
        .model-card.selected {
          border-color: var(--green);
          background: rgba(76, 175, 80, 0.1);
        }
        
        .generator-panel, .sandbox-panel {
          display: flex;
          flex-direction: column;
        }
        
        .code-editor {
          width: 100%;
          min-height: 400px;
          padding: 16px;
          background: var(--surface1);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-family: 'Consolas', 'Monaco', monospace;
          font-size: '13px';
          line-height: 1.5;
          resize: vertical;
        }
        
        .code-editor:focus {
          outline: none;
          border-color: var(--primary);
        }
      `}</style>
    </div>
  );
}

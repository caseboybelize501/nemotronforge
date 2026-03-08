import { useState } from 'react'
import { useModel } from './hooks/useModel'
import BuilderPanel from './components/BuilderPanel'

function App() {
  const { location: modelLocation, scanning, scan } = useModel()
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null)

  return (
    <div style={{ minHeight: '100vh', padding: '20px' }}>
      <header style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '28px', marginBottom: '8px' }}>🤖 QwenForge</h1>
            <p style={{ color: 'var(--text-muted)' }}>AI-Powered Software Fabrication Engine (Qwen 3 Coder)</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              padding: '8px 12px',
              borderRadius: '6px',
              background: modelLocation?.found ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${modelLocation?.found ? 'var(--green)' : 'var(--red)'}`,
              fontSize: '13px',
            }}>
              {scanning ? '🔄 Scanning...' : modelLocation?.found ? `✅ ${modelLocation.model || 'Model Ready'}` : '⚠️ No Model'}
            </div>
            <button className="btn btn-secondary" onClick={scan} disabled={scanning} style={{ padding: '8px 16px', fontSize: '13px' }}>
              {scanning ? '⏳' : '🔄'} Scan
            </button>
          </div>
        </div>
      </header>

      <BuilderPanel
        modelLocation={modelLocation}
        onProjectCreated={() => {
          console.log('Project created!')
          setActiveProjectPath(null)
        }}
        activeProjectPath={activeProjectPath}
      />
    </div>
  )
}

export default App

import { useState } from 'react'
import { useQwen } from './hooks/useQwen'
import BuilderPanel from './components/BuilderPanel'

function App() {
  const { location: qwenLocation } = useQwen()
  const [activeTab, setActiveTab] = useState<'builder' | 'models'>('builder')
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null)

  return (
    <div style={{ minHeight: '100vh', padding: '20px' }}>
      <header style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
        <h1 style={{ fontSize: '28px', marginBottom: '8px' }}>🔨 Nemotron</h1>
        <p style={{ color: 'var(--text-muted)' }}>AI-Powered Software Builder</p>
      </header>

      <nav style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <button
          className={`btn ${activeTab === 'builder' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('builder')}
        >
          🏗️ Builder
        </button>
        <button
          className={`btn ${activeTab === 'models' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('models')}
        >
          🧠 Models
        </button>
      </nav>

      {activeTab === 'builder' && (
        <BuilderPanel
          qwenLocation={qwenLocation}
          ghLoggedIn={false}
          onProjectCreated={() => console.log('Project created!')}
          activeProjectPath={activeProjectPath}
        />
      )}

      {activeTab === 'models' && (
        <div className="panel">
          <div className="panel-header">
            <h1>🧠 Model Scanner</h1>
            <p>Scan for available AI models</p>
          </div>
          <p style={{ color: 'var(--text-muted)' }}>Model scanner component placeholder</p>
        </div>
      )}
    </div>
  )
}

export default App

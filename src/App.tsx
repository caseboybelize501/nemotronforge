import { useState } from 'react'
import { useQwen } from './hooks/useQwen'
import BuilderPanel from './components/BuilderPanel'

function App() {
  const { location: qwenLocation } = useQwen()
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null)

  return (
    <div style={{ minHeight: '100vh', padding: '20px' }}>
      <header style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
        <h1 style={{ fontSize: '28px', marginBottom: '8px' }}>🔨 Nemotron</h1>
        <p style={{ color: 'var(--text-muted)' }}>AI-Powered Software Fabrication Engine</p>
      </header>

      <BuilderPanel
        qwenLocation={qwenLocation}
        ghLoggedIn={false}
        onProjectCreated={() => console.log('Project created!')}
        activeProjectPath={activeProjectPath}
      />
    </div>
  )
}

export default App

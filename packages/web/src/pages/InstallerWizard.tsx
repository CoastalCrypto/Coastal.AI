import { useState, useEffect, useCallback } from 'react'

interface Step {
  id: string
  label: string
  status: 'pending' | 'ok' | 'error' | 'progress' | 'running'
  detail?: string
  progress?: number
}

// Electron IPC bridge (window.electron set by preload)
interface ElectronIpc {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: (...args: unknown[]) => void) => void
}

const ipc: ElectronIpc = (window as unknown as { electron?: ElectronIpc }).electron ?? {
  invoke: async (_ch: string, ..._args: unknown[]) => [],
  on: () => {},
}

export function InstallerWizard({ onComplete }: { onComplete: () => void }) {
  const [steps, setSteps] = useState<Step[]>([
    { id: 'node',   label: 'Checking Node.js v22+',   status: 'pending' },
    { id: 'pnpm',   label: 'Checking pnpm',            status: 'pending' },
    { id: 'ollama', label: 'Checking Ollama',          status: 'pending' },
    { id: 'model',  label: 'Pulling llama3.2 (~2 GB)', status: 'pending' },
    { id: 'launch', label: 'Launching Coastal.AI',     status: 'pending' },
  ])
  const [phase, setPhase] = useState<'checking' | 'ready' | 'pulling' | 'done' | 'error'>('checking')
  const [pullLog, setPullLog] = useState('')

  const updateStep = (id: string, patch: Partial<Step>) => {
    setSteps(s => s.map(step => step.id === id ? { ...step, ...patch } : step))
  }

  useEffect(() => {
    ipc.on('installer:pull-progress', (...args: unknown[]) => {
      const data = args[1] as string
      setPullLog(prev => (prev + data).split('\n').slice(-5).join('\n'))
    })
  }, [])

  const runChecks = useCallback(async () => {
    setPhase('checking')
    updateStep('node', { status: 'running' })
    try {
      const results = await ipc.invoke('installer:check') as Step[]
      for (const r of results) updateStep(r.id, r)
      const allOk = results.every(r => r.status === 'ok')
      setPhase(allOk ? 'ready' : 'error')
    } catch {
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    void (async () => { await runChecks() })()
  }, [runChecks])

  const pullModel = async () => {
    setPhase('pulling')
    updateStep('model', { status: 'running', label: 'Pulling llama3.2…' })
    try {
      await ipc.invoke('installer:pull-model', 'llama3.2')
      updateStep('model', { status: 'ok', detail: 'llama3.2 ready' })
      updateStep('launch', { status: 'ok', detail: 'Running on :4747' })
      setPhase('done')
    } catch (e: unknown) {
      updateStep('model', { status: 'error', detail: String(e) })
      setPhase('error')
    }
  }

  const statusIcon = (status: Step['status']) => {
    if (status === 'ok')      return <span style={{ color: '#10b981', fontSize: 16 }}>&#10003;</span>
    if (status === 'error')   return <span style={{ color: '#ff5252', fontSize: 16 }}>&#10005;</span>
    if (status === 'running') return <span style={{ color: '#00e5ff', fontSize: 14, animation: 'spin 1s linear infinite', display: 'inline-block' }}>&#9675;</span>
    return <span style={{ color: '#475569', fontSize: 16 }}>&middot;</span>
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#050a0f',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 40, fontFamily: 'Space Grotesk, sans-serif',
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: '#00e5ff', letterSpacing: '-1.5px', margin: 0 }}>Coastal.AI</h1>
        <p style={{ color: '#94adc4', fontSize: 14, marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>Installation Wizard</p>
      </div>

      {/* Steps */}
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(13,31,51,0.8)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(0,229,255,0.15)', borderRadius: 14,
        padding: '28px 32px', marginBottom: 24,
      }}>
        <p style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#00e5ff', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 20 }}>
          System Check
        </p>
        {steps.map((step, i) => (
          <div key={step.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            paddingBottom: i < steps.length - 1 ? 14 : 0,
            marginBottom: i < steps.length - 1 ? 14 : 0,
            borderBottom: i < steps.length - 1 ? '1px solid rgba(0,229,255,0.06)' : 'none',
          }}>
            <span style={{ marginTop: 2, minWidth: 20, textAlign: 'center' }}>{statusIcon(step.status)}</span>
            <div>
              <div style={{ fontSize: 14, color: step.status === 'error' ? '#ff6b6b' : '#e2f4ff', fontWeight: 600 }}>{step.label}</div>
              {step.detail && (
                <div style={{ fontSize: 11, color: '#94adc4', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>{step.detail}</div>
              )}
            </div>
          </div>
        ))}

        {pullLog && phase === 'pulling' && (
          <div style={{
            marginTop: 16, padding: '8px 12px',
            background: 'rgba(0,0,0,0.4)', borderRadius: 6,
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#94adc4',
            whiteSpace: 'pre-wrap', maxHeight: 80, overflowY: 'auto',
          }}>
            {pullLog}
          </div>
        )}
      </div>

      {/* CTA */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {phase === 'ready' && (
          <button
            onClick={pullModel}
            style={{
              padding: '12px 32px', background: '#00e5ff', color: '#050a0f',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
              fontFamily: 'Space Grotesk, sans-serif', cursor: 'pointer',
              letterSpacing: '-0.3px',
            }}
          >
            Install &amp; Launch
          </button>
        )}
        {phase === 'done' && (
          <button
            onClick={() => ipc.invoke('installer:open-browser', 'http://127.0.0.1:5173').then(onComplete)}
            style={{
              padding: '12px 32px', background: '#10b981', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
              fontFamily: 'Space Grotesk, sans-serif', cursor: 'pointer',
            }}
          >
            Open Coastal.AI
          </button>
        )}
        {phase === 'error' && (
          <button
            onClick={runChecks}
            style={{
              padding: '10px 24px', background: 'rgba(255,82,82,0.1)',
              border: '1px solid rgba(255,82,82,0.3)', color: '#ff6b6b',
              borderRadius: 8, fontSize: 13, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer',
            }}
          >
            Retry checks
          </button>
        )}
      </div>

      <p style={{ color: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', marginTop: 24 }}>
        Your data never leaves this device. All models run locally.
      </p>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { PipelineRun } from './PipelineRun.js'
import { PipelineCanvas } from '../components/PipelineCanvas.js'
import { PANEL, BTN_CYAN, INPUT_STYLE, PAGE_BG, SECTION_LABEL } from '../styles/tokens.js'
import type { NavPage } from '../components/SideNav'

function adminHeaders(): Record<string, string> {
  const session = sessionStorage.getItem('cc_admin_session') ?? ''
  return session ? { 'x-admin-session': session } : {}
}

interface Agent {
  id: string
  name: string
  active: boolean
  role?: string
}

interface Stage {
  id: string
  agentId: string
  loopBack?: { toStageIdx: number; condition: string; maxIterations: number }
}

interface SavedPipeline {
  id: string
  name: string
  stages: Array<{ agentId: string; type: string; loopBack?: Stage['loopBack'] }>
}

interface RecentRun {
  runId: string
  status: string
  totalDurationMs?: number
  startedAt: number
  pipelineName: string
  stageCount: number
}

function uid() { return Math.random().toString(36).slice(2) }

export function Pipeline({ onNav }: { onNav: (p: NavPage) => void }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [stages, setStages] = useState<Stage[]>([
    { id: uid(), agentId: '' },
    { id: uid(), agentId: '' },
  ])
  const [input, setInput] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'visual'>('list')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'builder' | 'run'>('builder')
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [activeStageCount, setActiveStageCount] = useState(0)
  const [pipelineName, setPipelineName] = useState('')
  const [savedPipelines, setSavedPipelines] = useState<SavedPipeline[]>([])
  const [showLibrary, setShowLibrary] = useState(false)
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([])
  const [showRuns, setShowRuns] = useState(false)

  useEffect(() => {
    fetch('/api/admin/agents', { headers: adminHeaders() })
      .then(r => r.json())
      .then((data: Agent[]) => setAgents(data.filter(a => a.active)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/admin/pipelines', { headers: adminHeaders() })
      .then(r => r.json()).then(setSavedPipelines).catch(() => {})
    fetch('/api/admin/pipeline-runs', { headers: adminHeaders() })
      .then(r => r.json()).then(setRecentRuns).catch(() => {})
  }, [])

  const addStage = () => setStages(s => [...s, { id: uid(), agentId: '' }])
  const removeStage = (id: string) => setStages(s => s.filter(x => x.id !== id))

  const updateStage = (id: string, patch: Partial<Omit<Stage, 'id'>>) =>
    setStages(s => s.map(x => x.id === id ? { ...x, ...patch } : x))

  const moveStage = (idx: number, dir: -1 | 1) => {
    setStages(s => {
      const arr = [...s]
      const target = idx + dir
      if (target < 0 || target >= arr.length) return arr
      ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
      return arr
    })
  }

  const runWithStages = async (
    stagesArg: Array<{ agentId: string; type: 'agent'; loopBack?: Stage['loopBack'] }>,
    promptArg: string,
  ) => {
    if (stagesArg.length < 1) { setError('Add at least one agent stage'); return }
    if (!promptArg.trim()) { setError('Enter an initial prompt'); return }
    setError(null)
    setRunning(true)
    try {
      const res = await fetch('/api/pipeline/run/async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({
          stages: stagesArg,
          input: promptArg.trim(),
          pipelineName: pipelineName.trim() || 'Ad-hoc run',
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = `HTTP ${res.status}`
        try { const j = JSON.parse(text); if (j.error) msg = j.error } catch { /* fall back to status code msg */ }
        throw new Error(msg)
      }
      const data = await res.json()
      if (data.runId) {
        setActiveStageCount(stagesArg.length)
        setActiveRunId(data.runId)
        setView('run')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const run = async () => {
    const filled = stages.filter(s => s.agentId)
    return runWithStages(
      filled.map(s => ({ agentId: s.agentId, type: 'agent' as const, loopBack: s.loopBack })),
      input,
    )
  }

  const runFromCanvas = async (
    canvasStages: Array<{ agentId: string; type: 'agent' }>,
  ) => {
    return runWithStages(canvasStages, input)
  }

  const save = async () => {
    if (!pipelineName.trim()) { setError('Enter a pipeline name to save'); return }
    setError(null)
    try {
      const res = await fetch('/api/admin/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({
          name: pipelineName,
          stages: stages.map(s => ({ agentId: s.agentId, type: 'agent', loopBack: s.loopBack })),
        }),
      })
      if (!res.ok) throw new Error(`Save failed (${res.status})`)
      const saved = await res.json()
      setSavedPipelines(prev => [saved, ...prev])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const loadPipeline = (p: SavedPipeline) => {
    setPipelineName(p.name)
    setStages(p.stages.map(s => ({ id: uid(), agentId: s.agentId, loopBack: s.loopBack })))
    setShowLibrary(false)
  }

  // Show live run view when a run is active
  if (view === 'run' && activeRunId) {
    return (
      <PipelineRun
        runId={activeRunId}
        pipelineName={pipelineName || 'Pipeline Run'}
        stageCount={activeStageCount}
        onBack={() => {
          setView('builder'); setActiveRunId(null)
          fetch('/api/admin/pipeline-runs', { headers: adminHeaders() })
            .then(r => r.json()).then(setRecentRuns).catch(() => {})
        }}
        onNav={onNav}
      />
    )
  }

  return (
    <div className="text-white" style={PAGE_BG}>
      <div className="pt-20 px-4 sm:px-6 max-w-3xl mx-auto pb-16">

        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white">Pipeline Builder</h1>
          <p className="text-sm mt-1" style={{ color: '#94adc4' }}>
            Chain agents in sequence — each agent's output becomes the next agent's input.
          </p>
        </div>

        {/* Name + Save + Library row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <input
            value={pipelineName}
            onChange={e => setPipelineName(e.target.value)}
            placeholder="Pipeline name (optional)"
            style={{ flex: 1, ...INPUT_STYLE }}
          />
          <button onClick={save} style={BTN_CYAN}>Save</button>
          <button
            onClick={() => setShowLibrary(v => !v)}
            style={{ ...BTN_CYAN, opacity: showLibrary ? 1 : 0.7 }}
          >📂 Library</button>
          <button
            onClick={() => setShowRuns(v => !v)}
            style={{ ...BTN_CYAN, opacity: showRuns ? 1 : 0.7 }}
          >🕐 Runs</button>
        </div>

        {/* View mode toggle */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {(['list', 'visual'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '5px 14px',
                borderRadius: 6,
                fontSize: 11,
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: 700,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                textTransform: 'uppercase',
                background: viewMode === mode ? 'rgba(0,229,255,0.15)' : 'rgba(0,229,255,0.04)',
                border: viewMode === mode ? '1px solid rgba(0,229,255,0.5)' : '1px solid rgba(0,229,255,0.15)',
                color: viewMode === mode ? '#00e5ff' : '#94adc4',
                transition: 'all 0.15s',
              }}
            >
              {mode === 'list' ? 'List' : 'Visual'}
            </button>
          ))}
        </div>

        {/* Library panel */}
        {showLibrary && (
          <div style={{ ...PANEL, marginBottom: 16 }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#00e5ff', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              Saved Pipelines
            </div>
            {savedPipelines.length === 0 && (
              <p style={{ fontSize: '12px', color: '#475569' }}>No saved pipelines yet. Build a pipeline and click Save to store it here.</p>
            )}
            {savedPipelines.map(p => (
              <div
                key={p.id}
                onClick={() => loadPipeline(p)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 6, background: 'rgba(5,10,15,0.50)', marginBottom: 4, cursor: 'pointer' }}
              >
                <span style={{ fontSize: '12px', color: '#e2e8f0' }}>{p.name}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#475569' }}>
                  {Array.isArray(p.stages) ? p.stages.length : 0} stages
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Recent runs panel */}
        {showRuns && (
          <div style={{ ...PANEL, marginBottom: 16 }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#00e5ff', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              Recent Runs
            </div>
            {recentRuns.length === 0 && (
              <p style={{ fontSize: '12px', color: '#475569' }}>No runs yet. Start a pipeline to see history here.</p>
            )}
            {recentRuns.map((r) => {
              const statusColor = r.status === 'done' ? '#10b981' : r.status === 'error' ? '#ff5252' : r.status === 'aborted' ? '#ffb300' : '#00e5ff'
              const durationLabel = r.totalDurationMs != null ? `${(r.totalDurationMs / 1000).toFixed(1)}s` : null
              const timeLabel = new Date(r.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              return (
                <div
                  key={r.runId}
                  onClick={() => { setActiveRunId(r.runId); setActiveStageCount(r.stageCount); setPipelineName(r.pipelineName); setView('run') }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 6, background: 'rgba(5,10,15,0.50)', marginBottom: 4, cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}40`, borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>{r.status}</span>
                    <span style={{ fontSize: '12px', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.pipelineName}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#475569' }}>
                    {durationLabel && <span>{durationLabel}</span>}
                    <span>{timeLabel}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {error && (
          <div className="mb-4 text-sm font-mono px-4 py-2 rounded-lg" style={{ background: 'rgba(255,82,82,0.08)', border: '1px solid rgba(255,82,82,0.25)', color: '#ff6b6b' }}>
            ⚠ {error}
          </div>
        )}

        {viewMode === 'visual' ? (
          /* ── Visual canvas view ── */
          <div style={{ height: 'calc(100vh - 200px)', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(0,229,255,0.12)' }}>
            <PipelineCanvas
              agents={agents}
              onRunPipeline={runFromCanvas}
              running={running}
              prompt={input}
              onPromptChange={setInput}
            />
          </div>
        ) : (
          /* ── List view ── */
          <>
            {/* Stage list */}
            <div style={PANEL} className="mb-4">
              <p className="mb-4" style={SECTION_LABEL}>STAGES</p>

              {stages.map((stage, idx) => (
                <div key={stage.id} className="mb-4">
                  <div className="flex items-center gap-3">
                    <div className="text-xs font-mono w-5 text-center shrink-0" style={{ color: '#94adc4' }}>
                      {idx + 1}
                    </div>

                    <select
                      value={stage.agentId}
                      onChange={e => updateStage(stage.id, { agentId: e.target.value })}
                      className="flex-1 rounded-lg px-3 py-2 text-sm font-mono"
                      style={{ background: 'rgba(5,10,15,0.8)', border: '1px solid rgba(0,229,255,0.20)', color: stage.agentId ? '#e2e8f0' : '#94adc4' }}
                    >
                      <option value="">— select agent —</option>
                      {agents.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>

                    {/* Loop-back toggle */}
                    <button
                      onClick={() => updateStage(stage.id, { loopBack: stage.loopBack ? undefined : { toStageIdx: Math.max(0, idx - 1), condition: 'DONE', maxIterations: 3 } })}
                      style={{ ...BTN_CYAN, padding: '4px 8px', fontSize: '10px', opacity: stage.loopBack ? 1 : 0.4 }}
                      title="Add loop-back to earlier stage"
                    >↩</button>

                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => moveStage(idx, -1)} disabled={idx === 0} className="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs px-1" aria-label="Move stage up">↑</button>
                      <button onClick={() => moveStage(idx, 1)} disabled={idx === stages.length - 1} className="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs px-1" aria-label="Move stage down">↓</button>
                      <button onClick={() => removeStage(stage.id)} className="text-red-700 hover:text-red-400 text-xs px-1" aria-label="Remove stage">✕</button>
                    </div>
                  </div>

                  {/* Loop-back config row */}
                  {stage.loopBack && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, marginLeft: 32, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#ffb300' }}>loop if not contains:</span>
                      <input
                        value={stage.loopBack.condition}
                        onChange={e => updateStage(stage.id, { loopBack: { ...stage.loopBack!, condition: e.target.value } })}
                        style={{ width: 80, ...INPUT_STYLE, padding: '2px 6px', fontSize: '10px' }}
                      />
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#94adc4' }}>→ stage</span>
                      <input
                        type="number" min={1} max={idx + 1}
                        value={stage.loopBack.toStageIdx + 1}
                        onChange={e => updateStage(stage.id, { loopBack: { ...stage.loopBack!, toStageIdx: Number(e.target.value) - 1 } })}
                        style={{ width: 40, ...INPUT_STYLE, padding: '2px 6px', fontSize: '10px' }}
                      />
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#94adc4' }}>max</span>
                      <input
                        type="number" min={1} max={10}
                        value={stage.loopBack.maxIterations}
                        onChange={e => updateStage(stage.id, { loopBack: { ...stage.loopBack!, maxIterations: Number(e.target.value) } })}
                        style={{ width: 40, ...INPUT_STYLE, padding: '2px 6px', fontSize: '10px' }}
                      />
                    </div>
                  )}
                </div>
              ))}

              <button onClick={addStage} style={BTN_CYAN} className="mt-2">+ Add Stage</button>
            </div>

            {/* Input prompt */}
            <div style={PANEL} className="mb-4">
              <p className="mb-3" style={SECTION_LABEL}>INITIAL PROMPT</p>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                rows={4}
                placeholder="The prompt that kicks off the pipeline..."
                className="w-full rounded-lg px-4 py-3 text-sm font-mono resize-none focus:outline-none"
                style={{ background: 'rgba(5,10,15,0.8)', border: '1px solid rgba(0,229,255,0.20)', color: '#e2e8f0', fontSize: '14px' }}
              />
            </div>

            <button
              onClick={run}
              disabled={running}
              className="w-full py-3 font-bold font-mono tracking-widest rounded-xl transition-all text-sm"
              style={running
                ? { background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.15)', color: '#94adc4' }
                : { background: '#00e5ff', color: '#050a0f' }}
            >
              {running ? 'Starting pipeline...' : '▶ Run Pipeline'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

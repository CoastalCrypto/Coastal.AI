import { useState, useRef, useEffect } from 'react'
import { usePipelineRun, type LiveStage } from '../hooks/usePipelineRun.js'
import { PANEL, BTN_CYAN, BTN_RED, MONO, PAGE_BG, COLOR } from '../styles/tokens.js'

const BTN: React.CSSProperties = { ...BTN_CYAN, padding: '8px 16px', fontWeight: 600 }

interface Props {
  runId: string
  pipelineName: string
  stageCount: number
  onBack: () => void
  onNav: (p: NavPage) => void
}

export function PipelineRun({ runId, pipelineName, stageCount, onBack, onNav }: Props) {
  const { state, steer, abort } = usePipelineRun(runId, stageCount)
  const [steerMsg, setSteerMsg] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]))
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-expand the active stage
  useEffect(() => {
    if (state?.activeStageIdx != null) {
      setExpanded(prev => new Set([...prev, state.activeStageIdx]))
    }
  }, [state?.activeStageIdx])

  // Auto-scroll to bottom of active stage
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state?.stages])

  if (!state) return (
    <div style={PAGE_BG}>
      <div className="pt-20 px-4 max-w-3xl mx-auto" style={{ color: COLOR.muted }}>
        <p style={MONO}>Connecting to run {runId}...</p>
      </div>
    </div>
  )

  const confirmLeave = (action: () => void) => {
    if (state?.status === 'running') {
      if (!window.confirm('A pipeline stage is still running. Leave and let it continue in the background?')) return
    }
    action()
  }

  const send = async () => {
    if (!steerMsg.trim()) return
    await steer(steerMsg.trim())
    setSteerMsg('')
  }

  const statusColor = state.status === 'done' ? COLOR.green : state.status === 'error' ? COLOR.red : COLOR.cyan
  const statusLabel = state.status === 'running' ? `Stage ${state.activeStageIdx + 1} of ${state.stageCount} · running` : state.status

  return (
    <div style={PAGE_BG}>
    <div className="pt-20 px-4 max-w-3xl mx-auto pb-8" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* Header */}
      <div style={{ ...PANEL, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => confirmLeave(onBack)} style={{ ...BTN, padding: '5px 10px', fontSize: '11px' }}>← Back</button>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, color: '#FFFFFF', fontSize: '15px' }}>
            ▣ {pipelineName || 'Pipeline Run'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ ...MONO, fontSize: '10px', color: statusColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {state.status === 'running' && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#00e5ff', marginRight: 6, animation: 'pulse 1.5s infinite' }} />}
            {statusLabel}
          </span>
          {state.status === 'running' && (
            <button onClick={abort} style={BTN_RED}>✕ Abort</button>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div style={{ ...PANEL, display: 'flex', alignItems: 'center', overflowX: 'auto' }}>
        {state.stages.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 60 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '9px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                background: s.status === 'done' ? 'rgba(16,185,129,0.15)' : s.status === 'running' ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.04)',
                border: s.status === 'done' ? '1px solid #10b981' : s.status === 'running' ? '1px solid #00e5ff' : '1px solid rgba(255,255,255,0.10)',
                color: s.status === 'done' ? '#10b981' : s.status === 'running' ? '#00e5ff' : 'rgba(255,255,255,0.45)',
                boxShadow: s.status === 'running' ? '0 0 8px rgba(0,229,255,0.3)' : 'none',
              }}>
                {s.status === 'done' ? '✓' : i + 1}
              </div>
              <span style={{ ...MONO, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: s.status === 'done' ? '#10b981' : s.status === 'running' ? '#00e5ff' : 'rgba(255,255,255,0.45)' }}>
                {s.agentName.length > 10 ? s.agentName.slice(0, 10) + '…' : s.agentName}
              </span>
            </div>
            {i < state.stages.length - 1 && (
              <div style={{ width: 32, height: 1, background: 'rgba(255,255,255,0.08)', flexShrink: 0, margin: '0 4px' }} />
            )}
          </div>
        ))}
      </div>

      {/* Stage threads */}
      {state.stages.map((stage, i) => (
        <StageThread
          key={i}
          stage={stage}
          isExpanded={expanded.has(i)}
          onToggle={() => setExpanded(prev => {
            const next = new Set(prev)
            if (next.has(i)) next.delete(i)
            else next.add(i)
            return next
          })}
        />
      ))}

      {state.finalOutput && (
        <div style={{ ...PANEL, borderColor: 'rgba(16,185,129,0.20)' }}>
          <div style={{ ...MONO, fontSize: '10px', color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Final Output</div>
          <pre style={{ fontSize: '12px', color: '#e2e8f0', whiteSpace: 'pre-wrap', margin: 0 }}>{state.finalOutput}</pre>
        </div>
      )}

      {state.error && (
        <div style={{ ...PANEL, borderColor: 'rgba(255,82,82,0.25)', background: 'rgba(255,82,82,0.05)' }}>
          <span style={{ ...MONO, fontSize: '11px', color: '#ff5252' }}>Error: {state.error}</span>
        </div>
      )}

      <div ref={bottomRef} />

      {/* Steer bar */}
      {state.status === 'running' && (
        <div style={{ position: 'sticky', bottom: 16, ...PANEL, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ ...MONO, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#00e5ff', whiteSpace: 'nowrap' }}>
            → Stage {state.activeStageIdx + 1}
          </span>
          <input
            value={steerMsg}
            onChange={e => setSteerMsg(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Steer the active agent — e.g. 'focus on DeFi trends only'"
            style={{ flex: 1, background: 'rgba(5,10,15,0.80)', border: '1px solid rgba(0,229,255,0.20)', borderRadius: 8, padding: '8px 14px', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
          />
          <button onClick={send} style={BTN}>Send</button>
        </div>
      )}
    </div>
    </div>
  )
}

function StageThread({ stage, isExpanded, onToggle }: { stage: LiveStage; isExpanded: boolean; onToggle: () => void }) {
  const isActive = stage.status === 'running'
  const isDone = stage.status === 'done'
  const nameColor = isDone ? '#10b981' : isActive ? '#00e5ff' : 'rgba(255,255,255,0.30)'
  const badgeStyle: React.CSSProperties = {
    fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', letterSpacing: '0.06em',
    textTransform: 'uppercase', padding: '2px 8px', borderRadius: 10,
    background: isDone ? 'rgba(16,185,129,0.10)' : isActive ? 'rgba(0,229,255,0.10)' : 'rgba(255,255,255,0.04)',
    color: isDone ? '#10b981' : isActive ? '#00e5ff' : 'rgba(255,255,255,0.45)',
    border: isDone ? '1px solid rgba(16,185,129,0.20)' : isActive ? '1px solid rgba(0,229,255,0.25)' : '1px solid rgba(255,255,255,0.08)',
  }
  const panel = isActive ? { background: 'rgba(26,39,68,0.80)', border: '1px solid rgba(0,229,255,0.30)', borderRadius: 12, overflow: 'hidden' } : { background: 'rgba(26,39,68,0.80)', border: '1px solid rgba(0,229,255,0.10)', borderRadius: 12, overflow: 'hidden' }

  return (
    <div style={panel}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '12px', fontWeight: 600, color: nameColor }}>
            {isDone ? '✓ ' : isActive ? '● ' : ''}{stage.agentName}
          </span>
          <span style={badgeStyle}>{stage.status === 'running' ? 'running' : stage.status === 'done' ? `done${stage.durationMs ? ` · ${(stage.durationMs / 1000).toFixed(1)}s` : ''}` : 'waiting'}</span>
          {stage.iteration > 0 && <span style={{ ...badgeStyle, background: 'rgba(255,179,0,0.10)', color: '#ffb300', border: '1px solid rgba(255,179,0,0.25)' }}>×{stage.iteration + 1}</span>}
        </div>
        <span aria-label={isExpanded ? 'Collapse stage' : 'Expand stage'} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'rgba(255,255,255,0.30)' }}>{isExpanded ? '▾' : '▸'}</span>
      </div>

      {isExpanded && (
        <div style={{ padding: '4px 16px 12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          {stage.toolCalls.map((tc, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 10px', margin: '2px 0', background: 'rgba(5,10,15,0.60)', borderLeft: `2px solid ${tc.status === 'done' ? 'rgba(16,185,129,0.40)' : 'rgba(255,179,0,0.50)'}`, borderRadius: '0 4px 4px 0', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px' }}>
              <span style={{ color: '#a78bfa' }}>{tc.toolName}</span>
              <span style={{ color: 'rgba(255,255,255,0.35)' }}>{JSON.stringify(tc.args).slice(0, 80)}</span>
              {tc.status === 'running' && <span style={{ color: '#ffb300', marginLeft: 'auto' }}>running…</span>}
            </div>
          ))}
          {stage.steerMessages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 10px', margin: '4px 0', background: 'rgba(255,179,0,0.06)', borderLeft: '2px solid rgba(255,179,0,0.40)', borderRadius: '0 4px 4px 0', fontSize: '11px', color: '#ffb300' }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: 'rgba(255,179,0,0.50)', textTransform: 'uppercase' }}>you →</span>
              {msg}
            </div>
          ))}
          {stage.status === 'running' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'rgba(0,229,255,0.50)' }}>
              <span style={{ display: 'flex', gap: 3 }}>
                {[0, 0.3, 0.6].map((delay, i) => (
                  <span key={i} style={{ animation: `blink 1.2s ${delay}s infinite step-end` }}>●</span>
                ))}
              </span>
              thinking
            </div>
          )}
          {stage.output && stage.status === 'done' && (
            <div style={{ background: 'rgba(5,10,15,0.60)', borderRadius: 4, padding: '8px 10px', marginTop: 6, fontSize: '11px', color: '#94a3b8', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
              {stage.output}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

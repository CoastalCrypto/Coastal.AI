import { useState, useEffect, useCallback } from 'react'
import { coreClient, type Cycle } from '../../api/client'
import { failureLabel, stageLabel } from '../../utils/architect-labels'
import { relativeTime } from '../../utils/relative-time'
import { useArchitectSSE } from '../../hooks/useArchitectSSE'
import { ApprovalButtons } from './ApprovalButtons'

export function ActivityTab() {
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')

  const refresh = useCallback(() => {
    coreClient.architectActivity(100).then(setCycles).catch(() => {})
  }, [])

  useEffect(() => {
    coreClient.architectActivity(100)
      .then(setCycles)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Auto-refresh when SSE events arrive
  useArchitectSSE(refresh)

  if (loading) return <div className="animate-pulse font-mono text-xs text-cyan-400/60">loading activity...</div>

  const filtered = filter === 'all' ? cycles : cycles.filter(c => {
    if (filter === 'working') return c.stage === 'planning' || c.stage === 'building'
    if (filter === 'waiting') return c.stage === 'plan_review' || c.stage === 'pr_review'
    if (filter === 'merged') return c.outcome === 'merged'
    if (filter === 'errored') return c.outcome === 'error'
    return c.outcome === filter
  })

  const filters = ['all', 'working', 'waiting', 'merged', 'cancelled', 'errored']

  const outcomeColors: Record<string, string> = {
    merged: 'text-emerald-400', built: 'text-cyan-400', revised: 'text-yellow-400',
    failed: 'text-red-400', vetoed: 'text-orange-400', error: 'text-red-500',
  }

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {filters.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-[10px] font-mono px-2 py-1 rounded ${filter === f ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}>
            {f}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs font-mono text-center py-8" style={{ color: '#4a6a8a' }}>No cycles match this filter</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <div key={c.id}>
              <button onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                className="w-full p-3 rounded-lg text-left flex items-center justify-between hover:bg-white/[0.02] transition-colors"
                style={{ background: '#0d1f33', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-[10px] font-mono ${outcomeColors[c.outcome ?? ''] ?? 'text-gray-400'}`}>
                    {c.outcome ?? stageLabel(c.stage)}
                  </span>
                  <span className="text-sm truncate" style={{ color: '#e2f4ff' }}>
                    iter {c.iteration} · {c.modelUsed ?? 'unknown'}
                  </span>
                </div>
                <span className="text-[10px] font-mono shrink-0" style={{ color: '#4a6a8a' }}>
                  {relativeTime(c.createdAt)}
                </span>
              </button>
              {expanded === c.id && (
                <div className="p-4 rounded-b-lg animate-slide-up" style={{ background: '#112240', borderTop: 'none' }}>
                  {c.planText && <div className="mb-3"><span className="text-[10px] font-mono text-cyan-400/60">PLAN</span><p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: '#94adc4' }}>{c.planText}</p></div>}
                  {c.testSummary && <div className="mb-3"><span className="text-[10px] font-mono text-cyan-400/60">TESTS</span><p className="text-xs mt-1" style={{ color: '#94adc4' }}>{c.testSummary}</p></div>}
                  {c.prUrl && <div className="mb-3"><span className="text-[10px] font-mono text-cyan-400/60">PR</span><a href={c.prUrl} target="_blank" rel="noopener" className="text-xs text-cyan-400 hover:underline ml-2">{c.prUrl}</a></div>}
                  {c.failureKind && <div className="mb-3"><span className="text-[10px] font-mono text-red-400/60">FAILURE</span><span className="text-xs ml-2" style={{ color: '#94adc4' }}>{failureLabel(c.failureKind)}: {c.errorMessage}</span></div>}
                  {(c.stage === 'plan_review' || c.stage === 'pr_review') && (
                    <ApprovalButtons cycleId={c.id} gate={c.stage === 'plan_review' ? 'plan' : 'merge'} onDone={() => {
                      coreClient.architectActivity(100).then(setCycles).catch(() => {})
                    }} />
                  )}
                  <span className="text-[10px] font-mono block mt-2" style={{ color: '#4a6a8a' }}>cycle {c.id.slice(-8)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

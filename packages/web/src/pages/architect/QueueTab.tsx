import { useState, useEffect, useCallback } from 'react'
import { coreClient, type WorkItem } from '../../api/client'
import { statusLabel } from '../../utils/architect-labels'
import { relativeTime } from '../../utils/relative-time'
import { useArchitectSSE } from '../../hooks/useArchitectSSE'

const STATUS_COLORS: Record<string, string> = {
  pending:        'text-yellow-400 bg-yellow-400/10',
  active:         'text-cyan-400 bg-cyan-400/10',
  awaiting_human: 'text-orange-400 bg-orange-400/10',
  merged:         'text-emerald-400 bg-emerald-400/10',
  cancelled:      'text-gray-500 bg-gray-500/10',
  error:          'text-red-400 bg-red-400/10',
  paused:         'text-gray-400 bg-gray-400/10',
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function QueueTab() {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const inp = 'w-full bg-black/30 border border-white/8 rounded px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-gray-600'

  const load = useCallback(() => {
    coreClient.architectWorkItems('all')
      .then(setItems)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  // Auto-refresh when SSE events arrive
  useArchitectSSE(load)

  const handleCreate = async () => {
    if (!title.trim()) return
    setSaving(true); setError('')
    try {
      await coreClient.architectCreateWorkItem({ title: title.trim(), body: body.trim() || undefined })
      setTitle(''); setBody(''); setCreating(false); load()
    } catch (e: unknown) { setError(errorMessage(e)) }
    finally { setSaving(false) }
  }

  const handleAction = async (id: string, action: 'pause' | 'resume' | 'cancel') => {
    try {
      const statusMap: Record<string, string> = { pause: 'paused', resume: 'pending', cancel: 'cancelled' }
      await coreClient.architectPatchWorkItem(id, { status: statusMap[action] })
      load()
    } catch (e: unknown) { setError(errorMessage(e)) }
  }

  if (loading) return <div className="animate-pulse font-mono text-xs text-cyan-400/60">loading missions...</div>

  return (
    <div>
      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

      <div className="flex justify-between items-center mb-4">
        <span className="text-xs font-mono" style={{ color: '#4a6a8a' }}>
          {items.length} mission{items.length !== 1 ? 's' : ''}
        </span>
        {!creating && (
          <button onClick={() => setCreating(true)} className="btn-primary text-xs px-3 py-1.5">
            + Add Mission
          </button>
        )}
      </div>

      {creating && (
        <div className="mb-4 p-4 rounded-lg animate-slide-up" style={{ background: '#0d1f33', border: '1px solid rgba(0, 229, 255, 0.15)' }}>
          <input
            className={inp}
            placeholder="What should the architect do?"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
          <textarea
            className={`${inp} mt-2 min-h-[60px]`}
            placeholder="Details (optional)"
            value={body}
            onChange={e => setBody(e.target.value)}
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleCreate}
              disabled={saving || !title.trim()}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => { setCreating(false); setTitle(''); setBody('') }}
              className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <div className="text-center py-12">
          <p className="text-sm mb-2" style={{ color: '#94adc4' }}>No missions yet</p>
          <p className="text-xs mb-4" style={{ color: '#4a6a8a' }}>Add a task for the architect to work on</p>
          <button onClick={() => setCreating(true)} className="btn-primary text-xs px-4 py-2">Add a Mission</button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id}>
              <button
                onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                className="w-full p-3 rounded-lg flex items-center justify-between hover:bg-white/[0.02] transition-colors text-left"
                style={{ background: '#0d1f33', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${STATUS_COLORS[item.status] ?? 'text-gray-400'}`}>
                      {statusLabel(item.status)}
                    </span>
                    <span className="text-sm truncate" style={{ color: '#e2f4ff' }}>{item.title}</span>
                  </div>
                  <span className="text-[10px] font-mono mt-0.5 block" style={{ color: '#4a6a8a' }}>
                    {item.source} · {item.id.slice(-8)} · {relativeTime(item.createdAt)}
                  </span>
                </div>
                <div className="flex gap-2 ml-3 shrink-0" onClick={e => e.stopPropagation()}>
                  {(item.status === 'pending' || item.status === 'active') && (
                    <button
                      onClick={() => handleAction(item.id, 'pause')}
                      className="text-[10px] font-mono text-gray-500 hover:text-yellow-400"
                    >
                      PAUSE
                    </button>
                  )}
                  {(item.status === 'paused' || item.status === 'error') && (
                    <button
                      onClick={() => handleAction(item.id, 'resume')}
                      className="text-[10px] font-mono text-gray-500 hover:text-cyan-400"
                    >
                      RESUME
                    </button>
                  )}
                  {item.status !== 'merged' && item.status !== 'cancelled' && (
                    <button
                      onClick={() => handleAction(item.id, 'cancel')}
                      className="text-[10px] font-mono text-gray-500 hover:text-red-400"
                    >
                      CANCEL
                    </button>
                  )}
                </div>
              </button>
              {expanded === item.id && (
                <div className="p-4 rounded-b-lg animate-slide-up" style={{ background: '#112240', borderTop: 'none' }}>
                  {item.body && <div className="mb-3"><span className="text-[10px] font-mono text-cyan-400/60">DETAILS</span><p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: '#94adc4' }}>{item.body}</p></div>}
                  {item.targetHints && item.targetHints.length > 0 && <div className="mb-3"><span className="text-[10px] font-mono text-cyan-400/60">TARGET FILES</span><p className="text-xs mt-1 font-mono" style={{ color: '#94adc4' }}>{item.targetHints.join(', ')}</p></div>}
                  <div className="flex gap-4 flex-wrap">
                    <span className="text-[10px] font-mono" style={{ color: '#4a6a8a' }}>budget: {item.budgetIters} iters / {item.budgetLoc} LOC</span>
                    <span className="text-[10px] font-mono" style={{ color: '#4a6a8a' }}>approval: {item.approvalPolicy}</span>
                    <span className="text-[10px] font-mono" style={{ color: '#4a6a8a' }}>priority: {item.priority}</span>
                  </div>
                  {item.pausedReason && <div className="mt-2"><span className="text-[10px] font-mono text-red-400/60">PAUSED</span><span className="text-xs ml-2" style={{ color: '#94adc4' }}>{item.pausedReason}</span></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

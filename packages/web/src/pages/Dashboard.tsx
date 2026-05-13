import { useState, useEffect, useMemo } from 'react'
import { useEventStream, type AgentEvent } from '../hooks/useEventStream'
import { EmptyState } from '../components/ui/EmptyState.js'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 1000) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

function eventIcon(type: string): string {
  switch (type) {
    case 'tool_call_start':    return '⚙️'
    case 'tool_call_end':      return '✅'
    case 'session_start':      return '▶️'
    case 'session_complete':   return '🏁'
    case 'token_counted':      return '🔢'
    case 'job_run':            return '🕐'
    case 'pr_open':            return '🔀'
    default:                   return '•'
  }
}

function eventColor(event: AgentEvent): string {
  if (event.type === 'tool_call_end' && event.success === false) return 'border-red-500/30 bg-red-500/5'
  if (event.type === 'tool_call_end') return 'border-emerald-500/20 bg-emerald-500/5'
  if (event.type === 'session_complete') return 'border-cyan-500/20 bg-cyan-500/5'
  if (event.type === 'pr_open') return 'border-violet-500/20 bg-violet-500/5'
  return 'border-white/5 bg-white/2'
}

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case 'tool_call_start':
      return `Running ${event.toolName}`
    case 'tool_call_end':
      return `${event.toolName} ${event.success ? 'completed' : 'failed'} in ${event.durationMs}ms`
    case 'session_start':
      return `Session started · ${event.agentId}`
    case 'session_complete':
      return `Session complete · ${event.toolCallCount ?? 0} tool calls`
    case 'token_counted':
      return `${(event.tokenCount ?? 0)} tokens · ${event.agentId ?? 'unknown model'}`
    case 'job_run':
      return `${event.jobName} · ${event.status}`
    case 'pr_open':
      return `PR: ${event.title}`
    default:
      return event.type
  }
}

function StatBox({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="p-4 pb-3">
        <div className="text-xs font-mono mb-2 tracking-wider" style={{ color: '#94adc4' }}>{label}</div>
        <div className="text-2xl font-bold text-white tabular-nums" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{value}</div>
        {sub && <div className="text-[11px] mt-1.5" style={{ color: 'rgba(148,173,196,0.60)' }}>{sub}</div>}
      </div>
      <div className="stat-card-bar">
        <div className="w-2 h-0.5 bg-black/20 mx-auto rounded-full" />
      </div>
    </div>
  )
}

// ── Cron types ────────────────────────────────────────────────────────────────
interface CronJob {
  id: string
  name: string
  schedule: string
  task: string
  agentId: string
  enabled: boolean
  lastRunAt: number | null
  lastRunStatus: 'ok' | 'error' | null
  lastRunOutput: string | null
  createdAt: number
}

function adminHeaders(): Record<string, string> {
  const session = sessionStorage.getItem('cc_admin_session') ?? ''
  return session ? { 'x-admin-session': session } : {}
}

const EMPTY_FORM = { name: '', schedule: '0 9 * * 1-5', task: '', agentId: 'general' }

function CronSection() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [triggering, setTriggering] = useState<string | null>(null)
  const [expandedOutput, setExpandedOutput] = useState<string | null>(null)

  const load = async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/admin/crons', { headers: adminHeaders(), signal })
      if (res.ok) setJobs(await res.json())
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.warn('[Dashboard] Failed to load cron jobs:', e)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [])

  const openNew = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(true)
  }

  const openEdit = (job: CronJob) => {
    setForm({ name: job.name, schedule: job.schedule, task: job.task, agentId: job.agentId })
    setEditingId(job.id)
    setShowForm(true)
  }

  const cancel = () => { setShowForm(false); setEditingId(null) }

  const save = async () => {
    if (!form.name || !form.schedule || !form.task) return
    try {
      const url = editingId ? `/api/admin/crons/${editingId}` : '/api/admin/crons'
      const method = editingId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      cancel()
      load()
    } catch (e: any) {
      alert(`Failed to save cron job: ${e.message}`)
    }
  }

  const toggle = async (job: CronJob) => {
    try {
      const res = await fetch(`/api/admin/crons/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ enabled: !job.enabled }),
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      load()
    } catch (e: any) {
      console.warn('[Dashboard] Failed to toggle cron job:', e)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this cron job?')) return
    try {
      const res = await fetch(`/api/admin/crons/${id}`, { method: 'DELETE', headers: adminHeaders() })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      load()
    } catch (e: any) {
      alert(`Failed to delete cron job: ${e.message}`)
    }
  }

  const trigger = async (id: string) => {
    setTriggering(id)
    try {
      const res = await fetch(`/api/admin/crons/${id}/trigger`, { method: 'POST', headers: adminHeaders() })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
    } catch (e: any) {
      console.warn('[Dashboard] Failed to trigger cron job:', e)
    } finally {
      setTriggering(null)
      load()
    }
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(10,22,40,0.80)', border: '1px solid rgba(0,229,255,0.10)' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,229,255,0.08)' }}>
        <span className="section-heading">SCHEDULED JOBS</span>
        <button
          onClick={openNew}
          className="text-xs font-mono transition-colors rounded px-2 py-0.5"
          style={{ color: '#00e5ff', border: '1px solid rgba(0,229,255,0.25)' }}
          onMouseEnter={e => (e.target as HTMLElement).style.background = 'rgba(0,229,255,0.08)'}
          onMouseLeave={e => (e.target as HTMLElement).style.background = 'transparent'}
        >
          + NEW JOB
        </button>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <div className="px-4 py-4 border-b border-white/5 bg-cyan-950/10">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-mono text-gray-500 block mb-1">NAME</label>
              <input
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50"
                placeholder="Daily digest"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-mono text-gray-500 block mb-1">SCHEDULE (cron)</label>
              <input
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50"
                placeholder="0 9 * * 1-5"
                value={form.schedule}
                onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-mono text-gray-500 block mb-1">AGENT ID</label>
              <input
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50"
                placeholder="general"
                value={form.agentId}
                onChange={e => setForm(f => ({ ...f, agentId: e.target.value }))}
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="text-xs font-mono text-gray-500 block mb-1">TASK (message sent to agent)</label>
            <textarea
              rows={2}
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50 resize-none"
              placeholder="Generate a daily summary of completed tasks and send it to the team channel"
              value={form.task}
              onChange={e => setForm(f => ({ ...f, task: e.target.value }))}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={save}
              className="text-xs font-mono px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/50 text-cyan-400 rounded hover:bg-cyan-500/20 transition-colors"
            >
              {editingId ? 'SAVE CHANGES' : 'CREATE JOB'}
            </button>
            <button
              onClick={cancel}
              className="text-xs font-mono px-3 py-1.5 text-gray-500 hover:text-gray-300 transition-colors"
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {/* Job list */}
      {jobs.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-3xl mb-3 opacity-30">🕐</div>
          <p className="text-gray-500 text-sm">No scheduled jobs yet</p>
          <p className="text-gray-600 text-xs mt-1">Create a job to automate recurring agent tasks.</p>
        </div>
      ) : (
        <div className="divide-y divide-white/3">
          {jobs.map(job => (
            <div key={job.id} className="px-4 py-3 hover:bg-white/2 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-white font-mono">{job.name}</span>
                    <span className="text-[10px] font-mono text-cyan-500/60 border border-cyan-900/40 px-1.5 py-0.5 rounded bg-cyan-950/20">
                      {job.schedule}
                    </span>
                    {job.enabled ? (
                      <span className="text-[10px] font-mono text-emerald-400 border border-emerald-900/40 px-1.5 py-0.5 rounded bg-emerald-950/20">
                        ACTIVE
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-gray-500 border border-gray-800 px-1.5 py-0.5 rounded">
                        PAUSED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate mb-1">{job.task}</p>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-gray-600">
                    <span>agent: {job.agentId}</span>
                    {job.lastRunAt && (
                      <>
                        <span>·</span>
                        <span
                          className={`cursor-pointer hover:underline ${job.lastRunStatus === 'error' ? 'text-red-500' : 'text-gray-600'}`}
                          onClick={() => setExpandedOutput(expandedOutput === job.id ? null : job.id)}
                        >
                          last run {relativeTime(job.lastRunAt)} [{job.lastRunStatus}]
                        </span>
                      </>
                    )}
                  </div>
                  {expandedOutput === job.id && job.lastRunOutput && (
                    <pre className="mt-2 text-[10px] font-mono text-gray-400 bg-black/40 rounded p-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
                      {job.lastRunOutput}
                    </pre>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => trigger(job.id)}
                    disabled={triggering === job.id}
                    className="text-[10px] font-mono text-gray-500 hover:text-cyan-400 transition-colors disabled:opacity-40"
                    title="Run now"
                  >
                    {triggering === job.id ? '...' : '▶'}
                  </button>
                  <button
                    onClick={() => toggle(job)}
                    className="text-[10px] font-mono text-gray-500 hover:text-yellow-400 transition-colors"
                    title={job.enabled ? 'Pause' : 'Resume'}
                  >
                    {job.enabled ? '⏸' : '⏵'}
                  </button>
                  <button
                    onClick={() => openEdit(job)}
                    className="text-[10px] font-mono text-gray-500 hover:text-cyan-400 transition-colors"
                  >
                    [edit]
                  </button>
                  <button
                    onClick={() => remove(job.id)}
                    className="text-[10px] font-mono text-gray-500 hover:text-red-400 transition-colors"
                  >
                    [del]
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export function Dashboard({ onNav }: { onNav: (page: NavPage) => void }) {
  const { events, connected, clear } = useEventStream(200)
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null)

  const { toolCalls, successful, avgMs, sessions, reversed } = useMemo(() => {
    const toolCalls  = events.filter(e => e.type === 'tool_call_end')
    const successful = toolCalls.filter(e => e.success !== false)
    const avgMs      = toolCalls.length
      ? Math.round(toolCalls.reduce((s, e) => s + (e.durationMs ?? 0), 0) / toolCalls.length)
      : 0
    const sessions  = events.filter(e => e.type === 'session_complete').length
    const reversed  = [...events].reverse()
    return { toolCalls, successful, avgMs, sessions, reversed }
  }, [events])

  return (
    <div className="min-h-screen text-white" style={{ background: '#050a0f' }}>

      <div className="pt-20 pb-12 px-4 sm:px-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span style={{ color: '#00e5ff', fontSize: '20px', lineHeight: 1 }}>✳</span>
              <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}>
                Activity Dashboard
              </h1>
            </div>
            <p className="text-sm font-mono ml-8" style={{ color: '#94adc4' }}>
              Live agent event stream
              <span className={`inline-block w-2 h-2 rounded-full ml-2 ${connected ? 'animate-pulse' : ''}`}
                style={{ background: connected ? '#10b981' : '#555' }} />
              <span className="ml-1">{connected ? 'connected' : 'reconnecting...'}</span>
            </p>
          </div>
          <button
            onClick={clear}
            className="text-xs font-mono transition-colors rounded-lg px-3 py-1.5"
            style={{ color: '#94adc4', border: '1px solid rgba(255,255,255,0.06)' }}
            onMouseEnter={e => { (e.target as HTMLElement).style.color = '#fff'; (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)' }}
            onMouseLeave={e => { (e.target as HTMLElement).style.color = '#94adc4'; (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)' }}
          >
            clear
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatBox label="TOOL CALLS" value={toolCalls.length} sub="this session" />
          <StatBox label="SUCCESS RATE" value={toolCalls.length ? `${Math.round(successful.length / toolCalls.length * 100)}%` : '—'} />
          <StatBox label="AVG DURATION" value={avgMs ? `${avgMs}ms` : '—'} />
          <StatBox label="SESSIONS" value={sessions} sub="completed" />
        </div>

        {/* Cron jobs */}
        <div className="mb-8">
          <CronSection />
        </div>

        {/* Event feed */}
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(10,22,40,0.80)', border: '1px solid rgba(0,229,255,0.10)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,229,255,0.08)' }}>
            <span className="section-heading">EVENT FEED</span>
            <span className="text-xs font-mono" style={{ color: '#94adc4' }}>{events.length} events</span>
          </div>

          {events.length === 0 ? (
            <EmptyState
              icon="⚡"
              title="Waiting for agent activity"
              description="Start a conversation with an agent to see tool calls, memory updates, and pipeline events appear here in real time."
            />
          ) : (
            <div className="divide-y divide-white/3 max-h-[60vh] overflow-y-auto">
              {reversed.map((event, i) => {
                const isExpanded = expandedEvent === i
                return (
                  <div key={`${event.ts}-${i}`}>
                    <div
                      className={`flex items-start gap-3 px-4 py-3 border-l-2 transition-colors cursor-pointer hover:bg-white/2 ${eventColor(event)}`}
                      onClick={() => setExpandedEvent(isExpanded ? null : i)}
                      aria-label={isExpanded ? 'Collapse event details' : 'Expand event details'}
                    >
                      <span className="text-base mt-0.5 shrink-0">{eventIcon(event.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">{eventLabel(event)}</p>
                        {event.sessionId && (
                          <p className="text-xs text-gray-600 font-mono mt-0.5 truncate">
                            {event.sessionId}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 mt-0.5">
                        <span className="text-xs text-gray-600 font-mono">
                          {relativeTime(event.ts)}
                        </span>
                        <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.30)' }}>{isExpanded ? '▾' : '▸'}</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 pb-3 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                        <pre
                          className="text-[11px] font-mono rounded-lg p-3 overflow-auto max-h-48"
                          style={{ background: 'rgba(5,10,15,0.70)', border: '1px solid rgba(0,229,255,0.08)', color: '#94adc4', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                        >
                          {JSON.stringify(event, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

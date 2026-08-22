import { useState, useEffect } from 'react'
import { AgentCard } from '../components/AgentCard'
import { AgentEditor } from '../components/AgentEditor'
import { EmptyState } from '../components/ui/EmptyState.js'
import type { NavPage } from '../components/SideNav'

interface Agent {
  id: string; name: string; role: string; tools: string[]; builtIn: boolean; active: boolean; voice?: string
}

interface Binding {
  sessionPattern?: string
  source?: string
  priority: number
}

function adminHeaders(): Record<string, string> {
  const session = sessionStorage.getItem('cc_admin_session') ?? ''
  return session ? { 'x-admin-session': session } : {}
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const PANEL_STYLE = {
  background: 'rgba(13,31,51,0.80)',
  border: '1px solid rgba(0,229,255,0.20)',
  borderRadius: '12px',
  padding: '20px',
} as const

// ── Credentials panel ─────────────────────────────────────────────
function CredentialsPanel({ agentId, agentName, onClose }: { agentId: string; agentName: string; onClose: () => void }) {
  const [, setCreds] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<Array<{ key: string; value: string; visible?: boolean }>>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/agents/${agentId}/credentials`, { headers: adminHeaders() })
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        setCreds(data)
        setRows(Object.entries(data).map(([key, value]) => ({ key, value })))
      })
      .catch(() => {})
  }, [agentId])

  const save = async () => {
    setSaving(true)
    const credentials: Record<string, string> = {}
    for (const row of rows) {
      if (row.key.trim()) credentials[row.key.trim()] = row.value
    }
    await fetch(`/api/admin/agents/${agentId}/credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ credentials }),
    })
    setCreds(credentials)
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.70)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ ...PANEL_STYLE, width: '100%', maxWidth: '480px', fontFamily: 'Space Grotesk, sans-serif' }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-xs font-mono" style={{ color: '#00e5ff', letterSpacing: '0.08em' }}>CREDENTIALS</p>
            <p className="text-sm font-bold text-white mt-0.5">{agentName}</p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-lg">✕</button>
        </div>

        <div className="space-y-2 mb-4">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2">
              <input
                placeholder="KEY"
                value={row.key}
                onChange={e => setRows(r => r.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                className="flex-1 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none"
                style={{ background: 'rgba(10,22,40,0.90)', border: '1px solid rgba(0,229,255,0.20)', color: '#e2e8f0' }}
              />
              <div className="flex flex-1 relative">
                <input
                  placeholder="value"
                  value={row.value}
                  type={row.visible ? 'text' : 'password'}
                  onChange={e => setRows(r => r.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                  className="flex-1 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none"
                  style={{ background: 'rgba(10,22,40,0.90)', border: '1px solid rgba(0,229,255,0.20)', color: '#e2e8f0', paddingRight: '28px', width: '100%' }}
                />
                <button
                  type="button"
                  onClick={() => setRows(r => r.map((x, j) => j === i ? { ...x, visible: !x.visible } : x))}
                  title={row.visible ? 'Hide value' : 'Show value'}
                  style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: row.visible ? '#00e5ff' : '#4a5568', cursor: 'pointer', fontSize: '12px', padding: '2px' }}
                >
                  {row.visible ? '◑' : '○'}
                </button>
              </div>
              <button onClick={() => setRows(r => r.filter((_, j) => j !== i))} className="text-red-700 hover:text-red-400 text-xs px-1">✕</button>
            </div>
          ))}
        </div>

        <button
          onClick={() => setRows(r => [...r, { key: '', value: '' }])}
          className="text-xs font-mono mb-5"
          style={{ color: '#00e5ff' }}
        >
          + Add key
        </button>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="text-xs font-mono text-gray-600 hover:text-gray-400">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-xs font-mono font-bold transition-all"
            style={{ background: '#00e5ff', color: '#050a0f' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bindings panel ────────────────────────────────────────────────
function BindingsPanel({ agentId, agentName, onClose }: { agentId: string; agentName: string; onClose: () => void }) {
  const [bindings, setBindings] = useState<Binding[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/agents/${agentId}`, { headers: adminHeaders() })
      .then(r => r.json())
      .then((a: { bindings?: Binding[] }) => setBindings(a.bindings ?? []))
      .catch(() => {})
  }, [agentId])

  const update = (i: number, patch: Partial<Binding>) =>
    setBindings(b => b.map((x, j) => j === i ? { ...x, ...patch } : x))

  const save = async () => {
    setSaving(true)
    await fetch(`/api/admin/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ bindings }),
    })
    setSaving(false)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.70)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ ...PANEL_STYLE, width: '100%', maxWidth: '560px', fontFamily: 'Space Grotesk, sans-serif' }}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-xs font-mono" style={{ color: '#00e5ff', letterSpacing: '0.08em' }}>ROUTING BINDINGS</p>
            <p className="text-sm font-bold text-white mt-0.5">{agentName}</p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-lg">✕</button>
        </div>
        <p className="text-xs mb-5" style={{ color: '#94adc4' }}>
          Binding rules bypass domain routing. Higher priority = evaluated first.
        </p>

        {bindings.length === 0 && (
          <p className="text-xs font-mono text-gray-600 mb-4">No bindings — add one below.</p>
        )}

        <div className="space-y-3 mb-4">
          {bindings.map((b, i) => (
            <div key={i} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'rgba(10,22,40,0.60)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex gap-2">
                <input
                  placeholder="sessionPattern (regex)"
                  value={b.sessionPattern ?? ''}
                  onChange={e => update(i, { sessionPattern: e.target.value || undefined })}
                  className="flex-1 rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
                  style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' }}
                />
                <input
                  placeholder="x-source exact"
                  value={b.source ?? ''}
                  onChange={e => update(i, { source: e.target.value || undefined })}
                  className="flex-1 rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
                  style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' }}
                />
                <input
                  placeholder="priority"
                  type="number"
                  value={b.priority}
                  onChange={e => update(i, { priority: Number(e.target.value) })}
                  className="w-20 rounded px-2 py-1.5 text-xs font-mono focus:outline-none"
                  style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' }}
                />
                <button onClick={() => setBindings(b => b.filter((_, j) => j !== i))} className="text-red-700 hover:text-red-400 text-xs px-1">✕</button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => setBindings(b => [...b, { priority: 10 }])}
          className="text-xs font-mono mb-5"
          style={{ color: '#00e5ff' }}
        >
          + Add rule
        </button>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="text-xs font-mono text-gray-600 hover:text-gray-400">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-xs font-mono font-bold transition-all"
            style={{ background: '#00e5ff', color: '#050a0f' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export function Agents({ onNav: _onNav }: { onNav: (page: NavPage) => void }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [editSoul, setEditSoul] = useState('')
  const [adding, setAdding] = useState(false)
  const [credAgentId, setCredAgentId] = useState<string | null>(null)
  const [bindAgentId, setBindAgentId] = useState<string | null>(null)

  const load = async () => {
    try {
      setLoadError(null)
      const res = await fetch('/api/admin/agents', { headers: adminHeaders() })
      if (res.status === 401) { setLoadError('Session expired — please log out and sign in again'); return }
      if (!res.ok) { setLoadError(`Failed to load agents (HTTP ${res.status})`); return }
      setAgents(await res.json())
    } catch (err: unknown) {
      setLoadError(errorMessage(err) || 'Network error — is the server running?')
    }
  }

  useEffect(() => { load() }, [])

  const handleEdit = async (a: Agent) => {
    setAdding(false)
    try {
      const res = await fetch(`/api/admin/agents/${a.id}/soul`, { headers: adminHeaders() })
      const data = res.ok ? await res.json() as { soul: string } : { soul: '' }
      setEditSoul(data.soul ?? '')
    } catch {
      setEditSoul('')
    }
    setEditing(a)
  }

  const handleSave = async (data: { name: string; role: string; soul: string; tools: string[]; voice: string }) => {
    try {
      const url = editing ? `/api/admin/agents/${editing.id}` : '/api/admin/agents'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Server returned ${res.status}: ${text}`)
      }
      setEditing(null)
      setEditSoul('')
      setAdding(false)
      load()
    } catch (e: unknown) {
      alert(`Failed to save agent: ${errorMessage(e)}`)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this agent?')) return
    try {
      const res = await fetch(`/api/admin/agents/${id}`, {
        method: 'DELETE',
        headers: adminHeaders(),
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      load()
    } catch (e: unknown) {
      alert(`Failed to delete agent: ${errorMessage(e)}`)
    }
  }

  const handleToggle = async (id: string, active: boolean) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, active } : a))
    const res = await fetch(`/api/admin/agents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ active }),
    })
    if (!res.ok) {
      setAgents(prev => prev.map(a => a.id === id ? { ...a, active: !active } : a))
    }
  }

  const credAgent = credAgentId ? agents.find(a => a.id === credAgentId) : null
  const bindAgent = bindAgentId ? agents.find(a => a.id === bindAgentId) : null

  return (
    <div className="min-h-screen text-white" style={{ background: '#050a0f' }}>

      {credAgent && (
        <CredentialsPanel agentId={credAgent.id} agentName={credAgent.name} onClose={() => setCredAgentId(null)} />
      )}
      {bindAgent && (
        <BindingsPanel agentId={bindAgent.id} agentName={bindAgent.name} onClose={() => setBindAgentId(null)} />
      )}

      <div className="pt-20 pb-12 px-4 sm:px-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8 animate-slide-up">
          <div className="flex items-center gap-3">
            <span style={{ color: '#00e5ff', fontSize: '24px', lineHeight: 1 }}>✳</span>
            <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}>
              AI Agents
            </h1>
          </div>
          {!adding && !editing && (
            <button
              onClick={() => setAdding(true)}
              className="px-4 py-2 text-black font-bold rounded-lg text-sm transition-all"
              style={{ background: '#00e5ff', fontFamily: 'Space Grotesk, sans-serif' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = '#00bfea'; (e.target as HTMLElement).style.boxShadow = '0 0 20px rgba(0,229,255,0.30)' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = '#00e5ff'; (e.target as HTMLElement).style.boxShadow = 'none' }}
            >
              + New Agent
            </button>
          )}
        </div>

        {(adding || editing) && (
          <div className="mb-8 animate-fade-in rounded-xl overflow-hidden" style={{ background: 'rgba(13,31,51,0.80)', border: '1px solid rgba(0,229,255,0.20)' }}>
            <div className="px-6 py-3 flex items-center gap-2" style={{ background: 'rgba(0,229,255,0.06)', borderBottom: '1px solid rgba(0,229,255,0.12)' }}>
              <span style={{ color: '#00e5ff' }}>✳</span>
              <span className="text-sm font-bold" style={{ color: '#00e5ff', fontFamily: 'Space Grotesk, sans-serif' }}>
                {editing ? 'Edit Agent' : 'New Agent'}
              </span>
            </div>
            <div className="p-6">
              <AgentEditor
                initial={editing ? { ...editing, soul: editSoul, voice: editing.voice ?? '' } : undefined}
                onSave={handleSave}
                onCancel={() => { setAdding(false); setEditing(null); setEditSoul('') }}
              />
            </div>
          </div>
        )}

        {loadError ? (
          <div className="rounded-xl px-6 py-5 text-sm font-mono" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
            {loadError}
          </div>
        ) : agents.length === 0 ? (
          <EmptyState
            icon="✳"
            title="No agents configured"
            description="Agents are AI assistants with specific roles, tools, and personalities. Create your first agent to get started."
            action={{ label: '+ Create your first agent', onClick: () => setAdding(true) }}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {agents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onToggle={handleToggle}
                onCredentials={id => setCredAgentId(id)}
                onBindings={id => setBindAgentId(id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { EmptyState } from '../components/ui/EmptyState.js'
import type { NavPage } from '../components/SideNav'

interface Skill {
  id: string
  name: string
  description: string
  prompt: string
  agentId: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

function adminHeaders(): Record<string, string> {
  const session = sessionStorage.getItem('cc_admin_session') ?? ''
  return session ? { 'x-admin-session': session } : {}
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const EMPTY = { name: '', description: '', prompt: '', agentId: 'general' }

const PLACEHOLDER_PROMPT = `Summarize the following in 3 bullet points:

{{text}}

Be concise and focus on the key takeaways.`

// Extract {{variable}} slots from a prompt template
function extractVars(prompt: string): string[] {
  const matches = [...prompt.matchAll(/\{\{(\w+)\}\}/g)]
  return [...new Set(matches.map(m => m[1]))]
}

export function Skills({ onNav: _onNav }: { onNav: (page: NavPage) => void }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({})

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/skills', { headers: adminHeaders() })
      if (res.ok) setSkills(await res.json())
    } catch (e) {
      console.warn('[Skills] Failed to load skills:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openNew = () => {
    setForm({ ...EMPTY, prompt: PLACEHOLDER_PROMPT })
    setEditingId(null)
    setShowForm(true)
    setError('')
    setPreviewVars({})
  }

  const openEdit = (s: Skill) => {
    setForm({ name: s.name, description: s.description, prompt: s.prompt, agentId: s.agentId })
    setEditingId(s.id)
    setShowForm(true)
    setError('')
    setPreviewVars({})
  }

  const cancel = () => { setShowForm(false); setEditingId(null); setError('') }

  const save = async () => {
    if (!form.name || !form.description || !form.prompt) {
      setError('Name, description, and prompt are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const url = editingId ? `/api/admin/skills/${editingId}` : '/api/admin/skills'
      const method = editingId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = 'Save failed'
        try { const j = JSON.parse(text); if (j.error) msg = j.error } catch { /* fall back to default msg */ }
        throw new Error(msg)
      }
      cancel()
      load()
    } catch (e: unknown) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this skill?')) return
    await fetch(`/api/admin/skills/${id}`, { method: 'DELETE', headers: adminHeaders() })
    load()
  }

  const toggle = async (s: Skill) => {
    await fetch(`/api/admin/skills/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ enabled: !s.enabled }),
    })
    load()
  }

  const promptVars = extractVars(form.prompt)

  const resolvedPreview = form.prompt.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    previewVars[key] ? `[${previewVars[key]}]` : `[${key}]`
  )

  return (
    <div className="min-h-screen text-white" style={{ background: '#050a0f' }}>

      <div className="pt-20 pb-12 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Skill Library</h1>
            <p className="text-sm text-gray-500 mt-1">
              Reusable prompt templates · trigger with <code className="text-cyan-500">/skill-name</code> in chat
            </p>
          </div>
          {!showForm && (
            <button
              onClick={openNew}
              className="px-4 py-2 bg-cyan-500/10 border border-cyan-500 hover:bg-cyan-500/20 text-cyan-400 font-mono rounded-md text-sm transition-all"
            >
              + New Skill
            </button>
          )}
        </div>

        {/* Editor */}
        {showForm && (
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/3 p-5 mb-6">
            <h2 className="text-sm font-mono text-cyan-400 mb-5">
              {editingId ? 'EDIT SKILL' : 'NEW SKILL'}
            </h2>

            <div className="grid sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">
                  Name <span className="text-gray-600">(becomes /name)</span>
                </label>
                <input
                  className="w-full bg-black/30 border border-white/8 text-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/50 font-mono"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') }))}
                  placeholder="summarize"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Description</label>
                <input
                  className="w-full bg-black/30 border border-white/8 text-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/50"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Summarizes text into 3 bullet points"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Agent</label>
                <input
                  className="w-full bg-black/30 border border-white/8 text-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/50 font-mono"
                  value={form.agentId}
                  onChange={e => setForm(f => ({ ...f, agentId: e.target.value }))}
                  placeholder="general"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-gray-500 mb-1.5">
                Prompt template
                <span className="ml-2 text-gray-600">— use <code className="text-cyan-600/80">{`{{variable}}`}</code> for user-filled slots</span>
              </label>
              <textarea
                rows={8}
                className="w-full bg-black/30 border border-white/8 text-gray-200 rounded-lg px-3 py-2.5 font-mono text-xs focus:outline-none focus:border-cyan-500/50 resize-y"
                value={form.prompt}
                onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
                placeholder={PLACEHOLDER_PROMPT}
              />
            </div>

            {/* Variable preview */}
            {promptVars.length > 0 && (
              <div className="mb-4 rounded-lg border border-white/5 bg-black/20 p-4">
                <p className="text-xs text-gray-500 mb-3 font-mono">
                  DETECTED VARIABLES — fill in to preview the resolved prompt:
                </p>
                <div className="grid sm:grid-cols-2 gap-2 mb-3">
                  {promptVars.map(v => (
                    <div key={v} className="flex items-center gap-2">
                      <span className="text-xs font-mono text-cyan-600/80 w-24 shrink-0">{`{{${v}}}`}</span>
                      <input
                        className="flex-1 bg-black/40 border border-white/8 text-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-cyan-500/30"
                        placeholder={`value for ${v}`}
                        value={previewVars[v] ?? ''}
                        onChange={e => setPreviewVars(p => ({ ...p, [v]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
                <pre className="text-[10px] font-mono text-gray-500 bg-black/30 rounded p-3 whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {resolvedPreview}
                </pre>
              </div>
            )}

            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

            <div className="flex gap-3">
              <button onClick={cancel} className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !form.name || !form.description || !form.prompt}
                className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-30 text-black font-semibold rounded-lg text-sm transition-colors"
              >
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Create skill'}
              </button>
            </div>
          </div>
        )}

        {/* Skill list */}
        {loading ? (
          <div className="text-cyan-500 font-mono text-sm animate-pulse">Loading skills...</div>
        ) : skills.length === 0 && !showForm ? (
          <EmptyState
            icon="⚡"
            title="No skills yet"
            description="Skills are reusable, one-click prompts that appear in chat. Create your first skill to speed up common tasks."
            action={{ label: '+ Create your first skill', onClick: () => setShowForm(true) }}
          />
        ) : (
          <div className="space-y-3">
            {skills.map(s => (
              <div
                key={s.id}
                className={`rounded-xl border p-4 transition-all ${s.enabled ? 'border-white/8' : 'border-white/4 opacity-50'}`}
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono text-sm text-cyan-400">/{s.name}</span>
                      <span className="text-[10px] font-mono text-gray-600 border border-gray-800 rounded px-1.5 py-0.5">
                        agent: {s.agentId}
                      </span>
                      {!s.enabled && (
                        <span className="text-[10px] font-mono text-amber-600 border border-amber-900/40 rounded px-1.5 py-0.5">
                          disabled
                        </span>
                      )}
                      {extractVars(s.prompt).length > 0 && (
                        <span className="text-[10px] font-mono text-cyan-600/60 border border-cyan-900/30 rounded px-1.5 py-0.5">
                          {extractVars(s.prompt).length} var{extractVars(s.prompt).length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{s.description}</p>
                    <pre className="text-[10px] font-mono text-gray-600 bg-black/20 rounded px-3 py-2 truncate">
                      {s.prompt.split('\n')[0]}
                    </pre>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggle(s)}
                      className="text-xs font-mono text-gray-600 hover:text-yellow-400 transition-colors"
                    >
                      {s.enabled ? 'disable' : 'enable'}
                    </button>
                    <button
                      onClick={() => openEdit(s)}
                      className="text-xs font-mono text-cyan-600 hover:text-cyan-400 transition-colors"
                    >
                      edit
                    </button>
                    <button
                      onClick={() => remove(s.id)}
                      className="text-xs font-mono text-red-600 hover:text-red-400 transition-colors"
                    >
                      delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

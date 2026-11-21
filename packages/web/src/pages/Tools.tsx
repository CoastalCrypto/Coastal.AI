import { useState, useEffect } from 'react'
import { coreClient } from '../api/client'
import { EmptyState } from '../components/ui/EmptyState.js'
import type { NavPage } from '../components/SideNav'

interface CustomTool {
  id: string
  name: string
  description: string
  parameters: string
  implBody: string
  enabled: number
  createdAt: number
  updatedAt: number
}

const EMPTY_TOOL = { name: '', description: '', parameters: '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}', implBody: '' }

const EXAMPLE_IMPL = `// 'args' contains the tool arguments
// Return a string result or use console.log()
const { query } = args
return \`You asked: \${query}\``

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function ToolCard({ tool, onEdit, onDelete, onToggle }: {
  tool: CustomTool
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  return (
    <div className={`rounded-xl border p-4 card-hover transition-all ${tool.enabled ? 'border-white/8 surface-panel' : 'border-white/4 opacity-50'}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-cyan-400">{tool.name}</span>
            {!tool.enabled && <span className="badge badge-amber">disabled</span>}
          </div>
          <p className="text-xs text-gray-500 mt-1 truncate">{tool.description}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={onToggle} className="text-xs font-mono text-gray-600 hover:text-gray-400 transition-colors">
            {tool.enabled ? 'disable' : 'enable'}
          </button>
          <button onClick={onEdit} className="text-xs font-mono text-cyan-600 hover:text-cyan-400 transition-colors">edit</button>
          <button onClick={onDelete} className="text-xs font-mono text-red-600 hover:text-red-400 transition-colors">delete</button>
        </div>
      </div>
      <div className="text-xs font-mono text-gray-600 bg-black/20 rounded px-3 py-2 mt-2 overflow-hidden">
        <div className="truncate">{tool.implBody.split('\n')[0]}</div>
      </div>
    </div>
  )
}

export function Tools({ onNav: _onNav }: { onNav: (page: NavPage) => void }) {
  const [tools, setTools] = useState<CustomTool[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CustomTool | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(EMPTY_TOOL)
  const [testArgs, setTestArgs] = useState('{}')
  const [testResult, setTestResult] = useState<{ output: string; success: boolean } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const ta = 'w-full bg-black/30 border border-white/8 text-gray-200 rounded-lg px-3 py-2.5 font-mono text-xs focus:outline-none focus:border-cyan-500/50 resize-none'
  const inp = 'w-full bg-black/30 border border-white/8 text-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/50'

  const load = () => {
    coreClient.listTools()
      .then(setTools)
      .catch(() => setError('Could not load tools'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openCreate = () => { setForm({ ...EMPTY_TOOL, implBody: EXAMPLE_IMPL }); setCreating(true); setEditing(null); setTestResult(null) }
  const openEdit = (t: CustomTool) => { setForm({ name: t.name, description: t.description, parameters: t.parameters, implBody: t.implBody }); setEditing(t); setCreating(false); setTestResult(null) }
  const closeForm = () => { setCreating(false); setEditing(null); setError('') }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      if (editing) {
        await coreClient.updateTool(editing.id, form)
      } else {
        await coreClient.createTool(form)
      }
      closeForm()
      load()
    } catch (e: unknown) {
      setError(errorMessage(e) || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this tool?')) return
    await coreClient.deleteTool(id)
    load()
  }

  const handleToggle = async (t: CustomTool) => {
    await coreClient.updateTool(t.id, { enabled: !t.enabled })
    load()
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(testArgs) } catch { /* invalid JSON, run with empty args */ }
      const result = await coreClient.testTool({ implBody: form.implBody, parameters: form.parameters, args })
      setTestResult(result)
    } catch (e: unknown) {
      setTestResult({ output: errorMessage(e), success: false })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="min-h-screen text-white" style={{ background: '#050a0f' }}>

      <div className="pt-20 pb-12 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Tool Builder</h1>
            <p className="text-sm text-gray-500 mt-1">
              Write custom tools in JavaScript · sandboxed execution
            </p>
          </div>
          <button onClick={openCreate} className="btn-primary text-sm">+ New Tool</button>
        </div>

        {/* Editor / form */}
        {(creating || editing) && (
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/3 p-5 mb-6 animate-slide-up">
            <h2 className="text-sm font-semibold mb-4 text-cyan-400">
              {editing ? `Editing: ${editing.name}` : 'New Tool'}
            </h2>

            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Name <span className="text-gray-600">(no spaces)</span></label>
                <input className={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.replace(/\s/g,'_') }))} placeholder="my_tool" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Description</label>
                <input className={inp} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What does this tool do?" />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-gray-500 mb-1.5">
                Parameters <span className="text-gray-600">(JSON Schema)</span>
              </label>
              <textarea className={ta} rows={5} value={form.parameters} onChange={e => setForm(f => ({ ...f, parameters: e.target.value }))} />
            </div>

            <div className="mb-4">
              <label className="block text-xs text-gray-500 mb-1.5">
                Implementation <span className="text-gray-600">(JS function body · <code>args</code> is available · return a string)</span>
              </label>
              <textarea className={ta} rows={8} value={form.implBody} onChange={e => setForm(f => ({ ...f, implBody: e.target.value }))} placeholder={EXAMPLE_IMPL} />
            </div>

            {/* Test runner */}
            <div className="border-t border-white/5 pt-4 mb-4">
              <label className="block text-xs text-gray-500 mb-1.5">Test args (JSON)</label>
              <div className="flex gap-2">
                <input className={`${inp} flex-1 font-mono text-xs`} value={testArgs} onChange={e => setTestArgs(e.target.value)} placeholder='{"query": "hello"}' />
                <button onClick={handleTest} disabled={testing || !form.implBody} className="btn-ghost text-xs shrink-0 disabled:opacity-40">
                  {testing ? 'running...' : '▶ Run'}
                </button>
              </div>
              {testResult && (
                <div className={`mt-2 rounded-lg px-3 py-2 font-mono text-xs ${testResult.success ? 'bg-emerald-500/8 border border-emerald-500/20 text-emerald-300' : 'bg-red-500/8 border border-red-500/20 text-red-300'}`}>
                  {testResult.output}
                </div>
              )}
            </div>

            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

            <div className="flex gap-3">
              <button onClick={closeForm} className="btn-ghost text-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name || !form.description || !form.implBody} className="btn-primary text-sm disabled:opacity-40">
                {saving ? 'Saving...' : (editing ? 'Save changes' : 'Create tool')}
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-3">
              ⚠ New tools are available to the agent after the server restarts.
            </p>
          </div>
        )}

        {/* Tool list */}
        {loading ? (
          <div className="text-cyan-500 font-mono text-sm animate-pulse">Loading tools...</div>
        ) : tools.length === 0 ? (
          <EmptyState
            icon="🔧"
            title="No custom tools yet"
            description="Tools extend what your agents can do — fetch URLs, query databases, call APIs, and more."
            action={{ label: '+ Create your first tool', onClick: () => setCreating(true) }}
          />
        ) : (
          <div className="space-y-3">
            {tools.map(t => (
              <ToolCard
                key={t.id}
                tool={t}
                onEdit={() => openEdit(t)}
                onDelete={() => handleDelete(t.id)}
                onToggle={() => handleToggle(t)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

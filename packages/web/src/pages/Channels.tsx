import { useState, useEffect } from 'react'
import { coreClient } from '../api/client'
import { EmptyState } from '../components/ui/EmptyState.js'

type ChannelType = 'telegram' | 'discord' | 'slack' | 'zapier'

interface ChannelRecord {
  id: string; type: ChannelType; name: string
  enabled: number; createdAt: number; updatedAt: number
}

const CHANNEL_META: Record<ChannelType, { label: string; icon: string; color: string; fields: Field[] }> = {
  telegram: {
    label: 'Telegram', icon: '✈️', color: '#2CA5E0',
    fields: [
      { key: 'botToken', label: 'Bot Token', placeholder: '123456:ABC-DEF...', secret: true },
      { key: 'chatId',   label: 'Chat ID',   placeholder: '-1001234567890' },
    ],
  },
  discord: {
    label: 'Discord', icon: '🎮', color: '#5865F2',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...', secret: true },
      { key: 'username',   label: 'Bot name (optional)', placeholder: 'Coastal.AI' },
    ],
  },
  slack: {
    label: 'Slack', icon: '💬', color: '#4A154B',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...', secret: true },
      { key: 'channel',    label: 'Channel (optional)', placeholder: '#general' },
      { key: 'username',   label: 'Bot name (optional)', placeholder: 'Coastal.AI' },
      { key: 'iconEmoji',  label: 'Icon emoji (optional)', placeholder: ':robot_face:' },
    ],
  },
  zapier: {
    label: 'Zapier', icon: '⚡', color: '#FF4A00',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.zapier.com/hooks/catch/...', secret: true },
    ],
  },
}

interface Field { key: string; label: string; placeholder: string; secret?: boolean }

const TYPES = Object.keys(CHANNEL_META) as ChannelType[]

function TypeBadge({ type }: { type: ChannelType }) {
  const meta = CHANNEL_META[type]
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ background: meta.color + '20', color: meta.color, border: `1px solid ${meta.color}40` }}>
      {meta.icon} {meta.label}
    </span>
  )
}

function ChannelCard({ ch, onEdit, onDelete, onToggle, onTest }: {
  ch: ChannelRecord
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
  onTest: () => void
}) {
  return (
    <div className={`rounded-xl border p-4 card-hover ${ch.enabled ? 'border-white/8 surface-panel' : 'border-white/4 opacity-50'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <TypeBadge type={ch.type} />
          <span className="text-sm font-semibold text-white truncate">{ch.name}</span>
          {!ch.enabled && <span className="badge badge-amber text-[10px]">off</span>}
        </div>
        <div className="flex gap-2 shrink-0 font-mono text-xs">
          <button onClick={onTest}   className="text-cyan-600 hover:text-cyan-400 transition-colors">test</button>
          <button onClick={onToggle} className="text-gray-600 hover:text-gray-400 transition-colors">{ch.enabled ? 'disable' : 'enable'}</button>
          <button onClick={onEdit}   className="text-gray-500 hover:text-gray-300 transition-colors">edit</button>
          <button onClick={onDelete} className="text-red-700 hover:text-red-500 transition-colors">delete</button>
        </div>
      </div>
    </div>
  )
}

export function Channels({ onNav }: { onNav: (page: NavPage) => void }) {
  const [channels, setChannels] = useState<ChannelRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ChannelRecord | null>(null)
  const [creating, setCreating] = useState(false)

  const [formType, setFormType] = useState<ChannelType>('discord')
  const [formName, setFormName] = useState('')
  const [formConfig, setFormConfig] = useState<Record<string, string>>({})

  const [testMsg, setTestMsg] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; error?: string }>>({})
  const [broadcasting, setBroadcasting] = useState(false)
  const [broadcastMsg, setBroadcastMsg] = useState('')
  const [broadcastResult, setBroadcastResult] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const inp = 'w-full bg-black/30 border border-white/8 text-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/50'

  const load = () => {
    coreClient.listChannels()
      .then(setChannels)
      .catch(() => setError('Could not load channels'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setFormType('discord'); setFormName(''); setFormConfig({})
    setCreating(true); setEditing(null); setError('')
  }

  const openEdit = (ch: ChannelRecord) => {
    setFormType(ch.type); setFormName(ch.name); setFormConfig({})
    setEditing(ch); setCreating(false); setError('')
  }

  const closeForm = () => { setCreating(false); setEditing(null); setError('') }

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      if (editing) {
        await coreClient.updateChannel(editing.id, { name: formName, config: formConfig })
      } else {
        await coreClient.createChannel({ type: formType, name: formName, config: formConfig })
      }
      closeForm(); load()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this channel?')) return
    await coreClient.deleteChannel(id); load()
  }

  const handleToggle = async (ch: ChannelRecord) => {
    await coreClient.updateChannel(ch.id, { enabled: !ch.enabled }); load()
  }

  const handleTest = async (id: string) => {
    setTestingId(id)
    try {
      const r = await coreClient.testChannel(id, testMsg || undefined)
      setTestResult(prev => ({ ...prev, [id]: r }))
    } catch (e: any) {
      setTestResult(prev => ({ ...prev, [id]: { success: false, error: e.message } }))
    } finally { setTestingId(null) }
  }

  const handleBroadcast = async () => {
    if (!broadcastMsg.trim()) return
    setBroadcasting(true); setBroadcastResult('')
    try {
      const results = await coreClient.broadcastChannels(broadcastMsg)
      const ok  = results.filter((r: any) => r.success).length
      const fail = results.filter((r: any) => !r.success).length
      setBroadcastResult(`Sent to ${ok} channel${ok !== 1 ? 's' : ''}${fail ? `, ${fail} failed` : ''}`)
    } catch (e: any) { setBroadcastResult(`Error: ${e.message}`) }
    finally { setBroadcasting(false) }
  }

  const fields = CHANNEL_META[formType].fields

  return (
    <div className="min-h-screen text-white" style={{ background: '#050a0f' }}>

      <div className="pt-20 pb-12 px-4 sm:px-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Output Channels</h1>
            <p className="text-sm text-gray-500 mt-1">Send agent messages to Telegram, Discord, Slack, or Zapier</p>
          </div>
          <button onClick={openCreate} className="btn-primary text-sm">+ Add Channel</button>
        </div>

        {/* Broadcast bar */}
        {channels.some(c => c.enabled) && (
          <div className="rounded-xl border border-white/8 surface-panel p-4 mb-6">
            <p className="text-xs font-mono text-gray-500 mb-3 tracking-wider">BROADCAST TO ALL ENABLED</p>
            <div className="flex gap-2">
              <input className={`${inp} flex-1`} value={broadcastMsg} onChange={e => setBroadcastMsg(e.target.value)}
                placeholder="Send a message to all enabled channels..." onKeyDown={e => e.key === 'Enter' && handleBroadcast()} />
              <button onClick={handleBroadcast} disabled={broadcasting || !broadcastMsg.trim()}
                className="btn-primary text-sm shrink-0 disabled:opacity-40">
                {broadcasting ? '...' : '→ Send'}
              </button>
            </div>
            {broadcastResult && <p className="text-xs text-gray-400 mt-2 font-mono">{broadcastResult}</p>}
          </div>
        )}

        {/* Channel form */}
        {(creating || editing) && (
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/3 p-5 mb-6 animate-slide-up">
            <h2 className="text-sm font-semibold mb-4 text-cyan-400">{editing ? `Edit: ${editing.name}` : 'New Channel'}</h2>

            {/* Type selector (only on create) */}
            {creating && (
              <div className="mb-4">
                <label className="block text-xs text-gray-500 mb-2">Channel type</label>
                <div className="flex flex-wrap gap-2">
                  {TYPES.map(t => (
                    <button key={t} onClick={() => { setFormType(t); setFormConfig({}) }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                        formType === t
                          ? 'border-current opacity-100'
                          : 'border-white/8 text-gray-500 hover:text-gray-300 hover:border-white/15'
                      }`}
                      style={formType === t ? { color: CHANNEL_META[t].color, background: CHANNEL_META[t].color + '15' } : {}}>
                      {CHANNEL_META[t].icon} {CHANNEL_META[t].label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-xs text-gray-500 mb-1.5">Display name</label>
              <input className={inp} value={formName} onChange={e => setFormName(e.target.value)}
                placeholder={`My ${CHANNEL_META[formType].label} channel`} />
            </div>

            {fields.map(f => (
              <div key={f.key} className="mb-4">
                <label className="block text-xs text-gray-500 mb-1.5">
                  {f.label}
                  {f.secret && <span className="text-gray-600 ml-1">(stored encrypted)</span>}
                </label>
                <input className={`${inp} ${f.secret ? 'font-mono text-xs' : ''}`}
                  type={f.secret ? 'password' : 'text'}
                  value={formConfig[f.key] ?? ''}
                  onChange={e => setFormConfig(c => ({ ...c, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  autoComplete="off"
                />
              </div>
            ))}

            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

            <div className="flex gap-3">
              <button onClick={closeForm} className="btn-ghost text-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving || !formName}
                className="btn-primary text-sm disabled:opacity-40">
                {saving ? 'Saving...' : editing ? 'Save changes' : 'Add channel'}
              </button>
            </div>
          </div>
        )}

        {/* Test message input */}
        {channels.length > 0 && (
          <div className="mb-4">
            <input className={`${inp} text-xs`} value={testMsg} onChange={e => setTestMsg(e.target.value)}
              placeholder="Custom test message (optional — leave blank for default)" />
          </div>
        )}

        {/* Channel list */}
        {loading ? (
          <div className="text-cyan-500 font-mono text-sm animate-pulse">Loading...</div>
        ) : channels.length === 0 ? (
          <EmptyState
            icon="📡"
            title="No output channels configured"
            description="Channels let agents send messages to Telegram, Discord, Slack, or Zapier webhooks. Add your first channel to route agent output."
            action={{ label: '+ Add your first channel', onClick: () => setCreating(true) }}
          />
        ) : (
          <div className="space-y-3">
            {channels.map(ch => (
              <div key={ch.id}>
                <ChannelCard ch={ch}
                  onEdit={() => openEdit(ch)}
                  onDelete={() => handleDelete(ch.id)}
                  onToggle={() => handleToggle(ch)}
                  onTest={() => handleTest(ch.id)}
                />
                {testingId === ch.id && (
                  <div className="mt-1 ml-4 text-xs font-mono text-gray-600 animate-pulse">Sending...</div>
                )}
                {testResult[ch.id] && (
                  <div className={`mt-1 ml-4 text-xs font-mono ${testResult[ch.id].success ? 'text-emerald-400' : 'text-red-400'}`}>
                    {testResult[ch.id].success ? '✓ Sent successfully' : `✗ ${testResult[ch.id].error}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

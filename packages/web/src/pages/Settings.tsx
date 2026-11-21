import { useState, useEffect } from 'react'
import { coreClient, type Persona } from '../api/client'
import type { NavPage } from '../components/SideNav'

type TrustLevel = 'sandboxed' | 'trusted' | 'autonomous'

const PERSONALITY_PRESETS = [
  { id: 'direct', label: 'Direct', desc: 'Concise, data-first, no filler.' },
  { id: 'collaborative', label: 'Collaborative', desc: 'Warm, asks clarifying questions, thinks out loud.' },
  { id: 'analytical', label: 'Analytical', desc: 'Structured, cites sources, hedges uncertainty explicitly.' },
  { id: 'custom', label: 'Custom', desc: 'Write your own personality.' },
]

const PERSONALITY_TEXT: Record<string, string> = {
  direct: 'Direct and concise. Lead with the answer. No filler, no preamble.',
  collaborative: 'Warm and collaborative. Ask one clarifying question when the request is ambiguous. Think out loud when reasoning through complex problems.',
  analytical: 'Analytical and precise. Cite sources. State uncertainty explicitly. Structure responses with headers and bullet points.',
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function detectPreset(personality: string): string {
  for (const [id, text] of Object.entries(PERSONALITY_TEXT)) {
    if (personality === text) return id
  }
  return personality ? 'custom' : ''
}

export function Settings({ onNav: _onNav }: { onNav: (page: NavPage) => void }) {
  const [persona, setPersona] = useState<Partial<Persona>>({})
  const [personalityPreset, setPersonalityPreset] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [trustLevel, setTrustLevel] = useState<TrustLevel>('trusted')
  const [trustSaving, setTrustSaving] = useState(false)
  const [trustSaved, setTrustSaved] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const input = 'w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-cyan-500'

  useEffect(() => {
    coreClient.getPersona()
      .then(({ persona: p }) => {
        setPersona(p)
        setPersonalityPreset(detectPreset(p.personality ?? ''))
      })
      .catch(() => setError('Could not load settings. Is coastal-server running?'))
      .finally(() => setLoading(false))
    coreClient.getTrustLevel().then(setTrustLevel).catch(() => {})
  }, [])

  const handlePreset = (id: string) => {
    setPersonalityPreset(id)
    if (id !== 'custom') setPersona((p) => ({ ...p, personality: PERSONALITY_TEXT[id] ?? '' }))
  }

  const handleTrustLevelChange = async (next: TrustLevel) => {
    const previous = trustLevel
    setTrustLevel(next)
    setTrustSaving(true)
    setTrustSaved(false)
    setError('')
    try {
      await coreClient.setTrustLevel(next)
      setTrustSaved(true)
      setTimeout(() => setTrustSaved(false), 3000)
    } catch (e: unknown) {
      setTrustLevel(previous)
      setError(`Failed to update trust level: ${errorMessage(e) || 'unknown error'}`)
    } finally {
      setTrustSaving(false)
    }
  }

  const handleRestart = async () => {
    setRestarting(true)
    try {
      await coreClient.restartServer()
      setTimeout(() => window.location.reload(), 5000)
    } catch (e: unknown) {
      setError(`Failed to restart server: ${errorMessage(e) || 'unknown error'}`)
      setRestarting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const { persona: updated } = await coreClient.setPersona(persona)
      setPersona(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Failed to save. Is coastal-server running?')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen text-white" style={{ background: '#050a0f' }}>

      <div className="pt-20 px-4 sm:px-6 max-w-xl mx-auto py-12">

        <div className="mb-10 p-5 rounded-xl border border-gray-700 bg-gray-900/50">
          <div className="flex flex-col gap-4">
            <div>
              <p className="font-semibold text-white">System File Access</p>
              <p className="text-sm text-gray-400 mt-1">
                {trustLevel === 'autonomous'
                  ? 'Agents can read and write anywhere on your system.'
                  : trustLevel === 'trusted'
                  ? 'Agents are restricted to their workspace folder.'
                  : 'Agents are heavily restricted and cannot access the filesystem.'}
              </p>
              {trustSaved && (
                <div className="mt-3 flex items-center gap-3">
                  <p className="text-xs text-yellow-400">Saved — restart the server for the change to take effect.</p>
                  <button
                    onClick={handleRestart}
                    disabled={restarting}
                    className="text-xs px-3 py-1 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-700 text-white rounded transition-colors"
                  >
                    {restarting ? 'Restarting…' : 'Restart Gateway'}
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <label htmlFor="trust-level-select" className="text-sm text-gray-400">Trust Level:</label>
              <select
                id="trust-level-select"
                className={`${input} w-auto`}
                value={trustLevel}
                onChange={(e) => handleTrustLevelChange(e.target.value as TrustLevel)}
                disabled={trustSaving}
              >
                <option value="sandboxed">Sandboxed</option>
                <option value="trusted">Trusted</option>
                <option value="autonomous">Autonomous</option>
              </select>
            </div>
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-1">Agent Persona</h1>
        <p className="text-gray-500 text-sm mb-8">Changes take effect on the next conversation.</p>

        {loading ? (
          <div className="text-cyan-500 font-mono text-sm animate-pulse">Loading...</div>
        ) : (
          <div className="space-y-5">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Agent name</label>
              <input
                className={input}
                value={persona.agentName ?? ''}
                onChange={(e) => setPersona((p) => ({ ...p, agentName: e.target.value }))}
                placeholder="JARVIS, Alex, Friday, Max..."
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Organization name</label>
              <input
                className={input}
                value={persona.orgName ?? ''}
                onChange={(e) => setPersona((p) => ({ ...p, orgName: e.target.value }))}
                placeholder="Acme Corp"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                What does your org do? <span className="text-gray-600">(optional)</span>
              </label>
              <textarea
                className={`${input} h-24 resize-none`}
                value={persona.orgContext ?? ''}
                onChange={(e) => setPersona((p) => ({ ...p, orgContext: e.target.value }))}
                placeholder="We run a 50-person SaaS company selling analytics software..."
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Your name <span className="text-gray-600">(optional)</span>
              </label>
              <input
                className={input}
                value={persona.ownerName ?? ''}
                onChange={(e) => setPersona((p) => ({ ...p, ownerName: e.target.value }))}
                placeholder="Tony"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-3">Personality</label>
              <div className="space-y-2">
                {PERSONALITY_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handlePreset(p.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      personalityPreset === p.id
                        ? 'border-cyan-500 bg-cyan-500/10 text-white'
                        : 'border-gray-700 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    <span className="font-semibold text-sm">{p.label}</span>
                    <span className="text-xs ml-2 opacity-60">{p.desc}</span>
                  </button>
                ))}
              </div>
              {personalityPreset === 'custom' && (
                <textarea
                  className={`${input} h-24 resize-none mt-3`}
                  value={persona.personality ?? ''}
                  onChange={(e) => setPersona((p) => ({ ...p, personality: e.target.value }))}
                  placeholder="Describe the personality in plain English..."
                  autoFocus
                />
              )}
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
            {saved && <p className="text-green-400 text-sm">Saved.</p>}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3 px-6 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold rounded-lg transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

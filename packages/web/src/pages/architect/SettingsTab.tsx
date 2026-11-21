import { useState, useEffect, useCallback } from 'react'
import {
  coreClient,
  type UserProfile,
  type UserProfilePatch,
  type PreferenceQuestion,
} from '../../api/client'

export function SettingsTab({ onStatusChange }: { onStatusChange: (s: { power: string; mode: string }) => void }) {
  const [status, setStatus] = useState<{ power: string; mode: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [questions, setQuestions] = useState<PreferenceQuestion[]>([])
  // Tracks which knob is currently saving so only that row dims, not the
  // whole panel. Empty string when idle.
  const [savingKnob, setSavingKnob] = useState<keyof UserProfilePatch | ''>('')

  const refreshStatus = useCallback(async () => {
    const s = await coreClient.architectStatus()
    setStatus(s); onStatusChange(s)
  }, [onStatusChange])

  useEffect(() => {
    Promise.all([
      coreClient.architectStatus(),
      coreClient.architectGetUserProfile(),
      coreClient.architectGetWizardQuestions(),
    ]).then(([s, p, q]) => {
      setStatus(s); setProfile(p); setQuestions(q.questions); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const setPower = async (state: 'on' | 'off') => {
    setActing(true)
    try {
      await coreClient.architectSetPower(state)
      await refreshStatus()
    } catch { /* best-effort UI action — keep last-known state on failure */ } finally { setActing(false) }
  }

  const setMode = async (mode: string) => {
    setActing(true)
    try {
      await coreClient.architectSetMode(mode)
      // Mode writes a preset into user_profile; refetch both so the
      // engagement-axis knobs and the derived mode badge stay coherent.
      const [s, p] = await Promise.all([
        coreClient.architectStatus(),
        coreClient.architectGetUserProfile(),
      ])
      setStatus(s); setProfile(p); onStatusChange(s)
    } catch { /* best-effort UI action — keep last-known state on failure */ } finally { setActing(false) }
  }

  const setKnob = async (key: keyof UserProfilePatch, value: string) => {
    if (!profile || profile[key] === value) return
    setSavingKnob(key)
    try {
      const updated = await coreClient.architectUpdateUserProfile({ [key]: value } as UserProfilePatch)
      setProfile(updated)
      // The change may have moved us off (or back onto) a mode preset;
      // refresh status so the Custom badge reflects current truth.
      await refreshStatus()
    } catch { /* knob update failed — leave the row showing the previous value */ } finally { setSavingKnob('') }
  }

  const runNow = async () => {
    setActing(true)
    try { await coreClient.architectRunNow() } catch { /* best-effort UI action */ } finally { setActing(false) }
  }

  if (loading) return <div className="animate-pulse font-mono text-xs text-cyan-400/60">loading settings...</div>

  const modes = [
    { id: 'hands-on', label: 'Hands-on', desc: 'See every change before it happens' },
    { id: 'hands-off', label: 'Hands-off', desc: 'Only see pull requests' },
    { id: 'autopilot', label: 'Autopilot', desc: "Don't ask me unless something breaks" },
  ]

  const isCustomMode = status?.mode === 'custom'

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-mono mb-2" style={{ color: '#94adc4' }}>Power</h3>
        <div className="flex gap-2">
          <button onClick={() => setPower('on')} disabled={acting || status?.power === 'on'}
            className={`text-xs font-mono px-4 py-2 rounded ${status?.power === 'on' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-400 hover:text-emerald-400'} disabled:opacity-40`}>
            ON
          </button>
          <button onClick={() => setPower('off')} disabled={acting || status?.power === 'off'}
            className={`text-xs font-mono px-4 py-2 rounded ${status?.power === 'off' ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-gray-400 hover:text-red-400'} disabled:opacity-40`}>
            OFF
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-mono mb-2 flex items-center gap-2" style={{ color: '#94adc4' }}>
          Mode
          {isCustomMode && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded"
              style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}
              title="Engagement-axis knobs (gating, auto-approve, test strictness) don't match any preset. Click a mode to snap back."
            >
              CUSTOM
            </span>
          )}
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {modes.map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} disabled={acting}
              className={`p-3 rounded-lg text-left transition-colors ${status?.mode === m.id ? 'ring-1 ring-cyan-500/40' : 'hover:bg-white/[0.02]'}`}
              style={{ background: '#0d1f33', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-xs font-semibold" style={{ color: status?.mode === m.id ? '#00e5ff' : '#e2f4ff' }}>{m.label}</p>
              <p className="text-[10px] mt-1" style={{ color: '#4a6a8a' }}>{m.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {profile && questions.length > 0 && (
        <div>
          <h3 className="text-xs font-mono mb-1" style={{ color: '#94adc4' }}>Preferences</h3>
          <p className="text-[10px] mb-3" style={{ color: '#4a6a8a' }}>
            Fine-grained controls. Adjusting Gate policy / Auto-approve / Test strictness
            will switch Mode to <span style={{ color: '#f59e0b' }}>CUSTOM</span>.
          </p>
          <div className="space-y-3">
            {questions.map(q => {
              const currentValue = profile[q.id] as string
              const saving = savingKnob === q.id
              return (
                <div key={q.id} style={{ background: '#0d1f33', border: '1px solid rgba(255,255,255,0.05)' }}
                     className={`p-3 rounded-lg ${saving ? 'opacity-60' : ''}`}>
                  <p className="text-[11px] font-semibold mb-2" style={{ color: '#e2f4ff' }}>{q.prompt}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map(opt => {
                      const selected = currentValue === opt.value
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setKnob(q.id, opt.value)}
                          disabled={saving}
                          title={opt.rationale}
                          className={`text-[10px] font-mono px-2.5 py-1 rounded transition-colors ${
                            selected
                              ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40'
                              : 'bg-white/[0.02] text-gray-400 hover:text-cyan-400 hover:bg-white/[0.04]'
                          } disabled:cursor-wait`}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-mono mb-2" style={{ color: '#94adc4' }}>Manual Controls</h3>
        <button onClick={runNow} disabled={acting}
          className="text-xs font-mono px-4 py-2 rounded bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-40">
          Run Now
        </button>
      </div>
    </div>
  )
}

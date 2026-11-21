import { useState } from 'react'
import { coreClient, type UserAccount } from '../api/client'

interface Props {
  onDone: (updatedUser: UserAccount) => void
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function ChangePassword({ onDone }: Props) {
  const [current,  setCurrent]  = useState('')
  const [next,     setNext]     = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const inp = 'w-full bg-black/40 border border-white/10 text-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500/60 placeholder-gray-600'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (next !== confirm) { setError('Passwords do not match'); return }
    if (next.length < 8)  { setError('Password must be at least 8 characters'); return }
    if (next === current) { setError('New password must be different from the current one'); return }
    setLoading(true)
    try {
      const { user } = await coreClient.changePassword(current, next)
      onDone(user)
    } catch (e: unknown) {
      setError(errorMessage(e) || 'Password change failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: '#050a0f' }}>

      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="font-mono text-2xl text-cyan-400 tracking-widest mb-2">{'>'} COASTAL_OS</div>
          <div className="text-xs font-mono text-yellow-400/80 tracking-wider">ACTION REQUIRED — CHANGE DEFAULT PASSWORD</div>
        </div>

        <div className="rounded-2xl border border-yellow-500/20 p-4 mb-6 text-xs text-yellow-300/70 font-mono"
          style={{ background: 'rgba(234,179,8,0.05)' }}>
          You are signed in with the default credentials.<br/>
          Set a unique password before continuing.
        </div>

        <form onSubmit={handleSubmit}
          className="rounded-2xl border border-white/8 p-8"
          style={{ background: 'rgba(10,22,40,0.8)', backdropFilter: 'blur(12px)' }}>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-mono tracking-wider">CURRENT PASSWORD</label>
              <input className={inp} type="password" value={current} onChange={e => setCurrent(e.target.value)}
                placeholder="••••••••" autoComplete="current-password" autoFocus required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-mono tracking-wider">NEW PASSWORD</label>
              <input className={inp} type="password" value={next} onChange={e => setNext(e.target.value)}
                placeholder="••••••••" autoComplete="new-password" required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-mono tracking-wider">CONFIRM NEW PASSWORD</label>
              <input className={inp} type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••" autoComplete="new-password" required />
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 font-mono">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading || !current || !next || !confirm}
            className="mt-6 w-full btn-primary py-3 text-sm disabled:opacity-40">
            {loading ? 'Saving...' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  )
}

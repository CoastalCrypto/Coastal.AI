import { useState, useEffect } from 'react'
import { coreClient } from '../api/client'

type UserRole = 'admin' | 'operator' | 'viewer'

interface UserRecord {
  id: string
  username: string
  role: UserRole
  createdAt: number
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin:    'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  operator: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  viewer:   'text-gray-400 bg-gray-500/10 border-gray-500/30',
}

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${ROLE_COLORS[role]}`}>
      {role}
    </span>
  )
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)   return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function Users({ onNav, currentUserId }: { onNav: (page: NavPage) => void; currentUserId: string }) {
  const [users,   setUsers]   = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  // Create form
  const [creating,     setCreating]     = useState(false)
  const [newUsername,  setNewUsername]  = useState('')
  const [newPassword,  setNewPassword]  = useState('')
  const [newRole,      setNewRole]      = useState<UserRole>('operator')
  const [saving,       setSaving]       = useState(false)
  const [formError,    setFormError]    = useState('')

  // Edit inline
  const [editId,       setEditId]       = useState<string | null>(null)
  const [editPassword, setEditPassword] = useState('')
  const [editRole,     setEditRole]     = useState<UserRole>('operator')
  const [editSaving,   setEditSaving]   = useState(false)

  const inp = 'bg-black/30 border border-white/8 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/50'

  const load = () => {
    coreClient.listUsers()
      .then(setUsers)
      .catch(() => setError('Could not load users'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (newPassword.length < 8) { setFormError('Password must be at least 8 characters'); return }
    setSaving(true)
    try {
      await coreClient.createUser(newUsername, newPassword, newRole)
      setCreating(false); setNewUsername(''); setNewPassword(''); setNewRole('operator')
      load()
    } catch (e: any) { setFormError(e.message) }
    finally { setSaving(false) }
  }

  const openEdit = (u: UserRecord) => {
    setEditId(u.id); setEditRole(u.role); setEditPassword('')
  }

  const handleEdit = async (id: string) => {
    setEditSaving(true)
    try {
      const data: any = { role: editRole }
      if (editPassword) data.password = editPassword
      await coreClient.updateUser(id, data)
      setEditId(null); load()
    } catch (e: any) { setError(e.message) }
    finally { setEditSaving(false) }
  }

  const handleDelete = async (u: UserRecord) => {
    if (u.id === currentUserId) { alert("You can't delete your own account."); return }
    if (!confirm(`Delete user "${u.username}"?`)) return
    await coreClient.deleteUser(u.id); load()
  }

  return (
    <div className="min-h-screen text-white" style={{ background: '#050a0f' }}>

      <div className="pt-20 pb-12 px-4 sm:px-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Users</h1>
            <p className="text-sm text-gray-500 mt-1">Manage accounts and access roles</p>
          </div>
          <button onClick={() => { setCreating(c => !c); setFormError('') }}
            className="btn-primary text-sm">
            {creating ? 'Cancel' : '+ Add User'}
          </button>
        </div>

        {/* Create form */}
        {creating && (
          <form onSubmit={handleCreate}
            className="rounded-xl border border-cyan-500/20 bg-cyan-500/3 p-5 mb-6 animate-slide-up">
            <h2 className="text-sm font-semibold text-cyan-400 mb-4">New User</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Username</label>
                <input className={`${inp} w-full`} value={newUsername}
                  onChange={e => setNewUsername(e.target.value)} placeholder="username" required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Role</label>
                <select className={`${inp} w-full`} value={newRole}
                  onChange={e => setNewRole(e.target.value as UserRole)}>
                  <option value="viewer">viewer</option>
                  <option value="operator">operator</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1.5">Password (min 8 chars)</label>
                <input className={`${inp} w-full font-mono`} type="password" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" required />
              </div>
            </div>
            {formError && <p className="text-red-400 text-xs mb-3">{formError}</p>}
            <button type="submit" disabled={saving || !newUsername || !newPassword}
              className="btn-primary text-sm disabled:opacity-40">
              {saving ? 'Creating...' : 'Create user'}
            </button>
          </form>
        )}

        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

        {/* User list */}
        {loading ? (
          <div className="text-cyan-500 font-mono text-sm animate-pulse">Loading...</div>
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-white/8 surface-panel py-20 text-center">
            <div className="text-4xl mb-4 opacity-30">👤</div>
            <p className="text-gray-500 text-sm">No users found.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="rounded-xl border border-white/8 surface-panel p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-xs font-bold text-cyan-400">
                      {u.username[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{u.username}</span>
                        {u.id === currentUserId && (
                          <span className="text-[10px] font-mono text-cyan-600">(you)</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 font-mono">{timeAgo(u.createdAt)}</div>
                    </div>
                    <RoleBadge role={u.role} />
                  </div>
                  <div className="flex gap-2 shrink-0 font-mono text-xs">
                    {editId === u.id ? null : (
                      <>
                        <button onClick={() => openEdit(u)} className="text-gray-500 hover:text-gray-300 transition-colors">edit</button>
                        <button onClick={() => handleDelete(u)} className="text-red-700 hover:text-red-500 transition-colors">delete</button>
                      </>
                    )}
                  </div>
                </div>

                {/* Inline edit */}
                {editId === u.id && (
                  <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Role</label>
                      <select className={`${inp} w-full`} value={editRole}
                        onChange={e => setEditRole(e.target.value as UserRole)}>
                        <option value="viewer">viewer</option>
                        <option value="operator">operator</option>
                        <option value="admin">admin</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">New password (optional)</label>
                      <input className={`${inp} w-full font-mono`} type="password" value={editPassword}
                        onChange={e => setEditPassword(e.target.value)} placeholder="leave blank to keep" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditId(null)} className="btn-ghost text-xs">Cancel</button>
                      <button onClick={() => handleEdit(u.id)} disabled={editSaving}
                        className="btn-primary text-xs disabled:opacity-40">
                        {editSaving ? '...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Role legend */}
        <div className="mt-8 rounded-xl border border-white/5 p-4">
          <p className="text-xs font-mono text-gray-600 mb-3 tracking-wider">ROLE PERMISSIONS</p>
          <div className="space-y-2 text-xs text-gray-500">
            <div className="flex gap-3"><span className="font-bold text-cyan-400 w-16">admin</span><span>Full access — users, models, tools, channels, settings</span></div>
            <div className="flex gap-3"><span className="font-bold text-amber-400 w-16">operator</span><span>Chat, analytics, dashboard — no user/model management</span></div>
            <div className="flex gap-3"><span className="font-bold text-gray-400 w-16">viewer</span><span>Chat and dashboard only — read access</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'

export type NavPage = 'chat' | 'dashboard' | 'analytics' | 'tools' | 'skills' | 'channels' | 'models' | 'agents' | 'pipeline' | 'users' | 'settings' | 'system' | 'agent-graph' | 'architect'

interface NavItem { id: NavPage; label: string; icon: string; adminOnly?: boolean }

const NAV_ITEMS: NavItem[] = [
  { id: 'chat',      label: 'Chat',      icon: '💬' },
  { id: 'dashboard', label: 'Dashboard', icon: '⚡' },
  { id: 'analytics', label: 'Analytics', icon: '📊' },
  { id: 'tools',     label: 'Tools',     icon: '🔧', adminOnly: true },
  { id: 'skills',    label: 'Skills',    icon: '⚡', adminOnly: true },
  { id: 'channels',  label: 'Channels',  icon: '📣', adminOnly: true },
  { id: 'models',    label: 'Models',    icon: '🧠', adminOnly: true },
  { id: 'agents',    label: 'Agents',    icon: '🤖', adminOnly: true },
  { id: 'pipeline',  label: 'Pipeline',  icon: '⛓',  adminOnly: true },
  { id: 'agent-graph', label: 'Graph', icon: '🕸', adminOnly: true },
  { id: 'users',     label: 'Users',     icon: '👤', adminOnly: true },
  { id: 'settings',  label: 'Settings',  icon: '⚙️', adminOnly: true },
  { id: 'system',    label: 'System',    icon: '📡', adminOnly: true },
  { id: 'architect', label: 'Architect', icon: '🏗', adminOnly: true },
]

interface CoastalShell {
  onUpdateAvailable?: (cb: (info: { version: string }) => void) => void
}

interface NavBarProps {
  page: NavPage
  onNav: (page: NavPage) => void
  title?: string
  currentUser?: { username: string; role: string } | null
  onLogout?: () => void
}

function useUpdateBanner() {
  const [banner, setBanner] = useState<string | null>(null)
  const loadedVersion = useRef<string | null>(null)

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/version')
        if (!res.ok) return
        const { version } = await res.json() as { version: string }
        if (!loadedVersion.current) {
          loadedVersion.current = version
        } else if (version !== loadedVersion.current) {
          setBanner(`Server updated to v${version} — refresh to get the latest`)
        }
      } catch {
        /* version probe is best-effort */
      }
    }

    check()
    const id = setInterval(check, 60_000)
    return () => clearInterval(id)
  }, [])

  // Also listen for Electron update notification
  useEffect(() => {
    const shell = (window as unknown as { coastalShell?: CoastalShell }).coastalShell
    shell?.onUpdateAvailable?.((info: { version: string }) => {
      setBanner(`Desktop update v${info.version} ready — restart to install`)
    })
  }, [])

  return { banner, dismiss: () => setBanner(null) }
}

export function NavBar({ page, onNav, title, currentUser: userProp, onLogout: logoutProp }: NavBarProps) {
  const [open, setOpen] = useState(false)
  const auth = useAuth()
  const currentUser = userProp ?? auth.currentUser
  const onLogout    = logoutProp ?? auth.onLogout
  const isAdmin = currentUser?.role === 'admin'
  const visibleItems = NAV_ITEMS.filter(i => !i.adminOnly || isAdmin)
  const { banner, dismiss } = useUpdateBanner()

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50"
        style={{ background: 'rgba(5,10,15,0.96)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,229,255,0.12)' }}>
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between max-w-7xl mx-auto">

          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Wave logo */}
            <svg viewBox="0 0 100 100" width="32" height="32" className="shrink-0 text-cyan-400" fill="none" aria-hidden="true">
              <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="3.5"/>
              <path stroke="currentColor" strokeWidth="9" strokeLinecap="round" fill="none"
                d="M8 48 C18 34 30 34 38 44 C46 54 58 54 66 44 C74 34 86 34 94 44"/>
              <circle cx="24" cy="36" r="3.5" fill="currentColor" opacity="0.8"/>
              <circle cx="80" cy="36" r="3.5" fill="currentColor" opacity="0.8"/>
              <path stroke="currentColor" strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.65"
                d="M8 62 C18 50 32 50 42 60 C52 70 66 68 76 58 C84 50 92 50 96 56"/>
              <path stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.35"
                d="M8 76 C22 68 38 70 50 78 C62 86 78 84 90 76"/>
            </svg>
            <span className="font-bold tracking-tight text-sm shrink-0 hidden sm:block"
              style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.5px', color: '#e2f4ff' }}>
              Coastal.AI
            </span>
            <span className="font-bold tracking-tight text-sm shrink-0 sm:hidden"
              style={{ fontFamily: 'Space Grotesk, sans-serif', color: '#e2f4ff' }}>
              CC
            </span>
            {title && (
              <span className="text-xs font-mono truncate hidden md:block" style={{ color: '#4a6a8a' }}>
                / {title}
              </span>
            )}
          </div>

          {/* Desktop nav */}
          <div className="hidden sm:flex items-center gap-0.5">
            {visibleItems.map(item => (
              <button
                key={item.id}
                onClick={() => onNav(item.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all tracking-wide ${
                  page === item.id
                    ? 'text-black font-bold'
                    : 'hover:text-white hover:bg-white/5'
                }`}
                style={page === item.id
                  ? { background: '#00e5ff', color: '#050a0f', fontFamily: 'Space Grotesk, sans-serif', boxShadow: '0 0 10px rgba(0,229,255,0.35)' }
                  : { color: '#94adc4', fontFamily: 'Space Grotesk, sans-serif' }
                }
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Right: user badge + logout (desktop) + hamburger (mobile) */}
          <div className="flex items-center gap-3">
            {currentUser && (
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-xs" style={{ color: '#94adc4', fontFamily: 'Space Grotesk, sans-serif' }}>
                  {currentUser.username}
                  <span className={`ml-1.5 text-[10px] font-mono ${currentUser.role === 'admin' ? '' : 'text-gray-600'}`}
                    style={currentUser.role === 'admin' ? { color: '#00e5ff' } : {}}>
                    [{currentUser.role}]
                  </span>
                </span>
                {onLogout && (
                  <button onClick={onLogout}
                    className="text-xs text-gray-600 hover:text-red-400 transition-colors font-mono">
                    logout
                  </button>
                )}
              </div>
            )}

            {/* Mobile hamburger */}
            <button
              className="sm:hidden flex flex-col gap-1.5 p-2 rounded-md hover:bg-white/5 transition-colors"
              onClick={() => setOpen(o => !o)}
              aria-label="Toggle menu"
            >
              <span className={`block h-0.5 w-5 transition-transform origin-center ${open ? 'rotate-45 translate-y-2' : ''}`} style={{ background: '#94adc4' }} />
              <span className={`block h-0.5 w-5 transition-opacity ${open ? 'opacity-0' : ''}`} style={{ background: '#94adc4' }} />
              <span className={`block h-0.5 w-5 transition-transform origin-center ${open ? '-rotate-45 -translate-y-2' : ''}`} style={{ background: '#94adc4' }} />
            </button>
          </div>
        </div>

        {/* Update banner */}
        {banner && (
          <div className="border-t border-amber-500/20 bg-amber-500/8 px-4 py-2 flex items-center justify-between gap-3">
            <span className="text-xs font-mono text-amber-300">{banner}</span>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => window.location.reload()}
                className="text-xs font-mono text-amber-400 border border-amber-500/40 rounded px-2 py-0.5 hover:bg-amber-500/20 transition-colors"
              >
                refresh now
              </button>
              <button onClick={dismiss} className="text-xs text-amber-600 hover:text-amber-400 transition-colors">
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Mobile dropdown */}
        {open && (
          <div className="sm:hidden border-t px-4 py-3 flex flex-col gap-1"
            style={{ background: 'rgba(5,10,15,0.99)', borderColor: 'rgba(0,229,255,0.12)' }}>
            {visibleItems.map(item => (
              <button
                key={item.id}
                onClick={() => { onNav(item.id); setOpen(false) }}
                className={`w-full text-left px-4 py-2.5 rounded-lg text-sm transition-all flex items-center gap-3 ${
                  page === item.id ? '' : 'hover:bg-white/5'
                }`}
                style={page === item.id
                  ? { color: '#00e5ff', background: 'rgba(0,229,255,0.08)', borderLeft: '2px solid #00e5ff', fontFamily: 'Space Grotesk, sans-serif' }
                  : { color: '#94adc4', fontFamily: 'Space Grotesk, sans-serif' }
                }
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
                {page === item.id && <span className="ml-auto" style={{ color: '#00e5ff', fontSize: '8px' }}>●</span>}
              </button>
            ))}

            {currentUser && (
              <div className="mt-3 pt-3 flex items-center justify-between px-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <span className="text-xs" style={{ color: '#94adc4' }}>
                  {currentUser.username} <span style={{ color: '#4a6a8a' }}>[{currentUser.role}]</span>
                </span>
                {onLogout && (
                  <button onClick={() => { onLogout(); setOpen(false) }}
                    className="text-xs text-red-700 hover:text-red-400 transition-colors font-mono">
                    logout
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </nav>
    </>
  )
}

import { useState, useEffect } from 'react'
import { coreClient } from '../api/client'

export type NavPage = 'chat' | 'dashboard' | 'agents' | 'skills' | 'architect' | 'pipeline' | 'channels' | 'analytics' | 'tools' | 'users' | 'settings' | 'system' | 'models' | 'agent-graph'

const NAV_ITEMS: Array<{ id: NavPage; label: string; icon: string }> = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'agents', label: 'Agents', icon: '🤖' },
  { id: 'skills', label: 'Skills', icon: '⚡' },
  { id: 'architect', label: 'Architect', icon: '🏗️' },
  { id: 'pipeline', label: 'Pipeline', icon: '⚙️' },
  { id: 'channels', label: 'Channels', icon: '📡' },
  { id: 'analytics', label: 'Analytics', icon: '📈' },
  { id: 'tools', label: 'Tools', icon: '🔧' },
  { id: 'users', label: 'Users', icon: '👥' },
  { id: 'models', label: 'Models', icon: '🧠' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'system', label: 'System', icon: '💻' },
]

export function SideNav({ page, onNav }: { page: NavPage; onNav: (page: NavPage) => void }) {
  const [open, setOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    coreClient.checkForUpdate().then(({ updateAvailable: avail }) => setUpdateAvailable(avail)).catch(() => {})
  }, [])

  useEffect(() => {
    const email = localStorage.getItem('userEmail') || 'admin@coastal.ai'
    setUserEmail(email)
  }, [])

  const handleNavClick = (id: NavPage) => {
    onNav(id)
    if (!isDesktop) setOpen(false)
  }

  return (
    <>
      {/* Mobile hamburger button */}
      {!isDesktop && (
        <button
          onClick={() => setOpen(!open)}
          className="fixed top-4 left-4 z-40 p-2 hover:bg-gray-800 rounded-lg"
        >
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={open ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
          </svg>
        </button>
      )}

      {/* Sidebar backdrop on mobile */}
      {!isDesktop && open && (
        <div className="fixed inset-0 bg-black/50 z-20" onClick={() => setOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`fixed top-0 left-0 h-screen w-60 bg-gray-900 border-r border-gray-800 z-30 transition-transform duration-300 ${
        isDesktop ? 'translate-x-0' : open ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="p-4 h-full flex flex-col">
          {/* Logo/Brand + Mobile Close */}
          <div className="mb-8 pt-2 flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-cyan-400">Coastal.AI</h1>
              <p className="text-xs text-gray-500 mt-1">{userEmail}</p>
            </div>
            {!isDesktop && (
              <button
                onClick={() => setOpen(false)}
                className="p-1 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-gray-200"
                aria-label="Close menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Update banner */}
          {updateAvailable && (
            <div className="mb-4 p-3 bg-cyan-900/30 border border-cyan-800 rounded-lg text-xs text-cyan-300">
              <p>Update available</p>
              <button
                onClick={() => handleNavClick('system')}
                className="mt-2 text-cyan-400 hover:text-cyan-300 font-mono"
              >
                Check System →
              </button>
            </div>
          )}

          {/* Navigation items */}
          <nav className="flex-1 space-y-1 overflow-y-auto">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-3 ${
                  page === item.id
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-800'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Footer info */}
          <div className="pt-4 border-t border-gray-800 text-xs text-gray-600">
            <p>© 2026 Coastal.AI</p>
            <p className="mt-1">Production-ready agent platform</p>
          </div>
        </div>
      </div>
    </>
  )
}

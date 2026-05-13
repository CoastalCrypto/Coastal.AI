import { useState, lazy, Suspense, useEffect, type ReactNode } from 'react'
import { ApolloProvider } from '@apollo/client'
import { AuthContext, type AuthUser } from './context/AuthContext'
import { Onboarding } from './pages/Onboarding'
import { Login } from './pages/Login'
import { ChangePassword } from './pages/ChangePassword'
import { Chat } from './pages/Chat'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SideNav, type NavPage } from './components/SideNav'
import { TitleBar } from './components/TitleBar'
import { CommandPalette } from './components/CommandPalette'
import { coreClient } from './api/client'
import { apolloClient } from './api/apolloClient'
import './index.css'

// Lazy-loaded pages — only fetched when the user navigates to them
const Dashboard  = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })))
const Analytics  = lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })))
const Tools      = lazy(() => import('./pages/Tools').then(m => ({ default: m.Tools })))
const Skills     = lazy(() => import('./pages/Skills').then(m => ({ default: m.Skills })))
const Channels   = lazy(() => import('./pages/Channels').then(m => ({ default: m.Channels })))
const Agents     = lazy(() => import('./pages/Agents').then(m => ({ default: m.Agents })))
const Pipeline   = lazy(() => import('./pages/Pipeline').then(m => ({ default: m.Pipeline })))
const AgentGraph = lazy(() => import('./pages/AgentGraph').then(m => ({ default: m.AgentGraph })))
const Settings   = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })))
const System     = lazy(() => import('./pages/System').then(m => ({ default: m.System })))
const Users      = lazy(() => import('./pages/Users').then(m => ({ default: m.Users })))
const Models     = lazy(() => import('./pages/Models').then(m => ({ default: m.Models })))
const Architect  = lazy(() => import('./pages/Architect').then(m => ({ default: m.Architect })))

// Three.js is large — load it async so the onboarding form renders immediately
const OceanScene = lazy(() =>
  import('./components/animations/OceanScene').then((m) => ({ default: m.OceanScene }))
)

function PageLoader({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#050a0f' }}>
        <div className="font-mono text-sm animate-pulse" style={{ color: '#00e5ff' }}>loading...</div>
      </div>
    }>
      {children}
    </Suspense>
  )
}

function loadStoredUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem('cc_user')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export default function App() {
  const [checking,    setChecking]    = useState(true)
  const [,            setNeedsSetup]  = useState(false)
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [sessionId,   setSessionId]   = useState<string | null>(null)
  const [page,        setPage]        = useState<NavPage>('chat')
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    async function init() {
      try {
        const storedUser = loadStoredUser()
        if (!storedUser || !sessionStorage.getItem('cc_admin_session')) {
          setChecking(false); return
        }

        try {
          const { user } = await coreClient.getMe()
          setCurrentUser(user)
        } catch {
          coreClient.clearSession()
          setChecking(false); return
        }

        const { configured } = await coreClient.getPersona()
        if (configured) setSessionId(`session-${Date.now()}`)
      } catch {
        // Server not reachable — fall through to login
      } finally {
        setChecking(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen(p => !p)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleLogin = async (sessionToken: string, user: AuthUser) => {
    coreClient.setSession(sessionToken)
    sessionStorage.setItem('cc_user', JSON.stringify(user))
    // Show spinner while checking persona — avoids Onboarding flash for returning users
    setChecking(true)
    try {
      const { configured } = await coreClient.getPersona()
      setCurrentUser(user)
      setNeedsSetup(false)
      if (configured) setSessionId(`session-${Date.now()}`)
    } catch {
      setCurrentUser(user)
      setNeedsSetup(false)
    } finally {
      setChecking(false)
    }
  }

  const handleLogout = () => {
    coreClient.clearSession()
    setCurrentUser(null)
    setSessionId(null)
    setPage('chat')
  }

  const nav = (p: NavPage) => setPage(p)

  if (checking) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#050a0f' }}>
      <div className="font-mono text-sm animate-pulse" style={{ color: '#00e5ff' }}>connecting...</div>
    </div>
  )

  if (!currentUser) {
    return <Login onLogin={handleLogin} />
  }

  // Force password change for default admin account before entering the app
  if ((currentUser as any).mustChangePassword) {
    return (
      <ChangePassword onDone={(updatedUser) => {
        const merged = { ...currentUser, ...updatedUser, mustChangePassword: false }
        setCurrentUser(merged)
        sessionStorage.setItem('cc_user', JSON.stringify(merged))
      }} />
    )
  }

  if (!sessionId) return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ position: 'relative' }}>
      <Suspense fallback={<div style={{ position: 'absolute', inset: 0, background: '#050a0f' }} />}>
        <OceanScene />
      </Suspense>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Onboarding onComplete={setSessionId} />
      </div>
    </div>
  )

  return (
    <ApolloProvider client={apolloClient}>
      <AuthContext.Provider value={{ currentUser, onLogout: handleLogout }}>
        <SideNav page={page} onNav={nav} />
        <div style={{ marginLeft: window.innerWidth >= 768 ? '240px' : '0' }}>
          <TitleBar />
          {paletteOpen && currentUser && (
            <CommandPalette onNav={(p) => { setPage(p); setPaletteOpen(false) }} onClose={() => setPaletteOpen(false)} />
          )}
          {page === 'dashboard'   && <PageLoader><Dashboard onNav={nav} /></PageLoader>}
          {page === 'analytics'   && <PageLoader><Analytics onNav={nav} /></PageLoader>}
          {page === 'tools'       && <PageLoader><Tools onNav={nav} /></PageLoader>}
          {page === 'skills'      && <PageLoader><Skills onNav={nav} /></PageLoader>}
          {page === 'channels'    && <PageLoader><Channels onNav={nav} /></PageLoader>}
          {page === 'agents'      && <PageLoader><Agents onNav={nav} /></PageLoader>}
          {page === 'pipeline'    && <PageLoader><Pipeline onNav={nav} /></PageLoader>}
          {page === 'agent-graph' && <PageLoader><AgentGraph onNav={nav} /></PageLoader>}
          {page === 'settings'    && <PageLoader><Settings onNav={nav} /></PageLoader>}
          {page === 'system'      && <PageLoader><System onNav={nav} /></PageLoader>}
          {page === 'architect'   && <ErrorBoundary><PageLoader><Architect onNav={nav} /></PageLoader></ErrorBoundary>}
          {page === 'users'       && <PageLoader><Users onNav={nav} currentUserId={currentUser.id} /></PageLoader>}
          {page === 'models'      && (
            <PageLoader>
              <div className="min-h-screen" style={{ background: '#050a0f', color: '#e2f4ff' }}>
                <div className="pt-20 px-4 sm:px-6 max-w-4xl mx-auto pb-12">
                  <Models />
                </div>
              </div>
            </PageLoader>
          )}
          {/* Always mounted so chat history and session survive page navigation */}
          <div style={{ display: page === 'chat' ? 'block' : 'none' }}>
            <Chat sessionId={sessionId} onNav={p => nav(p as NavPage)} />
          </div>
        </div>
      </AuthContext.Provider>
    </ApolloProvider>
  )
}

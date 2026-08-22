import { useState, useEffect, useRef, useCallback } from 'react'
import type { NavPage } from './NavBar'

interface Command {
  id: string
  label: string
  description: string
  icon: string
  action: () => void
  keywords?: string[]
}

interface Props {
  onNav: (page: NavPage) => void
  onClose: () => void
}

export function CommandPalette({ onNav, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [selectedResetForQuery, setSelectedResetForQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const navigate = useCallback((page: NavPage) => {
    onNav(page)
    onClose()
  }, [onNav, onClose])

  const commands: Command[] = [
    { id: 'chat',        label: 'Chat',        description: 'Open the AI chat interface',       icon: '💬', action: () => navigate('chat'),        keywords: ['talk', 'message'] },
    { id: 'dashboard',   label: 'Dashboard',   description: 'Live activity feed and stats',     icon: '⚡', action: () => navigate('dashboard'),   keywords: ['home', 'events', 'activity'] },
    { id: 'agents',      label: 'Agents',      description: 'Manage your AI agents',            icon: '🤖', action: () => navigate('agents'),      keywords: ['coo', 'cfo', 'cto', 'create'] },
    { id: 'pipeline',    label: 'Pipeline',    description: 'Build and run agent pipelines',    icon: '⛓',  action: () => navigate('pipeline'),    keywords: ['chain', 'workflow', 'sequence'] },
    { id: 'skills',      label: 'Skills',      description: 'Create prompt-based shortcuts',    icon: '⚡', action: () => navigate('skills'),      keywords: ['prompt', 'template', 'shortcut'] },
    { id: 'models',      label: 'Models',      description: 'Install and manage local models',  icon: '🧠', action: () => navigate('models'),      keywords: ['ollama', 'llm', 'install', 'pull'] },
    { id: 'analytics',   label: 'Analytics',   description: 'Usage metrics and performance',    icon: '📊', action: () => navigate('analytics'),   keywords: ['stats', 'metrics', 'usage'] },
    { id: 'tools',       label: 'Tools',       description: 'Custom agent tools',               icon: '🔧', action: () => navigate('tools'),       keywords: ['custom', 'function'] },
    { id: 'channels',    label: 'Channels',    description: 'Slack, Discord, Telegram',         icon: '📣', action: () => navigate('channels'),    keywords: ['slack', 'discord', 'telegram', 'zapier'] },
    { id: 'agent-graph', label: 'Agent Graph', description: 'Real-time visual agent graph',     icon: '🕸', action: () => navigate('agent-graph'), keywords: ['graph', 'visual', 'network'] },
    { id: 'settings',    label: 'Settings',    description: 'System configuration',             icon: '⚙️', action: () => navigate('settings'),    keywords: ['config', 'persona', 'preferences'] },
    { id: 'system',      label: 'System',      description: 'Server health and diagnostics',    icon: '📡', action: () => navigate('system'),      keywords: ['health', 'status', 'server', 'restart'] },
    { id: 'users',       label: 'Users',       description: 'Manage user accounts',             icon: '👤', action: () => navigate('users'),       keywords: ['account', 'password', 'roles'] },
  ]

  const filtered = query.trim() === ''
    ? commands
    : commands.filter(c => {
        const q = query.toLowerCase()
        return c.label.toLowerCase().includes(q)
          || c.description.toLowerCase().includes(q)
          || (c.keywords ?? []).some(k => k.includes(q))
      })

  // Reset the highlighted row whenever the query changes — derived from
  // props/state during render rather than in an effect.
  if (query !== selectedResetForQuery) {
    setSelectedResetForQuery(query)
    setSelected(0)
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const el = listRef.current?.children[selected] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && filtered[selected]) { filtered[selected].action() }
    if (e.key === 'Escape') { onClose() }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(5,10,15,0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560,
          background: 'rgba(5,10,15,0.96)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(0,229,255,0.2)',
          borderRadius: 14,
          boxShadow: '0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,229,255,0.05)',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid rgba(0,229,255,0.08)' }}>
          <span style={{ color: '#94adc4', fontSize: 16 }}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command or search..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#e2f4ff', fontSize: 14, fontFamily: 'Space Grotesk, sans-serif',
            }}
          />
          <kbd style={{ fontSize: 10, color: '#94adc4', background: 'rgba(148,173,196,0.1)', border: '1px solid rgba(148,173,196,0.2)', borderRadius: 4, padding: '2px 6px', fontFamily: 'JetBrains Mono, monospace' }}>ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ maxHeight: 380, overflowY: 'auto', padding: '6px 8px 8px' }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#94adc4', fontSize: 13 }}>
              No commands match &ldquo;{query}&rdquo;
            </div>
          )}
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              onClick={cmd.action}
              onMouseEnter={() => setSelected(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                background: i === selected ? 'rgba(0,229,255,0.08)' : 'transparent',
                border: i === selected ? '1px solid rgba(0,229,255,0.15)' : '1px solid transparent',
                marginBottom: 2, transition: 'all 0.1s',
              }}
            >
              <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{cmd.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: i === selected ? '#00e5ff' : '#e2f4ff', fontSize: 13, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600 }}>{cmd.label}</div>
                <div style={{ color: '#94adc4', fontSize: 11, marginTop: 1, fontFamily: 'JetBrains Mono, monospace' }}>{cmd.description}</div>
              </div>
              {i === selected && (
                <kbd style={{ fontSize: 10, color: '#00e5ff', background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.25)', borderRadius: 4, padding: '2px 6px', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>↵</kbd>
              )}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(0,229,255,0.06)', display: 'flex', gap: 16 }}>
          {([['↑↓', 'navigate'], ['↵', 'open'], ['esc', 'close']] as const).map(([key, label]) => (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#94adc4', fontFamily: 'JetBrains Mono, monospace' }}>
              <kbd style={{ background: 'rgba(148,173,196,0.1)', border: '1px solid rgba(148,173,196,0.15)', borderRadius: 3, padding: '1px 5px', color: '#e2f4ff' }}>{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

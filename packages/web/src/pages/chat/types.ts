import type { AgentDomain } from '../../components/AgentThinkingAnimation'
import type { TeamTurn } from '../../api/client'

export type MessageRole = 'user' | 'assistant' | 'approval' | 'team'

export interface Message {
  role: MessageRole
  content: string
  imageUrl?: string
  domain?: AgentDomain
  approvalId?: string
  agentId?: string
  agentName?: string
  toolName?: string
  cmd?: string
  resolved?: boolean
  trace?: TeamTurn[]
}

export interface BgPreset {
  id: string
  label: string
  css: string
  overlay: string
  thumb: string
  isImage?: boolean
}

export const BG_PRESETS: BgPreset[] = [
  {
    id: 'coastal',
    label: 'Coastal',
    css: 'linear-gradient(135deg, #050a0f 0%, #0a1628 50%, #050a0f 100%)',
    overlay: 'rgba(0,0,0,0)',
    thumb: 'linear-gradient(135deg, #050a0f 0%, #0a1628 50%, #050a0f 100%)',
  },
  {
    id: 'void',
    label: 'Void',
    css: '#000000',
    overlay: 'rgba(0,0,0,0)',
    thumb: '#000000',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    css: 'linear-gradient(135deg, #0a0015 0%, #120030 50%, #0a0015 100%)',
    overlay: 'rgba(0,0,0,0)',
    thumb: 'linear-gradient(135deg, #0a0015, #120030)',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    css: 'linear-gradient(135deg, #001a1a 0%, #001828 40%, #0d0020 100%)',
    overlay: 'rgba(0,0,0,0)',
    thumb: 'linear-gradient(135deg, #001a1a, #0d0020)',
  },
  {
    id: 'ember',
    label: 'Ember',
    css: 'linear-gradient(135deg, #1a0600 0%, #200010 50%, #050a0f 100%)',
    overlay: 'rgba(0,0,0,0)',
    thumb: 'linear-gradient(135deg, #1a0600, #200010)',
  },
  {
    id: 'ocean-photo',
    label: 'Ocean',
    css: "url('https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1920&q=80') center/cover fixed",
    overlay: 'rgba(5,10,15,0.82)',
    thumb: "url('https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=400&q=60') center/cover",
    isImage: true,
  },
  {
    id: 'cyber-photo',
    label: 'Cyber',
    css: "url('https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=1920&q=80') center/cover fixed",
    overlay: 'rgba(13,17,23,0.85)',
    thumb: "url('https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=400&q=60') center/cover",
    isImage: true,
  },
  {
    id: 'space-photo',
    label: 'Space',
    css: "url('https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920&q=80') center/cover fixed",
    overlay: 'rgba(0,0,0,0.7)',
    thumb: "url('https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=400&q=60') center/cover",
    isImage: true,
  },
]

export const LS_BG_KEY = 'cc_chat_bg'

export function loadSavedBg(): { presetId: string; customUrl: string } {
  try {
    const raw = localStorage.getItem(LS_BG_KEY)
    return raw ? JSON.parse(raw) : { presetId: 'coastal', customUrl: '' }
  } catch {
    return { presetId: 'coastal', customUrl: '' }
  }
}

export const SHORTCUTS = [
  { key: 'Enter', desc: 'Send message' },
  { key: 'Shift+Enter', desc: 'New line' },
  { key: '/', desc: 'Focus input' },
  { key: '?', desc: 'Show shortcuts' },
  { key: 'Esc', desc: 'Close sidebar / overlay' },
  { key: 'Ctrl+Alt+T', desc: 'Open terminal (OS)' },
  { key: 'Ctrl+Alt+R', desc: 'Restart server (OS)' },
  { key: 'Ctrl+Alt+Del', desc: 'Power menu (OS)' },
  { key: 'Super+L', desc: 'Lock screen (OS)' },
  { key: 'Print Screen', desc: 'Screenshot (OS)' },
]

export const PANE_GRID: Record<number, [number, number]> = {
  1: [1, 1], 2: [2, 1], 3: [3, 1], 4: [2, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3],
}

export function exportMarkdown(messages: Message[], sessionId: string) {
  const lines = [`# Conversation ${sessionId}`, `_Exported ${new Date().toLocaleString()}_`, '']
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      lines.push(`**${m.role === 'user' ? 'You' : 'Agent'}:** ${m.content}`, '')
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `conversation-${sessionId.slice(-8)}.md`
  a.click()
  URL.revokeObjectURL(a.href)
}

// Validate URL to prevent CSS injection — only allow http(s) and sanitize quotes
export function isValidBgUrl(url: string): boolean {
  if (!url) return false
  if (/['")\\]/.test(url)) return false
  try {
    const parsed = new URL(url, window.location.href)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return url.startsWith('/')
  }
}

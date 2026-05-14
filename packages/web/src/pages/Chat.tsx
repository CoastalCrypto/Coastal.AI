import { useState, useRef, useEffect, useCallback, type DragEvent } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'
import { guessDomain, type AgentDomain } from '../components/AgentThinkingAnimation'
import { coreClient } from '../api/client'
import { AgentCharacters } from '../components/AgentCharacters'
import { ChatPane } from '../components/ChatPane'
import { speakText as speakTextUtil } from '../utils/speech'
import { type Message, BG_PRESETS, LS_BG_KEY, PANE_GRID, loadSavedBg, isValidBgUrl } from './chat/types'
import { MessageList } from './chat/MessageList'
import { ShortcutsOverlay } from './chat/ShortcutsOverlay'
import { BackgroundPicker } from './chat/BackgroundPicker'
import { ArchitectToast } from './chat/ArchitectToast'
import { useReconnectingWs } from './chat/useReconnectingWs'

export function Chat({ sessionId: initialSessionId, onNav: _onNav }: { sessionId: string; onNav: (page: string) => void }) {
  const [currentSessionId] = useState(initialSessionId)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello. I\'m your AI executive. How can I help you today?' }
  ])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [, setThinkingDomain] = useState<AgentDomain>('general')
  const [activeDomain, setActiveDomain] = useState<AgentDomain>('general')
  const [isListening, setIsListening] = useState(false)
  const [teamMode, setTeamMode] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [fileNotice, setFileNotice] = useState('')
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [agentList, setAgentList] = useState<Array<{ id: string; name: string; active: boolean }>>([])
  const [agentListError, setAgentListError] = useState(false)
  const [personaAgentId, setPersonaAgentId] = useState<string | null>(null)
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false)
  const isMobile = useIsMobile()
  const [paneCount] = useState(1)
  const [focusedPane, setFocusedPane] = useState(0)
  const [voiceMuted] = useState(false)
  const [architectToast, setArchitectToast] = useState<{
    proposalId: string; summary: string; vetoDeadline: number
  } | null>(null)
  const inputRef2 = useRef<HTMLInputElement>(null)
  const agentVoicesRef = useRef<Map<string, string>>(new Map())
  const [skills, setSkills] = useState<{ name: string; description: string; prompt: string }[]>([])
  const [skillSuggestions, setSkillSuggestions] = useState<typeof skills>([])
  const [skillVars, setSkillVars] = useState<Record<string, string> | null>(null)
  const [pendingSkill, setPendingSkill] = useState<{ prompt: string } | null>(null)

  // Background state
  const [bgPresetId, setBgPresetId]     = useState<string>(() => loadSavedBg().presetId)
  const [bgCustomUrl, setBgCustomUrl]   = useState<string>(() => loadSavedBg().customUrl)
  const [bgPickerOpen, setBgPickerOpen] = useState(false)

  const activeBg = bgCustomUrl && isValidBgUrl(bgCustomUrl)
    ? { css: `url('${bgCustomUrl}') center/cover fixed`, overlay: 'rgba(5,10,15,0.80)' }
    : (BG_PRESETS.find(p => p.id === bgPresetId) ?? BG_PRESETS[0])

  const applyBg = (presetId: string, customUrl = '') => {
    if (customUrl && !isValidBgUrl(customUrl)) return
    setBgPresetId(presetId)
    setBgCustomUrl(customUrl)
    localStorage.setItem(LS_BG_KEY, JSON.stringify({ presetId, customUrl }))
  }

  // ── Effects ──────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/skills')
      .then(r => r.ok ? r.json() : [])
      .then(setSkills)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const session = sessionStorage.getItem('cc_admin_session') ?? ''
    const headers: Record<string, string> = session ? { 'x-admin-session': session } : {}
    fetch('/api/admin/agents', { headers })
      .then(r => r.ok ? r.json() : [])
      .then((agents: { id: string; voice?: string }[]) => {
        const map = new Map<string, string>()
        for (const a of agents) if (a.voice) map.set(a.id, a.voice)
        agentVoicesRef.current = map
      })
      .catch(() => {})
  }, [agentList.length])


  useEffect(() => {
    const loadAgents = () =>
      coreClient.listAgents()
        .then(agents => {
          setAgentList(agents.map(a => ({ id: a.id, name: a.name, active: a.active })))
          setAgentListError(false)
        })
        .catch(() => setAgentListError(true))
    loadAgents()
    const retryTimer = setTimeout(() => {
      if (agentList.length === 0) loadAgents()
    }, 2000)
    return () => clearTimeout(retryTimer)
  }, [])

  useEffect(() => {
    const session = sessionStorage.getItem('cc_admin_session') ?? ''
    const headers: Record<string, string> = session ? { 'x-admin-session': session } : {}
    fetch('/api/persona', { headers })
      .then(r => r.ok ? r.json() : null)
      .then((data: { personaAgentId?: string } | null) => {
        if (data?.personaAgentId) {
          setPersonaAgentId(data.personaAgentId)
          setSelectedAgentId(id => id ?? data.personaAgentId ?? null)
        }
      })
      .catch(() => {})
  }, [])

  // Speech recognition
  const recognitionRef = useRef<any>(null)
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    const r = new SR()
    r.continuous = false
    r.interimResults = true
    r.onresult = (e: any) =>
      setInput(Array.from(e.results).map((res: any) => res[0].transcript).join(''))
    r.onend = () => {
      setIsListening(false)
      if (inputRealtime.current.trim()) sendRef.current()
    }
    recognitionRef.current = r
  }, [])

  const inputRealtime = useRef(input)
  inputRealtime.current = input
  const sendRef = useRef<() => void>(() => {})

  const voiceMutedRef = useRef(voiceMuted)
  voiceMutedRef.current = voiceMuted
  const activeDomainRef = useRef(activeDomain)
  activeDomainRef.current = activeDomain

  const speakText = useCallback((text: string) => {
    if (voiceMutedRef.current) return
    const clean = text.replace(/[*#`_~>]/g, '').replace(/\s+/g, ' ').trim()
    if (!clean) return
    const agentVoiceName = agentVoicesRef.current.get(activeDomainRef.current)

    if (agentVoiceName?.startsWith('vv:')) {
      const vibeId = agentVoiceName.slice(3)
      const session = sessionStorage.getItem('cc_admin_session') ?? ''
      fetch('/api/admin/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session ? { 'x-admin-session': session } : {}) },
        body: JSON.stringify({ text: clean, voice: vibeId }),
      }).then(r => {
        if (!r.ok) throw new Error('vv_unavailable')
        return r.blob()
      }).then(blob => {
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.onended = () => URL.revokeObjectURL(url)
        audio.play()
      }).catch(() => speakTextUtil(clean, null))
      return
    }

    speakTextUtil(clean, agentVoiceName ?? null)
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        setShortcutsOpen(o => !o)
      }
      if (e.key === 'Escape') { setShortcutsOpen(false) }
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault(); inputRef2.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  // ── WebSocket ────────────────────────────────────────────────────

  const handleWsMessage = useCallback((data: any) => {
    if (data.type === 'proactive_suggestion' && (!data.sessionId || data.sessionId === currentSessionId)) {
      setSuggestions(prev => [...prev.slice(-2), data.suggestion])
    }
    if (data.type === 'approval_request') {
      setMessages(prev => [...prev, {
        role: 'approval', content: '',
        approvalId: data.approvalId, agentId: data.agentId ?? 'general',
        agentName: data.agentName, toolName: data.toolName,
        cmd: data.cmd, resolved: false,
      }])
    }
    if (data.type === 'architect_proposal') {
      setArchitectToast({ proposalId: data.proposalId, summary: data.summary, vetoDeadline: data.vetoDeadline })
    }
    if (data.type === 'architect_applied') {
      if (Notification.permission === 'granted') {
        new Notification('Architect applied a patch', { body: data.summary, icon: '/favicon.ico' })
      }
      setArchitectToast(null)
    }
  }, [currentSessionId])

  const wsUrl = (() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws/session`
  })()
  useReconnectingWs(wsUrl, handleWsMessage)

  // ── Actions ──────────────────────────────────────────────────────

  const resolveApproval = useCallback((approvalId: string) => {
    setMessages(prev => prev.map(m =>
      m.approvalId === approvalId ? { ...m, resolved: true } : m
    ))
  }, [])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    const imageForSend = pendingImage
    setPendingImage(null)
    setMessages(m => [...m, { role: 'user', content: text, imageUrl: imageForSend ?? undefined }])
    setThinkingDomain(guessDomain(text))
    setLoading(true)
    inputRef2.current?.focus()

    try {
      if (teamMode) {
        const res = await coreClient.runTeam(text, currentSessionId)
        setMessages(m => [...m, { role: 'team', content: res.reply, subtasks: res.subtasks, subtaskCount: res.subtaskCount }])
        speakText(res.reply)
        if (Notification.permission === 'granted') {
          new Notification('Team run complete', { body: res.reply.slice(0, 100), icon: '/favicon.ico' })
        }
        return
      }

      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: currentSessionId,
          ...(imageForSend ? { images: [imageForSend.replace(/^data:[^;]+;base64,/, '')] } : {}),
          ...(selectedAgentId ? { agentId: selectedAgentId } : {}),
        }),
      })

      if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`)

      setMessages(m => [...m, { role: 'assistant', content: '' }])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullReply = ''
      let eventType = ''
      let gotFirstEvent = false

      const timeoutId = setTimeout(() => { reader.cancel() }, 90_000)

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) { eventType = line.slice(7).trim(); if (!gotFirstEvent) { gotFirstEvent = true; clearTimeout(timeoutId) } continue }
          if (!line.startsWith('data: ')) { eventType = ''; continue }
          try {
            const data = JSON.parse(line.slice(6))
            if (eventType === 'token') {
              fullReply += data.token
              setMessages(m => {
                if (m.length === 0) return m
                const copy = [...m]
                copy[copy.length - 1] = { ...copy[copy.length - 1], content: fullReply }
                return copy
              })
            } else if (eventType === 'domain') {
              setActiveDomain((data.domain as AgentDomain | undefined) ?? 'general')
              setMessages(m => {
                if (m.length === 0) return m
                const copy = [...m]
                copy[copy.length - 1] = { ...copy[copy.length - 1], domain: data.domain }
                return copy
              })
            } else if (eventType === 'reply') {
              fullReply = data.reply
              setMessages(m => {
                if (m.length === 0) return m
                const copy = [...m]
                copy[copy.length - 1] = { ...copy[copy.length - 1], content: fullReply, domain: data.domain }
                return copy
              })
              setActiveDomain((data.domain as AgentDomain | undefined) ?? 'general')
            } else if (eventType === 'approval') {
              setMessages(m => [...m, { role: 'approval', content: '', approvalId: data.approvalId, agentName: data.agentName, toolName: data.toolName, cmd: data.cmd, resolved: false }])
            } else if (eventType === 'error') {
              const errMsg = data.message ?? 'The agent encountered an error.'
              setMessages(m => {
                if (m.length === 0) return m
                const copy = [...m]
                copy[copy.length - 1] = { ...copy[copy.length - 1], content: `Warning: ${errMsg}` }
                return copy
              })
            }
          } catch {}
          eventType = ''
        }
      }

      clearTimeout(timeoutId)

      if (!fullReply) {
        setMessages(m => {
          if (m.length === 0) return m
          const copy = [...m]
          const last = copy[copy.length - 1]
          if (last?.role === 'assistant' && !last.content) {
            const msg = gotFirstEvent
              ? '(No response received. The model may have returned an empty reply.)'
              : '(No response from server — Ollama may be loading the model or not running. Try again in a moment.)'
            copy[copy.length - 1] = { ...last, content: msg }
          }
          return copy
        })
      }

      speakText(fullReply)
    } catch {
      setMessages(m => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        if (last?.role === 'assistant' && !last.content) {
          copy[copy.length - 1] = { role: 'assistant', content: 'Connection error. Please try again.' }
        } else {
          copy.push({ role: 'assistant', content: 'Connection error. Please try again.' })
        }
        return copy
      })
    } finally {
      setLoading(false)
      inputRef2.current?.focus()
    }
  }
  sendRef.current = send

  const toggleMic = () => {
    if (!recognitionRef.current) return alert('Speech recognition not supported in this browser.')
    if (isListening) { recognitionRef.current.stop(); setIsListening(false) }
    else { setInput(''); recognitionRef.current.start(); setIsListening(true) }
  }

  const copyMessage = useCallback((content: string, idx: number) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 1500)
    })
  }, [])


  const handleSuggestion = useCallback((sug: string) => {
    setInput(sug)
    setSuggestions(prev => prev.filter(s => s !== sug))
  }, [])

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    setFileNotice(`Reading ${file.name}...`)
    try {
      const result = await coreClient.uploadFile(file)
      if (result.isImage && result.dataUrl) {
        setPendingImage(result.dataUrl)
        setFileNotice(`Image attached: ${result.filename}`)
        setTimeout(() => setFileNotice(''), 2000)
      } else {
        setInput(prev => `${prev ? prev + '\n\n' : ''}[File: ${result.filename}]\n${result.text ?? ''}`.slice(0, 8000))
        setFileNotice('')
      }
      inputRef2.current?.focus()
    } catch (err: any) {
      setFileNotice(`Error: ${err.message}`)
      setTimeout(() => setFileNotice(''), 4000)
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-screen text-white relative"
      style={{ background: activeBg.css }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="absolute inset-0 pointer-events-none" style={{ background: activeBg.overlay }} />

      {bgPickerOpen && <BackgroundPicker bgPresetId={bgPresetId} bgCustomUrl={bgCustomUrl} onApply={applyBg} onClose={() => setBgPickerOpen(false)} />}

      {dragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-cyan-900/30 border-2 border-dashed border-cyan-500 pointer-events-none">
          <div className="text-cyan-300 text-2xl font-mono">Drop file to attach</div>
        </div>
      )}

      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}

      {architectToast && (
        <ArchitectToast
          proposalId={architectToast.proposalId}
          summary={architectToast.summary}
          vetoDeadline={architectToast.vetoDeadline}
          onVeto={async () => {
            try {
              await fetch('/api/admin/architect/veto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposalId: architectToast.proposalId }) })
            } catch {}
            setArchitectToast(null)
          }}
          onDismiss={() => setArchitectToast(null)}
        />
      )}

      {/* Multi-pane grid */}
      {paneCount > 1 && (() => {
        const [cols] = PANE_GRID[paneCount] ?? [2, 1]
        return (
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '4px', padding: '4px' }}>
            {Array.from({ length: paneCount }, (_, i) => (
              <ChatPane key={i} paneIndex={i} agents={agentList} focused={focusedPane === i} onFocus={() => setFocusedPane(i)} compact={paneCount >= 4} />
            ))}
          </div>
        )
      })()}

      {/* Single-pane body */}
      <div className="flex flex-1 min-h-0" style={{ display: paneCount > 1 ? 'none' : 'flex' }}>

      {/* Character rail (desktop) */}
      {!isMobile && (agentList.length > 0 || agentListError) && (
        <div className="flex flex-col items-center gap-1 py-4 overflow-y-auto shrink-0 z-10"
          style={{ width: '72px', borderRight: '1px solid rgba(255,255,255,0.05)', background: 'rgba(5,10,15,0.6)', backdropFilter: 'blur(12px)' }}>
          {personaAgentId && (() => {
            const persona = agentList.find(a => a.id === personaAgentId)
            if (!persona) return null
            const isSelected = selectedAgentId === personaAgentId
            return (
              <>
                <button onClick={() => setSelectedAgentId(isSelected ? null : personaAgentId)} title={persona.name}
                  className="flex flex-col items-center gap-1 transition-all duration-200"
                  style={{ opacity: isSelected ? 1 : 0.55, transform: isSelected ? 'scale(1.12)' : 'scale(1)' }}>
                  <div className="w-12 h-12 rounded-full border-2 flex items-center justify-center text-base transition-all"
                    style={isSelected
                      ? { borderColor: '#00e5ff', background: 'rgba(0,229,255,0.15)', color: '#00e5ff', boxShadow: '0 0 16px rgba(0,229,255,0.45)' }
                      : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#6b7280' }
                    }>✦</div>
                  <span className="text-[8px] font-mono" style={{ color: isSelected ? '#00e5ff' : '#4b5563' }}>YOU</span>
                </button>
                <div className="w-8 h-px bg-white/5 my-1 shrink-0" />
              </>
            )
          })()}
          <AgentCharacters agents={agentList} selected={selectedAgentId} onSelect={setSelectedAgentId} vertical />
          {agentListError && agentList.length === 0 && (
            <div className="text-[8px] font-mono text-center px-1 mt-2 leading-tight" style={{ color: '#f59e0b' }} title="Could not load agents">agents<br />offline</div>
          )}
        </div>
      )}

      {/* Main chat column */}
      <div className="flex flex-col flex-1 min-w-0">

      <MessageList
        messages={messages} loading={loading} suggestions={suggestions}
        copiedIdx={copiedIdx} fileNotice={fileNotice}
        onCopy={copyMessage} onSuggestion={handleSuggestion} onResolveApproval={resolveApproval}
      />

      {/* Mobile agent drawer */}
      {isMobile && (agentList.length > 0 || agentListError) && (
        <>
          <button onClick={() => setAgentDrawerOpen(o => !o)}
            style={{ position: 'fixed', bottom: '84px', left: '12px', zIndex: 30, background: 'rgba(5,10,15,0.92)', border: '1px solid rgba(0,229,255,0.30)', borderRadius: '50%', width: '40px', height: '40px', color: '#00e5ff', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            aria-label="Toggle agent selector">✳</button>
          {agentDrawerOpen && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setAgentDrawerOpen(false)}>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(5,10,15,0.97)', borderTop: '1px solid rgba(0,229,255,0.20)', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px' }} onClick={e => e.stopPropagation()}>
                <p className="text-xs font-mono text-center mb-4" style={{ color: '#94adc4' }}>Select Agent</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center', alignItems: 'flex-end' }}>
                  {personaAgentId && (() => {
                    const persona = agentList.find(a => a.id === personaAgentId)
                    if (!persona) return null
                    const isSelected = selectedAgentId === personaAgentId
                    return (
                      <button onClick={() => { setSelectedAgentId(isSelected ? null : personaAgentId); setAgentDrawerOpen(false) }} title={persona.name}
                        className="shrink-0 flex flex-col items-center gap-1 transition-all duration-200" style={{ opacity: isSelected ? 1 : 0.55 }}>
                        <div className="w-14 h-14 rounded-full border-2 flex items-center justify-center text-xl transition-all"
                          style={isSelected
                            ? { borderColor: '#00e5ff', background: 'rgba(0,229,255,0.15)', color: '#00e5ff', boxShadow: '0 0 16px rgba(0,229,255,0.45)' }
                            : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#6b7280' }
                          }>✦</div>
                        <span className="text-[9px] font-mono" style={{ color: isSelected ? '#00e5ff' : '#374151' }}>{persona.name}</span>
                      </button>
                    )
                  })()}
                  <AgentCharacters agents={agentList} selected={selectedAgentId} onSelect={(id) => { setSelectedAgentId(id); setAgentDrawerOpen(false) }} vertical={false} />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="glass-panel rounded-none border-x-0 border-b-0 px-4 pt-2 pb-4 shadow-[0_-10px_30px_rgba(0,0,0,0.5)] z-10" style={isMobile ? { paddingBottom: '24px' } : {}}>
        <div className="flex justify-end max-w-4xl mx-auto mb-2">
          <button onClick={() => setTeamMode(t => !t)}
            className={`text-xs font-mono px-3 py-1 rounded-full border transition-all ${teamMode ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300' : 'border-gray-700 text-gray-600 hover:border-gray-500 hover:text-gray-400'}`}>
            {teamMode ? 'TEAM MODE ON' : 'team mode'}
          </button>
        </div>
        <div className="flex gap-4 max-w-4xl mx-auto items-end">
          <div className="flex-1 relative">
            {skillSuggestions.length > 0 && (
              <div className="absolute bottom-full mb-1 left-0 right-0 bg-gray-950 border border-cyan-800/50 rounded-xl overflow-hidden shadow-xl z-20">
                {skillSuggestions.map(s => (
                  <button key={s.name}
                    onMouseDown={e => {
                      e.preventDefault()
                      const vars = [...s.prompt.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1])
                      if (vars.length > 0) {
                        setPendingSkill({ prompt: s.prompt })
                        setSkillVars(Object.fromEntries(vars.map(v => [v, ''])))
                        setInput('')
                      } else {
                        setInput(s.prompt)
                      }
                      setSkillSuggestions([])
                    }}
                    className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-cyan-500/10 transition-colors">
                    <span className="font-mono text-xs text-cyan-400">/{s.name}</span>
                    <span className="text-xs text-gray-500 truncate">{s.description}</span>
                  </button>
                ))}
              </div>
            )}

            {pendingSkill && skillVars && (
              <div className="absolute bottom-full mb-1 left-0 right-0 bg-gray-950 border border-cyan-800/50 rounded-xl p-4 shadow-xl z-20">
                <p className="text-xs font-mono text-cyan-400 mb-3">Fill in skill variables:</p>
                <div className="space-y-2 mb-3">
                  {Object.keys(skillVars).map(v => (
                    <div key={v} className="flex items-center gap-2">
                      <span className="text-xs font-mono text-cyan-600/80 w-20 shrink-0">{`{{${v}}}`}</span>
                      <input autoFocus
                        className="flex-1 bg-black/40 border border-white/10 text-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-cyan-500/50"
                        value={skillVars[v]}
                        onChange={e => setSkillVars(sv => ({ ...sv!, [v]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const resolved = pendingSkill.prompt.replace(/\{\{(\w+)\}\}/g, (_, k) => skillVars[k] ?? '')
                            setInput(resolved); setPendingSkill(null); setSkillVars(null); inputRef2.current?.focus()
                          } else if (e.key === 'Escape') {
                            setPendingSkill(null); setSkillVars(null)
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onMouseDown={e => { e.preventDefault()
                    const resolved = pendingSkill.prompt.replace(/\{\{(\w+)\}\}/g, (_, k) => skillVars[k] ?? '')
                    setInput(resolved); setPendingSkill(null); setSkillVars(null); inputRef2.current?.focus()
                  }} className="text-xs font-mono px-3 py-1 bg-cyan-500/10 border border-cyan-500/40 text-cyan-400 rounded hover:bg-cyan-500/20 transition-colors">Apply</button>
                  <button onMouseDown={() => { setPendingSkill(null); setSkillVars(null) }} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">cancel</button>
                </div>
              </div>
            )}

            {pendingImage && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <img src={pendingImage} alt="pending" className="h-12 w-12 rounded object-cover border border-cyan-800/50" />
                <span className="text-xs text-cyan-400 font-mono flex-1">Image ready to send</span>
                <button onClick={() => setPendingImage(null)} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
              </div>
            )}
            <input ref={inputRef2}
              className="w-full bg-gray-950/80 border border-gray-700 text-cyan-50 font-mono rounded-xl px-5 py-4 text-sm focus:outline-none focus:border-cyan-500 focus:shadow-[0_0_15px_rgba(0,255,255,0.2)] transition-all placeholder:text-gray-600"
              style={{ fontSize: '16px' }}
              value={input}
              onChange={(e) => {
                const val = e.target.value
                setInput(val)
                if (val.startsWith('/') && val.length > 1 && !val.includes(' ')) {
                  setSkillSuggestions(skills.filter(s => s.name.startsWith(val.slice(1).toLowerCase())).slice(0, 6))
                } else {
                  setSkillSuggestions([])
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setSkillSuggestions([]); return }
                if (e.key === 'Enter' && !e.shiftKey) send()
              }}
              placeholder={isListening ? '> Listening...' : teamMode ? '> Describe a complex task for the swarm...' : '> Execute command or /skill...'}
              autoFocus
            />
            {loading && <div className="absolute right-4 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400 animate-ping" />}
          </div>

          <button onClick={toggleMic} disabled={loading} className={`w-12 h-12 flex items-center justify-center rounded-xl transition-all ${isListening ? 'bg-red-500/20 text-red-500 border border-red-500 animate-pulse' : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-cyan-400 hover:border-cyan-500/50'}`}>
            {isListening ? 'stop' : 'mic'}
          </button>

          <button onClick={send} disabled={!input.trim() || loading} className="px-8 py-4 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-30 text-black font-bold font-mono tracking-widest rounded-xl transition-all text-sm hover:scale-105 active:scale-95 hover:shadow-[0_0_20px_rgba(0,255,255,0.4)]">
            {teamMode ? 'DEPLOY' : 'EXECUTE'}
          </button>
        </div>
        <p className="text-center text-xs text-gray-700 mt-2 font-mono">drag a file to attach · press ? for shortcuts</p>
      </div>

      </div>{/* end main chat column */}
      </div>{/* end body row */}
    </div>
  )
}

export default function ChatPage() {
  const [sessionId] = useState(() => `session-${Date.now()}`)
  return <Chat sessionId={sessionId} onNav={() => {}} />
}

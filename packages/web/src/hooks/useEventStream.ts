import { useEffect, useRef, useState, useCallback } from 'react'
import { coreHttpOrigin } from '../platform/coreOrigin'

function adminHeaders(): Record<string, string> {
  const session = sessionStorage.getItem('cc_admin_session') ?? ''
  return session ? { 'x-admin-session': session } : {}
}

// EventSource can't send the x-admin-session header, so a network-exposed
// server requires a short-lived ticket (minted via an ordinary,
// header-authenticated POST) passed as a query param instead. On a
// localhost-only server this call still succeeds — the endpoint just isn't
// gated — so the extra round trip is harmless either way.
async function fetchTicket(): Promise<string | null> {
  try {
    const res = await fetch(`${coreHttpOrigin()}/api/events/ticket`, {
      method: 'POST',
      headers: adminHeaders(),
    })
    if (!res.ok) return null
    const { ticket } = await res.json() as { ticket: string }
    return ticket
  } catch {
    return null
  }
}

export interface AgentEvent {
  type: string
  ts: number
  sessionId?: string
  agentId?: string
  toolName?: string
  args?: Record<string, unknown>
  durationMs?: number
  decision?: string
  success?: boolean
  toolCallCount?: number
  tokenCount?: number
  jobName?: string
  status?: string
  title?: string
  url?: string
}

export function useEventStream(maxEvents = 100) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)
  const connectRef = useRef<() => void>(() => {})

  const connect = useCallback(async () => {
    if (esRef.current) esRef.current.close()

    const ticket = await fetchTicket()
    if (cancelledRef.current) return

    const url = ticket
      ? `${coreHttpOrigin()}/api/events?ticket=${encodeURIComponent(ticket)}`
      : `${coreHttpOrigin()}/api/events`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => setConnected(true)

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AgentEvent
        setEvents(prev => {
          const next = [...prev, event]
          return next.length > maxEvents ? next.slice(-maxEvents) : next
        })
      } catch {
        /* skip malformed event */
      }
    }

    es.onerror = () => {
      setConnected(false)
      es.close()
      // Reconnect after 3s — store timeout so cleanup can cancel it
      reconnectRef.current = setTimeout(() => connectRef.current(), 3000)
    }
  }, [maxEvents])

  useEffect(() => {
    connectRef.current = () => { void connect() }
  }, [connect])

  useEffect(() => {
    cancelledRef.current = false
    void connect()
    return () => {
      cancelledRef.current = true
      esRef.current?.close()
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
    }
  }, [connect])

  const clear = useCallback(() => setEvents([]), [])

  return { events, connected, clear }
}

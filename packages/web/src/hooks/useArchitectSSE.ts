import { useEffect, useRef } from 'react'
import { coreHttpOrigin } from '../platform/coreOrigin'

const BASE_URL = coreHttpOrigin()

type Listener = (event: any) => void

// Shared SSE connection — one EventSource for all subscribers
let es: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

function broadcast(event: any) {
  for (const fn of listeners) {
    try { fn(event) } catch (err) { console.error('[useArchitectSSE] listener threw', err) }
  }
}

function ensureConnected() {
  if (es) return

  const url = `${BASE_URL}/api/admin/architect/events?since=${Date.now()}`
  es = new EventSource(url)

  es.onmessage = (msg) => {
    try {
      broadcast(JSON.parse(msg.data))
    } catch (err) {
      console.error('[useArchitectSSE] failed to parse event data', err, msg.data)
    }
  }

  es.onerror = () => {
    es?.close()
    es = null
    reconnectTimer = setTimeout(ensureConnected, 5000)
  }
}

function disconnect() {
  es?.close()
  es = null
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function subscribe(fn: Listener) {
  listeners.add(fn)
  ensureConnected()
}

function unsubscribe(fn: Listener) {
  listeners.delete(fn)
  if (listeners.size === 0) disconnect()
}

/**
 * Subscribe to the shared architect SSE event stream.
 * A single EventSource is shared across all subscribers.
 * Connection closes when the last subscriber unmounts.
 */
export function useArchitectSSE(onEvent: (event: any) => void) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    const handler: Listener = (event) => onEventRef.current(event)
    subscribe(handler)
    return () => unsubscribe(handler)
  }, [])
}

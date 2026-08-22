import { useRef, useEffect, useCallback } from 'react'

export function useReconnectingWs(url: string, onMessage: (data: any) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const delayRef = useRef(1000)
  const onMessageRef = useRef(onMessage)

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  const connect = useCallback(() => {
    const ws = new WebSocket(url)
    wsRef.current = ws
    ws.onopen = () => {
      delayRef.current = 1000
      // A browser WebSocket can't attach a custom header to the upgrade
      // handshake, so /ws/session authenticates via this first message
      // instead. Harmless no-op on a localhost-only server, which doesn't
      // require it.
      const token = sessionStorage.getItem('cc_admin_session') ?? ''
      ws.send(JSON.stringify({ type: 'auth', token }))
    }
    ws.onmessage = (e) => {
      try { onMessageRef.current(JSON.parse(e.data)) } catch {}
    }
    ws.onclose = () => {
      timerRef.current = setTimeout(() => {
        delayRef.current = Math.min(delayRef.current * 2, 30_000)
        connect()
      }, delayRef.current)
    }
    ws.onerror = () => ws.close()
  }, [url])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [connect])
}

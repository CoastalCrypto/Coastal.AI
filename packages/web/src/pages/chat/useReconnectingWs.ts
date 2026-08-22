import { useRef, useEffect, useCallback } from 'react'

export function useReconnectingWs<T>(url: string, onMessage: (data: T) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const delayRef = useRef(1000)
  const onMessageRef = useRef(onMessage)
  const connectRef = useRef<() => void>(() => {})

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  const connect = useCallback(() => {
    const ws = new WebSocket(url)
    wsRef.current = ws
    ws.onopen = () => { delayRef.current = 1000 }
    ws.onmessage = (e) => {
      try { onMessageRef.current(JSON.parse(e.data)) } catch (err) { console.error('[useReconnectingWs] failed to parse message', err, e.data) }
    }
    ws.onclose = () => {
      timerRef.current = setTimeout(() => {
        delayRef.current = Math.min(delayRef.current * 2, 30_000)
        connectRef.current()
      }, delayRef.current)
    }
    ws.onerror = () => ws.close()
  }, [url])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [connect])
}

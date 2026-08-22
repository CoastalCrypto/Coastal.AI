import { useRef, useEffect, useCallback } from 'react'

export function useReconnectingWs<T>(url: string, onMessage: (data: T) => void) {
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
    ws.onopen = () => { delayRef.current = 1000 }
    ws.onmessage = (e) => {
      try { onMessageRef.current(JSON.parse(e.data)) } catch (err) { console.error('[useReconnectingWs] failed to parse message', err, e.data) }
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

import { useEffect, useState, useRef, useCallback } from 'react'
import { coreClient, type AgentMemorySummary } from '../api/client'

const POLL_INTERVAL_MS = 30_000

/**
 * Polls the per-agent memory summary used by the mycelium graph to render
 * "memory bloom" satellites around each agent. Memory grows on a minute
 * timescale, so a 30s poll matches reality without churning the UI.
 */
export function useAgentMemory() {
  const [summary, setSummary] = useState<Record<string, AgentMemorySummary>>({})
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const data = await coreClient.getAgentMemorySummary()
      if (!cancelledRef.current) {
        setSummary(data)
        setError(null)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load memory summary'
      if (!cancelledRef.current) setError(msg)
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    void (async () => { await load() })()
    intervalRef.current = setInterval(load, POLL_INTERVAL_MS)

    return () => {
      cancelledRef.current = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [load])

  return { summary, error, refresh: load }
}

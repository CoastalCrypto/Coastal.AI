import type { OpenObserveClient } from './openobserve-client.js'

export const HEARTBEAT_STREAM = 'heartbeats'

/** Emit one liveness pulse. Best-effort: never throws (telemetry loss must not kill the node). */
export async function emitHeartbeat(
  client: OpenObserveClient, nodeId: string, role: string, now: number, ok = true,
): Promise<void> {
  try {
    await client.ingest(HEARTBEAT_STREAM, [{ nodeId, role, ts: now, ok }])
  } catch (err) {
    console.warn(`[heartbeat] emit failed for ${nodeId}: ${(err as Error).message}`)
  }
}

/** Schedule heartbeat emission on an interval. Returns a stop handle. */
export function startHeartbeat(
  client: OpenObserveClient, nodeId: string, role: string, intervalMs: number, now: () => number = Date.now,
): { stop: () => void } {
  const timer = setInterval(() => void emitHeartbeat(client, nodeId, role, now()), intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

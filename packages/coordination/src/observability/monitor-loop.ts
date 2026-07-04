import type { OpenObserveClient } from './openobserve-client.js'
import type { Alert } from './health-eval.js'
import { checkClusterHealth } from './monitor.js'

/** One monitor pass: query health -> notify. Best-effort: never throws. */
export async function runMonitorOnce(
  client: OpenObserveClient,
  expectedNodeIds: string[],
  now: number,
  stalenessMs: number,
  notify: (alerts: Alert[]) => void,
): Promise<void> {
  try {
    notify(await checkClusterHealth(client, expectedNodeIds, now, stalenessMs))
  } catch (err) {
    console.warn(`[monitor] health check failed: ${(err as Error).message}`)
  }
}

/** Schedule the monitor pass on an interval. Returns a stop handle. */
export function startMonitorLoop(
  client: OpenObserveClient,
  expectedNodeIds: string[],
  stalenessMs: number,
  intervalMs: number,
  notify: (alerts: Alert[]) => void,
  now: () => number = Date.now,
): { stop: () => void } {
  const timer = setInterval(() => void runMonitorOnce(client, expectedNodeIds, now(), stalenessMs, notify), intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

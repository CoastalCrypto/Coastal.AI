export interface Heartbeat { nodeId: string; role: string; ts: number; ok: boolean }
export interface Alert { nodeId: string; role: string; severity: 'warn' | 'critical'; reason: string }

/**
 * Given the latest heartbeat per node, `now`, and a staleness threshold (ms),
 * return alerts: expected nodes with no heartbeat ever are 'critical'; nodes with
 * no heartbeat within the threshold are 'critical' (stale); nodes whose latest
 * heartbeat has ok=false are 'warn'. Pure — no I/O.
 */
export function evaluateHealth(
  latest: Heartbeat[],
  expectedNodeIds: string[],
  now: number,
  stalenessMs: number,
): Alert[] {
  const byId = new Map(latest.map(h => [h.nodeId, h]))
  const alerts: Alert[] = []
  for (const id of expectedNodeIds) {
    const hb = byId.get(id)
    if (!hb) {
      alerts.push({ nodeId: id, role: 'unknown', severity: 'critical', reason: 'no heartbeat ever seen' })
      continue
    }
    if (now - hb.ts > stalenessMs) {
      alerts.push({ nodeId: id, role: hb.role, severity: 'critical', reason: `stale (no heartbeat in ${Math.round(stalenessMs / 1000)}s)` })
    } else if (!hb.ok) {
      alerts.push({ nodeId: id, role: hb.role, severity: 'warn', reason: 'heartbeat reported not-ok' })
    }
  }
  return alerts
}

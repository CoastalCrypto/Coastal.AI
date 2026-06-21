import type { OpenObserveClient } from './openobserve-client.js'
import { evaluateHealth, type Heartbeat, type Alert } from './health-eval.js'

/**
 * SQL for the latest heartbeat per node within the lookback window. Uses a
 * window-function dedupe so the row carrying MAX(ts) keeps its own `ok`/`role`
 * (a plain GROUP BY MAX(ts) would not). `sinceMs` bounds the scan.
 */
export function latestHeartbeatSql(sinceMs: number): string {
  return (
    `SELECT nodeId, role, ts, ok FROM (` +
    `SELECT nodeId, role, ts, ok, ` +
    `ROW_NUMBER() OVER (PARTITION BY nodeId ORDER BY ts DESC) AS rn ` +
    `FROM heartbeats WHERE ts >= ${sinceMs}` +
    `) WHERE rn = 1`
  )
}

/**
 * The Monitor's core check: query openobserve for each node's latest heartbeat,
 * map to {@link Heartbeat}, and evaluate health into alerts. The daemon loop is
 * just `setInterval(() => checkClusterHealth(...).then(notify))` — kept separate
 * (and cluster-gated) so this composition stays pure-ish and testable.
 */
export async function checkClusterHealth(
  client: OpenObserveClient,
  expectedNodeIds: string[],
  now: number,
  stalenessMs: number,
): Promise<Alert[]> {
  const rows = await client.query(latestHeartbeatSql(now - stalenessMs * 2))
  const latest: Heartbeat[] = rows.map(r => ({
    nodeId: String(r.nodeId),
    role: r.role == null ? 'unknown' : String(r.role),
    ts: Number(r.ts),
    ok: Boolean(r.ok),
  }))
  return evaluateHealth(latest, expectedNodeIds, now, stalenessMs)
}

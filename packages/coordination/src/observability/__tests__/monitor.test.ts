import { describe, it, expect } from 'vitest'
import { checkClusterHealth } from '../monitor.js'
import type { OpenObserveClient } from '../openobserve-client.js'

const now = 1_000_000
function clientReturning(rows: Record<string, unknown>[]): OpenObserveClient {
  return { query: async () => rows, ingest: async () => ({ ingested: 0 }) }
}

describe('checkClusterHealth', () => {
  it('maps heartbeat rows and flags absent + fresh nodes correctly', async () => {
    const client = clientReturning([{ nodeId: 'n1', role: 'coder', ts: now - 1000, ok: true }])
    const alerts = await checkClusterHealth(client, ['n1', 'n9'], now, 30_000)
    expect(alerts).toEqual([
      { nodeId: 'n9', role: 'unknown', severity: 'critical', reason: 'no heartbeat ever seen' },
    ])
  })

  it('flags a stale node as critical', async () => {
    const client = clientReturning([{ nodeId: 'n1', role: 'coder', ts: now - 90_000, ok: true }])
    const alerts = await checkClusterHealth(client, ['n1'], now, 30_000)
    expect(alerts[0]).toMatchObject({ nodeId: 'n1', severity: 'critical' })
  })
})

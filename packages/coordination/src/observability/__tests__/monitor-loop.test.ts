import { describe, it, expect } from 'vitest'
import { runMonitorOnce } from '../monitor-loop.js'
import type { OpenObserveClient } from '../openobserve-client.js'
import type { Alert } from '../health-eval.js'

const now = 1_000_000

describe('runMonitorOnce', () => {
  it('queries health and passes alerts to notify', async () => {
    const client: OpenObserveClient = {
      query: async () => [],            // no heartbeats -> both expected nodes absent
      ingest: async () => ({ ingested: 0 }),
    }
    const got: Alert[][] = []
    await runMonitorOnce(client, ['n1', 'n2'], now, 30_000, a => got.push(a))
    expect(got).toHaveLength(1)
    expect(got[0].map(a => a.nodeId).sort()).toEqual(['n1', 'n2'])
    expect(got[0].every(a => a.severity === 'critical')).toBe(true)
  })
  it('swallows query errors so the loop survives', async () => {
    const client: OpenObserveClient = {
      query: async () => { throw new Error('down') },
      ingest: async () => ({ ingested: 0 }),
    }
    await expect(runMonitorOnce(client, ['n1'], now, 30_000, () => {})).resolves.toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import { emitHeartbeat } from '../heartbeat.js'
import type { OpenObserveClient } from '../openobserve-client.js'

describe('emitHeartbeat', () => {
  it('ingests one {nodeId, role, ts, ok} row to the heartbeats stream', async () => {
    const calls: { stream: string; events: Record<string, unknown>[] }[] = []
    const client: OpenObserveClient = {
      ingest: async (stream, events) => { calls.push({ stream, events }); return { ingested: events.length } },
      query: async () => [],
    }
    await emitHeartbeat(client, 'n1', 'coder', 5000)
    expect(calls).toEqual([{ stream: 'heartbeats', events: [{ nodeId: 'n1', role: 'coder', ts: 5000, ok: true }] }])
  })
  it('swallows ingest errors (telemetry loss must not crash the node)', async () => {
    const client: OpenObserveClient = {
      ingest: async () => { throw new Error('openobserve down') },
      query: async () => [],
    }
    await expect(emitHeartbeat(client, 'n1', 'coder', 5000)).resolves.toBeUndefined()
  })
})

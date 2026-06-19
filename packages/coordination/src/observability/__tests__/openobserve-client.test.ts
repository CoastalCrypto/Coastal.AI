import { describe, it, expect } from 'vitest'
import { createOpenObserveClient, type FetchLike } from '../openobserve-client.js'

function stubFetch(captured: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[], resBody: unknown): FetchLike {
  return async (url, init) => { captured.push({ url, init }); return { ok: true, status: 200, json: async () => resBody } }
}

const cfg = (fetchImpl: FetchLike) => ({ baseUrl: 'http://oo:5080', org: 'coastal', auth: 'Basic xyz', fetchImpl })

describe('openobserve client', () => {
  it('ingests a JSON array to the stream endpoint', async () => {
    const cap: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = []
    const c = createOpenObserveClient(cfg(stubFetch(cap, { status: [{ successful: 2 }] })))
    const r = await c.ingest('heartbeats', [{ nodeId: 'n1' }, { nodeId: 'n2' }])
    expect(cap[0].url).toBe('http://oo:5080/api/coastal/heartbeats/_json')
    expect(cap[0].init.method).toBe('POST')
    expect(JSON.parse(cap[0].init.body!)).toHaveLength(2)
    expect(r.ingested).toBe(2)
  })
  it('queries via _search and returns hits', async () => {
    const cap: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = []
    const c = createOpenObserveClient(cfg(stubFetch(cap, { hits: [{ nodeId: 'n1' }] })))
    const rows = await c.query('SELECT * FROM heartbeats')
    expect(cap[0].url).toBe('http://oo:5080/api/coastal/_search')
    expect(rows).toEqual([{ nodeId: 'n1' }])
  })
  it('throws on a non-ok response', async () => {
    const c = createOpenObserveClient(cfg(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    await expect(c.ingest('s', [{}])).rejects.toThrow(/401/)
  })
})

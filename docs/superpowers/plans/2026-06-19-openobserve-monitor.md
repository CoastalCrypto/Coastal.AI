# openobserve Monitor Backend — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Ship the testable openobserve slice: injected-fetch client (ingest/query) + pure health-eval + systemd unit. Live cluster wiring deferred.

**Spec:** `docs/superpowers/specs/2026-06-19-openobserve-monitor-design.md`

---

## Task 1: health-eval (pure)

**Files:**
- Create: `packages/coordination/src/observability/health-eval.ts`
- Test: `packages/coordination/src/observability/__tests__/health-eval.test.ts`

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect } from 'vitest'
import { evaluateHealth } from '../health-eval.js'

const now = 1_000_000
describe('evaluateHealth', () => {
  it('no alert for a fresh ok heartbeat', () => {
    const a = evaluateHealth([{ nodeId: 'n1', role: 'coder', ts: now - 1000, ok: true }], ['n1'], now, 30_000)
    expect(a).toEqual([])
  })
  it('critical for a stale heartbeat', () => {
    const a = evaluateHealth([{ nodeId: 'n1', role: 'coder', ts: now - 60_000, ok: true }], ['n1'], now, 30_000)
    expect(a).toEqual([{ nodeId: 'n1', role: 'coder', severity: 'critical', reason: 'stale (no heartbeat in 30s)' }])
  })
  it('warn for ok=false', () => {
    const a = evaluateHealth([{ nodeId: 'n1', role: 'coder', ts: now, ok: false }], ['n1'], now, 30_000)
    expect(a[0]).toMatchObject({ nodeId: 'n1', severity: 'warn' })
  })
  it('critical for an expected node that never reported', () => {
    const a = evaluateHealth([], ['n9'], now, 30_000)
    expect(a).toEqual([{ nodeId: 'n9', role: 'unknown', severity: 'critical', reason: 'no heartbeat ever seen' }])
  })
})
```

- [ ] **Step 2:** run → FAIL (module missing).
- [ ] **Step 3: implement**

```ts
export interface Heartbeat { nodeId: string; role: string; ts: number; ok: boolean }
export interface Alert { nodeId: string; role: string; severity: 'warn' | 'critical'; reason: string }

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
```

- [ ] **Step 4:** run → PASS. **Step 5:** commit.

## Task 2: openobserve client

**Files:**
- Create: `packages/coordination/src/observability/openobserve-client.ts`
- Test: `packages/coordination/src/observability/__tests__/openobserve-client.test.ts`

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect } from 'vitest'
import { createOpenObserveClient, type FetchLike } from '../openobserve-client.js'

function stubFetch(captured: any[], resBody: unknown): FetchLike {
  return async (url, init) => { captured.push({ url, init }); return { ok: true, status: 200, json: async () => resBody } }
}

const cfg = (fetchImpl: FetchLike) => ({ baseUrl: 'http://oo:5080', org: 'coastal', auth: 'Basic xyz', fetchImpl })

describe('openobserve client', () => {
  it('ingests a JSON array to the stream endpoint', async () => {
    const cap: any[] = []
    const c = createOpenObserveClient(cfg(stubFetch(cap, { status: [{ successful: 2 }] })))
    const r = await c.ingest('heartbeats', [{ nodeId: 'n1' }, { nodeId: 'n2' }])
    expect(cap[0].url).toBe('http://oo:5080/api/coastal/heartbeats/_json')
    expect(cap[0].init.method).toBe('POST')
    expect(JSON.parse(cap[0].init.body)).toHaveLength(2)
    expect(r.ingested).toBe(2)
  })
  it('queries via _search and returns hits', async () => {
    const cap: any[] = []
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
```

- [ ] **Step 2:** run → FAIL. **Step 3: implement**

```ts
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface OpenObserveConfig {
  baseUrl: string
  org: string
  auth: string
  fetchImpl: FetchLike
}

export interface OpenObserveClient {
  ingest(stream: string, events: Record<string, unknown>[]): Promise<{ ingested: number }>
  query(sql: string): Promise<Record<string, unknown>[]>
}

export function createOpenObserveClient(cfg: OpenObserveConfig): OpenObserveClient {
  const headers = { 'Content-Type': 'application/json', Authorization: cfg.auth }
  const base = `${cfg.baseUrl}/api/${cfg.org}`
  return {
    async ingest(stream, events) {
      const res = await cfg.fetchImpl(`${base}/${stream}/_json`, { method: 'POST', headers, body: JSON.stringify(events) })
      if (!res.ok) throw new Error(`openobserve ingest ${stream} failed: HTTP ${res.status}`)
      return { ingested: events.length }
    },
    async query(sql) {
      const body = JSON.stringify({ query: { sql, start_time: 0, end_time: Date.now() * 1000 } })
      const res = await cfg.fetchImpl(`${base}/_search`, { method: 'POST', headers, body })
      if (!res.ok) throw new Error(`openobserve query failed: HTTP ${res.status}`)
      const json = (await res.json()) as { hits?: Record<string, unknown>[] }
      return json.hits ?? []
    },
  }
}
```

- [ ] **Step 4:** run → PASS. **Step 5:** commit.

## Task 3: systemd unit

**Files:**
- Create: `os/base/systemd/coastal-openobserve.service`

- [ ] **Step 1: create the unit**

```ini
[Unit]
Description=Coastal.AI openobserve (Monitor telemetry backend)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=coastal
Environment=ZO_DATA_DIR=/var/lib/coastal/openobserve
Environment=ZO_HTTP_PORT=5080
ExecStart=/usr/local/bin/openobserve
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2:** run full coordination suite → PASS. **Step 3:** commit + push.

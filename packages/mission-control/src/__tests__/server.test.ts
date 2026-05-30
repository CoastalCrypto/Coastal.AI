// packages/mission-control/src/__tests__/server.test.ts
//
// End-to-end tests against a real http server on an ephemeral port.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  openCoordinationDb, TaskStore, ClaimStore,
  createPeerRegistry,
  generateIdentity,
  type A2AMessage, type Task, type TaskInput,
} from '@coastal-ai/coordination'
import { createMissionControl, type MissionControl } from '../index.js'
import type Database from 'better-sqlite3'

// ─── helpers ──────────────────────────────────────────────────────

function makeBroadcast(kind: A2AMessage['kind'], payload: unknown, from = 'main'): A2AMessage {
  return {
    version: '0.1',
    messageId: 'm-' + Math.random().toString(36).slice(2, 10),
    from: { agentId: from, publicKey: 'pk' },
    to: '*',
    timestamp: Date.now(),
    kind,
    payload,
    signature: 'sig',
  }
}

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init)
  const body = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : await res.text()
  return { status: res.status, body }
}

async function postJson(url: string, body: unknown, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  return getJson(url, {
    ...init,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: JSON.stringify(body),
  })
}

// ─── fixture ─────────────────────────────────────────────────────

describe('createMissionControl — HTTP server', () => {
  let db: Database.Database
  let tasks: TaskStore
  let claims: ClaimStore
  let busHandlers: Set<(msg: A2AMessage) => void>
  let mc: MissionControl
  let submitted: TaskInput[]
  let url: string

  beforeEach(async () => {
    db = openCoordinationDb()
    tasks = new TaskStore(db)
    claims = new ClaimStore(db)
    busHandlers = new Set()
    submitted = []
    mc = await createMissionControl({
      db,
      port: 0,
      subscribe: (h) => {
        busHandlers.add(h)
        return () => busHandlers.delete(h)
      },
      submit: async (input) => {
        submitted.push(input)
        return tasks.create(input)
      },
    })
    url = `http://127.0.0.1:${mc.port()}`
  })

  afterEach(async () => {
    await mc.stop()
  })

  // ─── /api/health ───────────────────────────────────────────────────

  it('GET /api/health returns ok', async () => {
    const r = await getJson(`${url}/api/health`)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
  })

  // ─── / (dashboard) ────────────────────────────────────────────────

  it('GET / serves the dashboard HTML', async () => {
    const res = await fetch(`${url}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const body = await res.text()
    expect(body).toContain('Coastal.AI Mission Control')
    // Sanity: the page must hit the API endpoints to actually work
    expect(body).toContain('/api/tasks')
    expect(body).toContain('/api/events')
  })

  it('GET / is exempt from auth (operators open it without a token)', async () => {
    await mc.stop()
    mc = await createMissionControl({
      db, port: 0,
      subscribe: (h) => { busHandlers.add(h); return () => busHandlers.delete(h) },
      submit: async (input) => tasks.create(input),
      authToken: 'secret',
    })
    url = `http://127.0.0.1:${mc.port()}`
    const res = await fetch(`${url}/`)
    expect(res.status).toBe(200)
  })

  // ─── /api/tasks (list) ─────────────────────────────────────────────

  it('GET /api/tasks returns empty list initially', async () => {
    const r = await getJson(`${url}/api/tasks`)
    expect(r.status).toBe(200)
    const body = r.body as { tasks: Task[]; total: number }
    expect(body.tasks).toEqual([])
    expect(body.total).toBe(0)
  })

  it('GET /api/tasks lists existing tasks', async () => {
    tasks.create({ kind: 'code_task', payload: { request: 'a' } })
    tasks.create({ kind: 'review_task', payload: { request: 'b' } })

    const r = await getJson(`${url}/api/tasks`)
    expect(r.status).toBe(200)
    const body = r.body as { tasks: Task[]; total: number }
    expect(body.tasks).toHaveLength(2)
    expect(body.total).toBe(2)
  })

  it('GET /api/tasks?state=queued filters by state', async () => {
    const t1 = tasks.create({ kind: 'code_task', payload: null })
    tasks.update(t1.id, { state: 'claimed', ownerAgentId: 'coder' })
    tasks.create({ kind: 'code_task', payload: null })

    const r = await getJson(`${url}/api/tasks?state=queued`)
    const body = r.body as { tasks: Task[]; total: number }
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].state).toBe('queued')
  })

  it('GET /api/tasks?kind=code_task filters by kind', async () => {
    tasks.create({ kind: 'code_task', payload: null })
    tasks.create({ kind: 'review_task', payload: null })

    const r = await getJson(`${url}/api/tasks?kind=code_task`)
    const body = r.body as { tasks: Task[]; total: number }
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].kind).toBe('code_task')
  })

  it('GET /api/tasks supports limit + offset pagination', async () => {
    for (let i = 0; i < 5; i++) {
      tasks.create({ kind: 'code_task', payload: { i } })
    }
    const r = await getJson(`${url}/api/tasks?limit=2&offset=2`)
    const body = r.body as { tasks: Task[]; total: number }
    expect(body.total).toBe(5)
    expect(body.tasks).toHaveLength(2)
  })

  // ─── /api/tasks/:id ────────────────────────────────────────────────

  it('GET /api/tasks/:id returns task + claim history', async () => {
    const t = tasks.create({ kind: 'code_task', payload: { x: 1 } })
    claims.insert({ taskId: t.id, agentId: 'coder' })
    claims.release(t.id, 'coder', { releaseReason: 'completed' })

    const r = await getJson(`${url}/api/tasks/${t.id}`)
    expect(r.status).toBe(200)
    const body = r.body as { task: Task; claims: unknown[] }
    expect(body.task.id).toBe(t.id)
    expect(body.claims).toHaveLength(1)
  })

  it('GET /api/tasks/:id returns 404 for unknown id', async () => {
    const r = await getJson(`${url}/api/tasks/nope-not-found`)
    expect(r.status).toBe(404)
    expect((r.body as { error: string }).error).toBe('not_found')
  })

  // ─── /api/agents ──────────────────────────────────────────────────

  it('GET /api/agents returns peer-registry contents', async () => {
    // Recreate with a populated registry
    await mc.stop()
    const peerRegistry = createPeerRegistry()
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    peerRegistry.recordOrVerify('agent-A', a.publicKey)
    peerRegistry.recordOrVerify('agent-B', b.publicKey)
    mc = await createMissionControl({
      db, port: 0, peerRegistry,
      subscribe: (h) => { busHandlers.add(h); return () => busHandlers.delete(h) },
      submit: async (input) => tasks.create(input),
    })
    url = `http://127.0.0.1:${mc.port()}`

    const r = await getJson(`${url}/api/agents`)
    expect(r.status).toBe(200)
    const body = r.body as { agents: { agentId: string; publicKeyShort: string }[] }
    expect(body.agents.map(a => a.agentId).sort()).toEqual(['agent-A', 'agent-B'])
    expect(body.agents[0].publicKeyShort).toMatch(/^[0-9a-f]{16}$/)
  })

  // ─── POST /api/tasks ──────────────────────────────────────────────

  it('POST /api/tasks creates a new task via the daemon submit', async () => {
    const r = await postJson(`${url}/api/tasks`, {
      kind: 'code_task',
      payload: { request: 'build it' },
    })
    expect(r.status).toBe(201)
    const body = r.body as { task: Task }
    expect(body.task.kind).toBe('code_task')
    expect(submitted).toHaveLength(1)
    expect((submitted[0].payload as { request: string }).request).toBe('build it')
  })

  it('POST /api/tasks rejects missing kind', async () => {
    const r = await postJson(`${url}/api/tasks`, { payload: {} })
    expect(r.status).toBe(400)
    expect((r.body as { error: string }).error).toBe('invalid_request')
  })

  // ─── /api/events (SSE) ────────────────────────────────────────────

  it('GET /api/events streams A2A state-change broadcasts as SSE frames', async () => {
    const res = await fetch(`${url}/api/events`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    // Fire a broadcast that should be forwarded
    setTimeout(() => {
      for (const h of busHandlers) h(makeBroadcast('task.complete', { task: { id: 't1' } }))
    }, 10)

    // Read until we see a data: line for our event
    let buffer = ''
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.includes('event: a2a') && buffer.includes('data: ')) break
    }
    await reader.cancel()

    expect(buffer).toContain('event: a2a')
    expect(buffer).toContain('"kind":"task.complete"')
  })

  it('GET /api/events does NOT forward heartbeats / observation messages', async () => {
    const res = await fetch(`${url}/api/events`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    // Fire only filtered-out kinds
    setTimeout(() => {
      for (const h of busHandlers) h(makeBroadcast('task.heartbeat', {}))
      for (const h of busHandlers) h(makeBroadcast('task.observe', {}))
    }, 10)

    // Cancel the reader after 200ms to unblock reader.read() — without
    // this the read blocks forever because no data is forwarded.
    const cancelTimer = setTimeout(() => {
      reader.cancel().catch(() => { /* expected */ })
    }, 200)

    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
      }
    } catch { /* cancellation throws — that's the exit signal */ }
    clearTimeout(cancelTimer)

    expect(buffer).not.toContain('"kind":"task.heartbeat"')
    expect(buffer).not.toContain('"kind":"task.observe"')
  })

  // ─── 404 / unknown routes ─────────────────────────────────────────

  it('returns 404 for unknown routes', async () => {
    const r = await getJson(`${url}/api/bogus`)
    expect(r.status).toBe(404)
    expect((r.body as { error: string }).error).toBe('not_found')
  })

  // ─── Auth ─────────────────────────────────────────────────────────

  it('rejects unauthenticated requests when authToken is set', async () => {
    await mc.stop()
    mc = await createMissionControl({
      db, port: 0,
      subscribe: (h) => { busHandlers.add(h); return () => busHandlers.delete(h) },
      submit: async (input) => tasks.create(input),
      authToken: 'secret-token',
    })
    url = `http://127.0.0.1:${mc.port()}`

    const noAuth = await getJson(`${url}/api/tasks`)
    expect(noAuth.status).toBe(401)

    const withAuth = await getJson(`${url}/api/tasks`, {
      headers: { authorization: 'Bearer secret-token' },
    })
    expect(withAuth.status).toBe(200)

    const wrongAuth = await getJson(`${url}/api/tasks`, {
      headers: { authorization: 'Bearer wrong' },
    })
    expect(wrongAuth.status).toBe(401)
  })

  it('exempts /api/health from auth (liveness probes need no token)', async () => {
    await mc.stop()
    mc = await createMissionControl({
      db, port: 0,
      subscribe: (h) => { busHandlers.add(h); return () => busHandlers.delete(h) },
      submit: async (input) => tasks.create(input),
      authToken: 'secret-token',
    })
    url = `http://127.0.0.1:${mc.port()}`

    const r = await getJson(`${url}/api/health`)
    expect(r.status).toBe(200)
  })

  // ─── CORS ─────────────────────────────────────────────────────────

  it('emits CORS headers when corsOrigins is configured', async () => {
    await mc.stop()
    mc = await createMissionControl({
      db, port: 0,
      subscribe: (h) => { busHandlers.add(h); return () => busHandlers.delete(h) },
      submit: async (input) => tasks.create(input),
      corsOrigins: ['*'],
    })
    url = `http://127.0.0.1:${mc.port()}`

    const res = await fetch(`${url}/api/health`, {
      headers: { origin: 'http://example.com' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('handles OPTIONS preflight', async () => {
    await mc.stop()
    mc = await createMissionControl({
      db, port: 0,
      subscribe: (h) => { busHandlers.add(h); return () => busHandlers.delete(h) },
      submit: async (input) => tasks.create(input),
      corsOrigins: ['*'],
    })
    url = `http://127.0.0.1:${mc.port()}`

    const res = await fetch(`${url}/api/tasks`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
  })
})

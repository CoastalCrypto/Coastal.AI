import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { noteRoutes } from '../notes.js'
import { UnifiedMemory } from '../../../memory/index.js'

let app: FastifyInstance
let tempDir: string
let memory: UnifiedMemory

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'notes-route-'))
  memory = new UnifiedMemory({ dataDir: tempDir })
  app = Fastify({ logger: false })
  await app.register(noteRoutes, { memory })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  await memory.close()
  rmSync(tempDir, { recursive: true, force: true })
})

async function createNote(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/admin/notes', payload })
}

describe('POST /api/admin/notes', () => {
  it('creates a note and returns it with materialized mentions', async () => {
    const res = await createNote({ title: 'First', body: 'hello world', kind: 'user' })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.note.title).toBe('First')
    expect(body.note.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.mentioned).toEqual([])
  })

  it('rejects invalid kind via Zod', async () => {
    const res = await createNote({ title: 'X', body: '', kind: 'bogus' })
    expect(res.statusCode).toBe(400)
  })

  it('rejects extra fields (.strict() schema)', async () => {
    const res = await createNote({ title: 'X', body: '', kind: 'user', extra: 'no' })
    expect(res.statusCode).toBe(400)
  })

  it('materializes wikilink mentions to existing notes by title', async () => {
    const target = JSON.parse((await createNote({ title: 'Roadmap', body: '', kind: 'user' })).body).note
    const res = await createNote({ title: 'Plan', body: 'see [[Roadmap]] for context', kind: 'user' })
    const body = JSON.parse(res.body)
    expect(body.mentioned).toEqual([target.id])
  })

  it('materializes plain-text entity mentions when title appears in body', async () => {
    const target = JSON.parse((await createNote({ title: 'Architect', body: '', kind: 'user' })).body).note
    const res = await createNote({ title: 'Notes', body: 'the Architect ran fine today', kind: 'learning' })
    expect(JSON.parse(res.body).mentioned).toContain(target.id)
  })
})

describe('GET /api/admin/notes', () => {
  it('lists notes with kind filter and total count', async () => {
    await createNote({ title: 'a', body: '', kind: 'user' })
    await createNote({ title: 'b', body: '', kind: 'design' })
    const res = await app.inject({ method: 'GET', url: '/api/admin/notes?kind=user' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.notes).toHaveLength(1)
    expect(body.notes[0].title).toBe('a')
    expect(body.count).toBe(2)
  })

  it('rejects unknown query keys', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/notes?nope=1' })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/admin/notes/:id', () => {
  it('returns note with outgoing and backlinks', async () => {
    const a = JSON.parse((await createNote({ title: 'A', body: '', kind: 'user' })).body).note
    const b = JSON.parse((await createNote({ title: 'B', body: 'about [[A]]', kind: 'user' })).body).note
    const res = await app.inject({ method: 'GET', url: `/api/admin/notes/${a.id}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.note.id).toBe(a.id)
    expect(body.backlinks.map((l: { fromId: string }) => l.fromId)).toContain(b.id)
  })

  it('returns 404 for missing notes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/notes/does-not-exist' })
    expect(res.statusCode).toBe(404)
  })
})

describe('PUT /api/admin/notes/:id', () => {
  it('updates a note and re-materializes mentions', async () => {
    const a = JSON.parse((await createNote({ title: 'Roadmap', body: '', kind: 'user' })).body).note
    const b = JSON.parse((await createNote({ title: 'Plan', body: 'no link yet', kind: 'user' })).body).note
    const res = await app.inject({
      method: 'PUT', url: `/api/admin/notes/${b.id}`,
      payload: { body: 'now mentions [[Roadmap]]' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.note.body).toContain('Roadmap')
    expect(body.mentioned).toEqual([a.id])
  })

  it("re-materialization removes stale mentions WITHOUT recording user feedback", async () => {
    const a = JSON.parse((await createNote({ title: 'Roadmap', body: '', kind: 'user' })).body).note
    const b = JSON.parse((await createNote({ title: 'Plan', body: 'see [[Roadmap]]', kind: 'user' })).body).note
    // Now strip the link from the body. Materialize should remove the
    // edge but NOT bump the rejection counter (this is reconciliation,
    // not user disuse).
    await app.inject({
      method: 'PUT', url: `/api/admin/notes/${b.id}`,
      payload: { body: 'no more link' },
    })
    expect(memory.notes.outgoing(b.id)).toHaveLength(0)
    expect(memory.notes.getMentionStats(a.id).rejected).toBe(0)
  })

  it('returns 404 when updating a missing note', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/admin/notes/does-not-exist',
      payload: { title: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/admin/notes/:id', () => {
  it('deletes and cascades link rows', async () => {
    const a = JSON.parse((await createNote({ title: 'A', body: '', kind: 'user' })).body).note
    const b = JSON.parse((await createNote({ title: 'B', body: 'see [[A]]', kind: 'user' })).body).note
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/notes/${a.id}` })
    expect(res.statusCode).toBe(200)
    expect(memory.notes.get(a.id)).toBeNull()
    expect(memory.notes.outgoing(b.id)).toHaveLength(0)
  })
})

describe('Manual link routes', () => {
  it('POST /links creates a typed link between two notes', async () => {
    const a = JSON.parse((await createNote({ title: 'A', body: '', kind: 'user' })).body).note
    const b = JSON.parse((await createNote({ title: 'B', body: '', kind: 'user' })).body).note
    const res = await app.inject({
      method: 'POST', url: `/api/admin/notes/${a.id}/links`,
      payload: { toId: b.id, kind: 'derives_from' },
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).link.kind).toBe('derives_from')
  })

  it('POST /links rejects self-links', async () => {
    const a = JSON.parse((await createNote({ title: 'A', body: '', kind: 'user' })).body).note
    const res = await app.inject({
      method: 'POST', url: `/api/admin/notes/${a.id}/links`,
      payload: { toId: a.id, kind: 'mentions' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /links 404s when target note does not exist', async () => {
    const a = JSON.parse((await createNote({ title: 'A', body: '', kind: 'user' })).body).note
    const res = await app.inject({
      method: 'POST', url: `/api/admin/notes/${a.id}/links`,
      payload: { toId: 'nope', kind: 'mentions' },
    })
    expect(res.statusCode).toBe(404)
  })

  it("DELETE /links/:toId records mention rejection (the user's signal)", async () => {
    const a = JSON.parse((await createNote({ title: 'Roadmap', body: '', kind: 'user' })).body).note
    const b = JSON.parse((await createNote({ title: 'Plan', body: 'see [[Roadmap]]', kind: 'user' })).body).note
    const res = await app.inject({
      method: 'DELETE', url: `/api/admin/notes/${b.id}/links/${a.id}`,
    })
    expect(res.statusCode).toBe(200)
    expect(memory.notes.getMentionStats(a.id).rejected).toBe(1)
  })
})

describe('GET /api/admin/notes/:id/graph', () => {
  it('returns the local subgraph at the requested depth', async () => {
    const a = JSON.parse((await createNote({ title: 'A', body: '', kind: 'user' })).body).note
    const b = JSON.parse((await createNote({ title: 'B', body: 'see [[A]]', kind: 'user' })).body).note
    const c = JSON.parse((await createNote({ title: 'C', body: 'see [[B]]', kind: 'user' })).body).note
    const res = await app.inject({ method: 'GET', url: `/api/admin/notes/${a.id}/graph?depth=2` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.nodes.map((n: { id: string }) => n.id).sort()).toEqual([a.id, b.id, c.id].sort())
  })
})

describe('Learned policy routes', () => {
  it('GET /policy/feedback lists rejected targets', async () => {
    const a = JSON.parse((await createNote({ title: 'Roadmap', body: '', kind: 'user' })).body).note
    const b = JSON.parse((await createNote({ title: 'Plan', body: 'see [[Roadmap]]', kind: 'user' })).body).note
    await app.inject({ method: 'DELETE', url: `/api/admin/notes/${b.id}/links/${a.id}` })
    const res = await app.inject({ method: 'GET', url: '/api/admin/notes/policy/feedback' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.feedback).toHaveLength(1)
    expect(body.feedback[0].target).toBe(a.id)
    expect(body.feedback[0].rejectedCount).toBe(1)
  })

  it('DELETE /policy/feedback/:target wipes the learned signal', async () => {
    const a = JSON.parse((await createNote({ title: 'Roadmap', body: '', kind: 'user' })).body).note
    const b = JSON.parse((await createNote({ title: 'Plan', body: 'see [[Roadmap]]', kind: 'user' })).body).note
    await app.inject({ method: 'DELETE', url: `/api/admin/notes/${b.id}/links/${a.id}` })
    await app.inject({ method: 'DELETE', url: `/api/admin/notes/policy/feedback/${a.id}` })
    expect(memory.notes.getMentionStats(a.id).rejected).toBe(0)
  })
})

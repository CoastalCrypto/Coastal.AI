import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'

let tempDir: string
let store: NoteStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'notes-test-'))
  store = new NoteStore({ dataDir: tempDir })
})

afterEach(() => {
  store.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('NoteStore CRUD', () => {
  it('creates and retrieves a note with a generated id', () => {
    const note = store.create({ title: 'First', body: 'hello world', kind: 'user' })
    expect(note.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(note.createdAt).toBeGreaterThan(0)
    expect(note.updatedAt).toBe(note.createdAt)
    const found = store.get(note.id)
    expect(found).toEqual(note)
  })

  it('honors a caller-supplied id (used for deterministic source-derived notes)', () => {
    const note = store.create({ id: 'fixed-id', title: 'T', body: 'B', kind: 'code' })
    expect(note.id).toBe('fixed-id')
    expect(store.get('fixed-id')).toEqual(note)
  })

  it('rejects notes with an unknown kind via SQLite CHECK constraint', () => {
    expect(() =>
      store.create({ title: 'x', body: 'y', kind: 'bogus' as never }),
    ).toThrow()
  })

  it('updates a note immutably and bumps updated_at', async () => {
    const note = store.create({ title: 'Old', body: 'B', kind: 'user' })
    await new Promise(r => setTimeout(r, 5))
    const updated = store.update(note.id, { title: 'New' })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('New')
    expect(updated!.body).toBe('B')
    expect(updated!.updatedAt).toBeGreaterThan(note.updatedAt)
    expect(updated!.createdAt).toBe(note.createdAt)
  })

  it('returns null when updating a missing note', () => {
    expect(store.update('does-not-exist', { title: 'X' })).toBeNull()
  })

  it('lists with kind filter, newest first', () => {
    store.create({ title: 'a', body: 'x', kind: 'user' })
    store.create({ title: 'b', body: 'x', kind: 'design' })
    const userNotes = store.list({ kind: 'user' })
    expect(userNotes).toHaveLength(1)
    expect(userNotes[0].title).toBe('a')
  })

  it('full-text search hits title or body', () => {
    store.create({ title: 'Fastify routes', body: 'admin auth pattern', kind: 'learning' })
    store.create({ title: 'Unrelated', body: 'tradingview', kind: 'trade' })
    const hits = store.search('fastify')
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toContain('Fastify')
  })

  it('delete cascades to outgoing and incoming links', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    store.link(a.id, b.id)
    store.link(b.id, a.id)
    expect(store.outgoing(a.id)).toHaveLength(1)
    store.delete(a.id)
    expect(store.get(a.id)).toBeNull()
    expect(store.outgoing(b.id)).toHaveLength(0)
    expect(store.backlinks(b.id)).toHaveLength(0)
  })
})

describe('NoteStore links', () => {
  it('creates a default mentions link', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    const link = store.link(a.id, b.id)
    expect(link).not.toBeNull()
    expect(link!.kind).toBe('mentions')
  })

  it('refuses self-links', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    expect(store.link(a.id, a.id)).toBeNull()
  })

  it('is idempotent for the same (from, to, kind) triple', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    store.link(a.id, b.id, 'derives_from')
    store.link(a.id, b.id, 'derives_from')
    expect(store.outgoing(a.id)).toHaveLength(1)
  })

  it('allows different link kinds between the same pair', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    store.link(a.id, b.id, 'mentions')
    store.link(a.id, b.id, 'supersedes')
    expect(store.outgoing(a.id)).toHaveLength(2)
  })

  it('backlinks returns incoming-only edges', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    const c = store.create({ title: 'C', body: '', kind: 'user' })
    store.link(a.id, b.id)
    store.link(c.id, b.id)
    const back = store.backlinks(b.id)
    expect(back).toHaveLength(2)
    expect(back.map(l => l.fromId).sort()).toEqual([a.id, c.id].sort())
  })

  it('unlink without kind removes all edges between the pair', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    store.link(a.id, b.id, 'mentions')
    store.link(a.id, b.id, 'supersedes')
    expect(store.unlink(a.id, b.id)).toBe(2)
    expect(store.outgoing(a.id)).toHaveLength(0)
  })
})

describe('NoteStore learned mention policy', () => {
  it('records a rejection when a mentions edge is unlinked by the user', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    store.link(a.id, b.id, 'mentions')
    store.unlink(a.id, b.id)
    const stats = store.getMentionStats(b.id)
    expect(stats.rejected).toBe(1)
    expect(stats.lastRejectedAt).toBeGreaterThan(0)
  })

  it('does not record a rejection when removing a non-mentions edge', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    store.link(a.id, b.id, 'derives_from')
    store.unlink(a.id, b.id, 'derives_from')
    expect(store.getMentionStats(b.id).rejected).toBe(0)
  })

  it('skips feedback when recordFeedback:false (used by reconciliation pipeline)', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    store.link(a.id, b.id, 'mentions')
    store.unlink(a.id, b.id, 'mentions', { recordFeedback: false })
    expect(store.getMentionStats(b.id).rejected).toBe(0)
  })

  it('aggregates kept (current mentions edges) and rejected separately', () => {
    const target = store.create({ title: 'Target', body: '', kind: 'user' })
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    const c = store.create({ title: 'C', body: '', kind: 'user' })
    store.link(a.id, target.id, 'mentions')
    store.link(b.id, target.id, 'mentions')
    store.link(c.id, target.id, 'mentions')
    store.unlink(c.id, target.id) // 1 rejection, 2 still kept
    const stats = store.getMentionStats(target.id)
    expect(stats.kept).toBe(2)
    expect(stats.rejected).toBe(1)
  })

  it('clearMentionFeedback wipes the learned signal for a target', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    store.link(a.id, b.id, 'mentions')
    store.unlink(a.id, b.id)
    expect(store.getMentionStats(b.id).rejected).toBe(1)
    store.clearMentionFeedback(b.id)
    expect(store.getMentionStats(b.id).rejected).toBe(0)
  })

  it('listMentionFeedback returns rows ordered by rejection count desc', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const noisy = store.create({ title: 'Noisy', body: '', kind: 'user' })
    const quiet = store.create({ title: 'Quiet', body: '', kind: 'user' })
    for (let i = 0; i < 4; i++) {
      store.link(a.id, noisy.id, 'mentions')
      store.unlink(a.id, noisy.id)
    }
    store.link(a.id, quiet.id, 'mentions')
    store.unlink(a.id, quiet.id)
    const fb = store.listMentionFeedback()
    expect(fb).toHaveLength(2)
    expect(fb[0].target).toBe(noisy.id)
    expect(fb[0].rejectedCount).toBe(4)
    expect(fb[1].target).toBe(quiet.id)
  })
})

describe('NoteStore subgraph', () => {
  it('returns just the root when depth=0', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    store.link(a.id, b.id)
    const sub = store.subgraph(a.id, 0)
    expect(sub.nodes.map(n => n.id)).toEqual([a.id])
    expect(sub.edges).toHaveLength(0)
  })

  it('expands one hop in either direction at depth=1', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    const c = store.create({ title: 'C', body: '', kind: 'user' })
    store.link(a.id, b.id)
    store.link(c.id, a.id)
    const sub = store.subgraph(a.id, 1)
    expect(sub.nodes.map(n => n.id).sort()).toEqual([a.id, b.id, c.id].sort())
    expect(sub.edges).toHaveLength(2)
  })

  it('walks deeper at depth=2 without revisiting nodes', () => {
    const a = store.create({ title: 'A', body: '', kind: 'user' })
    const b = store.create({ title: 'B', body: '', kind: 'user' })
    const c = store.create({ title: 'C', body: '', kind: 'user' })
    store.link(a.id, b.id)
    store.link(b.id, c.id)
    const sub = store.subgraph(a.id, 2)
    expect(sub.nodes.map(n => n.id).sort()).toEqual([a.id, b.id, c.id].sort())
    // a→b appears once (visited from a) and b→c appears once (visited from b).
    expect(sub.edges).toHaveLength(2)
  })
})

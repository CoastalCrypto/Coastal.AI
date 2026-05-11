import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import { syncCodeGraph, type CodeGraphScanInput } from '../code-graph-sync.js'
import { codeGraphNoteId } from '../code-graph-id.js'

let tempDir: string
let store: NoteStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'cg-sync-'))
  store = new NoteStore({ dataDir: tempDir })
})

afterEach(() => {
  store.close()
  rmSync(tempDir, { recursive: true, force: true })
})

function file(rel: string, summary = 'summary'): CodeGraphScanInput['notes'][number] {
  return { id: codeGraphNoteId(rel), relPath: rel, summary }
}

describe('syncCodeGraph initial sync', () => {
  it('inserts notes and returns added counts', () => {
    const scan: CodeGraphScanInput = {
      notes: [file('a.ts', 'A summary'), file('b.ts', 'B summary')],
      edges: [{ fromId: codeGraphNoteId('a.ts'), toId: codeGraphNoteId('b.ts') }],
    }
    const r = syncCodeGraph(store, scan)
    expect(r.added).toBe(2)
    expect(r.updated).toBe(0)
    expect(r.removed).toBe(0)
    expect(r.edgesAdded).toBe(1)
    expect(r.edgesRemoved).toBe(0)
    expect(store.list({ kind: 'code' })).toHaveLength(2)
  })
})

describe('syncCodeGraph reconciliation', () => {
  it('counts as updated, not added, on a re-sync of the same files', () => {
    const scan: CodeGraphScanInput = {
      notes: [file('a.ts'), file('b.ts')],
      edges: [{ fromId: codeGraphNoteId('a.ts'), toId: codeGraphNoteId('b.ts') }],
    }
    syncCodeGraph(store, scan)
    const r = syncCodeGraph(store, scan)
    expect(r.added).toBe(0)
    expect(r.updated).toBe(2)
    expect(r.edgesAdded).toBe(0)
  })

  it('removes notes that disappeared from the new scan', () => {
    syncCodeGraph(store, { notes: [file('a.ts'), file('b.ts')], edges: [] })
    const r = syncCodeGraph(store, { notes: [file('a.ts')], edges: [] })
    expect(r.removed).toBe(1)
    expect(store.list({ kind: 'code' }).map(n => n.title)).toEqual(['a.ts'])
  })

  it('removes edges that no longer appear in the new scan', () => {
    syncCodeGraph(store, {
      notes: [file('a.ts'), file('b.ts'), file('c.ts')],
      edges: [
        { fromId: codeGraphNoteId('a.ts'), toId: codeGraphNoteId('b.ts') },
        { fromId: codeGraphNoteId('a.ts'), toId: codeGraphNoteId('c.ts') },
      ],
    })
    const r = syncCodeGraph(store, {
      notes: [file('a.ts'), file('b.ts'), file('c.ts')],
      edges: [{ fromId: codeGraphNoteId('a.ts'), toId: codeGraphNoteId('b.ts') }],
    })
    expect(r.edgesRemoved).toBe(1)
    expect(store.outgoing(codeGraphNoteId('a.ts')).filter(l => l.kind === 'mentions')).toHaveLength(1)
  })

  it("does NOT bump rejection feedback when removing stale code edges", () => {
    syncCodeGraph(store, {
      notes: [file('a.ts'), file('b.ts')],
      edges: [{ fromId: codeGraphNoteId('a.ts'), toId: codeGraphNoteId('b.ts') }],
    })
    syncCodeGraph(store, { notes: [file('a.ts'), file('b.ts')], edges: [] })
    expect(store.getMentionStats(codeGraphNoteId('b.ts')).rejected).toBe(0)
  })

  it('leaves user-authored notes and their links untouched', () => {
    const userA = store.create({ title: 'User A', body: '', kind: 'user' })
    const userB = store.create({ title: 'User B', body: 'mentions [[User A]]', kind: 'user' })
    store.link(userB.id, userA.id, 'mentions')
    syncCodeGraph(store, { notes: [file('a.ts')], edges: [] })
    expect(store.get(userA.id)).not.toBeNull()
    expect(store.outgoing(userB.id).filter(l => l.kind === 'mentions')).toHaveLength(1)
  })

  it('skips desired edges whose target is not in the same scan (cross-package)', () => {
    const r = syncCodeGraph(store, {
      notes: [file('a.ts')],
      edges: [{ fromId: codeGraphNoteId('a.ts'), toId: codeGraphNoteId('b.ts') }],
    })
    expect(r.edgesAdded).toBe(0)
  })
})

describe('syncCodeGraph file content updates', () => {
  it("updates a note's body when the summary changes between scans", () => {
    syncCodeGraph(store, { notes: [file('a.ts', 'first')], edges: [] })
    syncCodeGraph(store, { notes: [file('a.ts', 'second')], edges: [] })
    const note = store.get(codeGraphNoteId('a.ts'))
    expect(note?.body).toBe('second')
  })
})

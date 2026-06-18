import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore, type ReplicatedNote } from '../notes.js'

function freshStore() {
  return new NoteStore({ dataDir: mkdtempSync(join(tmpdir(), 'notes-repl-')) })
}
const base: ReplicatedNote = {
  id: 'n1', title: 't', body: 'v1', kind: 'learning',
  sourceType: null, sourceId: null, rev: 5, origin: 'node-2',
}

describe('NoteStore.applyReplicated', () => {
  it('inserts an unseen replicated note', () => {
    const s = freshStore()
    expect(s.applyReplicated(base)).toBe('applied')
    expect(s.get('n1')?.body).toBe('v1')
    expect(s.get('n1')?.rev).toBe(5)
  })

  it('applies when incoming rev is higher', () => {
    const s = freshStore()
    s.applyReplicated(base)
    expect(s.applyReplicated({ ...base, body: 'v2', rev: 6 })).toBe('applied')
    expect(s.get('n1')?.body).toBe('v2')
  })

  it('skips when incoming rev is lower or equal (same origin)', () => {
    const s = freshStore()
    s.applyReplicated({ ...base, rev: 6 })
    expect(s.applyReplicated({ ...base, body: 'stale', rev: 4 })).toBe('skipped')
    expect(s.get('n1')?.body).toBe('v1')
  })

  it('tie-breaks equal rev by higher origin id', () => {
    const s = freshStore()
    s.applyReplicated({ ...base, rev: 5, origin: 'node-2', body: 'from2' })
    expect(s.applyReplicated({ ...base, rev: 5, origin: 'node-9', body: 'from9' })).toBe('applied')
    expect(s.get('n1')?.body).toBe('from9')
    expect(s.applyReplicated({ ...base, rev: 5, origin: 'node-1', body: 'from1' })).toBe('skipped')
  })
})

import { describe, it, expect } from 'vitest'
import { serializeNote, parseNoteFile, type ReplicatedNote } from '../replication-frontmatter.js'

const note: ReplicatedNote = {
  id: '01J', title: 'Title', body: 'Line one\nLine two', kind: 'learning',
  sourceType: null, sourceId: null, rev: 7, origin: 'node-2',
}

describe('replication frontmatter codec', () => {
  it('round-trips a note through markdown', () => {
    const md = serializeNote(note)
    const parsed = parseNoteFile(md)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.note).toEqual(note)
  })

  it('rejects a file with missing/invalid frontmatter', () => {
    expect(parseNoteFile('no frontmatter here').ok).toBe(false)
    expect(parseNoteFile('---\nid: x\n---\nbody').ok).toBe(false) // missing required fields
  })
})

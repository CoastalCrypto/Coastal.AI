import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'

function freshStore() {
  return new NoteStore({ dataDir: mkdtempSync(join(tmpdir(), 'notes-rev-')) })
}

describe('NoteStore rev + origin', () => {
  it('starts rev at 1 on create and leaves origin null', () => {
    const s = freshStore()
    const n = s.create({ title: 'a', body: 'b', kind: 'learning' })
    expect(n.rev).toBe(1)
    expect(n.origin).toBeNull()
  })

  it('bumps rev on update', () => {
    const s = freshStore()
    const n = s.create({ title: 'a', body: 'b', kind: 'learning' })
    const u = s.update(n.id, { body: 'c' })
    expect(u?.rev).toBe(2)
  })
})

import { describe, it, expect } from 'vitest'
import { mkdtempSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import { exportNotes } from '../notes-export.js'

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'exp-data-'))
  const outDir = mkdtempSync(join(tmpdir(), 'exp-out-'))
  return { store: new NoteStore({ dataDir }), outDir }
}

describe('exportNotes', () => {
  it('writes one <id>.md per selected note', () => {
    const { store, outDir } = setup()
    const n = store.create({ title: 'a', body: 'b', kind: 'learning' })
    const r = exportNotes(store, outDir, () => true, 'node-test')
    expect(r.written).toBe(1)
    expect(existsSync(join(outDir, `${n.id}.md`))).toBe(true)
  })

  it('removes files for notes no longer selected', () => {
    const { store, outDir } = setup()
    const keep = store.create({ title: 'k', body: 'b', kind: 'learning' })
    const drop = store.create({ title: 'd', body: 'b', kind: 'learning' })
    exportNotes(store, outDir, () => true, 'node-test')
    const r = exportNotes(store, outDir, n => n.id === keep.id, 'node-test')
    expect(r.removed).toBe(1)
    expect(existsSync(join(outDir, `${drop.id}.md`))).toBe(false)
    expect(readdirSync(outDir).filter(f => f.endsWith('.md'))).toEqual([`${keep.id}.md`])
  })
})

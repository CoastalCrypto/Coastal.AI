import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import { serializeNote } from '../replication-frontmatter.js'
import { ingestDir } from '../notes-ingest.js'

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'ing-data-'))
  const inDir = mkdtempSync(join(tmpdir(), 'ing-in-'))
  return { store: new NoteStore({ dataDir }), inDir }
}
function writeNote(dir: string, n: Parameters<typeof serializeNote>[0]) {
  writeFileSync(join(dir, `${n.id}.md`), serializeNote(n))
}
const peer = {
  id: 'p1', title: 't', body: 'v1', kind: 'learning' as const,
  sourceType: 'replicated', sourceId: 'node-2', rev: 3, origin: 'node-2',
}

describe('ingestDir', () => {
  it('applies new peer notes and tracks deletions', () => {
    const { store, inDir } = setup()
    writeNote(inDir, peer)
    let r = ingestDir(store, inDir)
    expect(r.applied).toBe(1)
    expect(store.get('p1')?.body).toBe('v1')

    // higher rev applies
    writeNote(inDir, { ...peer, body: 'v2', rev: 4 })
    r = ingestDir(store, inDir)
    expect(r.applied).toBe(1)
    expect(store.get('p1')?.body).toBe('v2')

    // file removed -> note deleted locally
    rmSync(join(inDir, 'p1.md'))
    r = ingestDir(store, inDir)
    expect(r.deleted).toBe(1)
    expect(store.get('p1')).toBeNull()
  })

  it('skips invalid files without throwing', () => {
    const { store, inDir } = setup()
    writeFileSync(join(inDir, 'bad.md'), 'garbage, no frontmatter')
    const r = ingestDir(store, inDir)
    expect(r.applied).toBe(0)
    expect(r.invalid).toBe(1)
  })
})

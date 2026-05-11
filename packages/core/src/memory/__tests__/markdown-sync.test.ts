import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import { ingestMarkdown } from '../markdown-ingest.js'
import { syncMarkdownIngest } from '../markdown-sync.js'

let dir: string
let store: NoteStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'md-sync-'))
  store = new NoteStore({ dataDir: dir })
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const PATH = 'packages/web/DESIGN.md'

describe('syncMarkdownIngest initial', () => {
  it('inserts file note + sections + contains links', () => {
    const r = syncMarkdownIngest(store, ingestMarkdown({
      relPath: PATH,
      source: '# Web\n\n## A\nA body\n\n## B\nB body\n',
    }))
    expect(r.added).toBe(3)
    expect(r.edgesAdded).toBe(2)
    expect(store.bySource('markdown', PATH)).toHaveLength(3)
  })
})

describe('syncMarkdownIngest reconciliation', () => {
  it('replaces sections when the file is restructured (removed section drops)', () => {
    syncMarkdownIngest(store, ingestMarkdown({
      relPath: PATH,
      source: '# T\n\n## A\nA\n\n## B\nB\n\n## C\nC\n',
    }))
    const second = syncMarkdownIngest(store, ingestMarkdown({
      relPath: PATH,
      source: '# T\n\n## A\nA changed\n\n## B\nB\n', // C removed
    }))
    expect(second.removed).toBe(1) // section C
    // Sync upserts every incoming note unconditionally — file note + A + B
    // are all rewritten regardless of whether their content changed.
    expect(second.updated).toBe(3)
    expect(store.bySource('markdown', PATH).map(n => n.title).sort()).toEqual(['A', 'B', 'T'])
  })

  it('updates a section body without removing it when the heading stays', () => {
    syncMarkdownIngest(store, ingestMarkdown({
      relPath: PATH,
      source: '# T\n\n## A\nfirst body\n',
    }))
    syncMarkdownIngest(store, ingestMarkdown({
      relPath: PATH,
      source: '# T\n\n## A\nsecond body\n',
    }))
    const a = store.bySource('markdown', PATH).find(n => n.title === 'A')!
    expect(a.body.trim()).toBe('second body')
  })

  it("does not record mention rejections when a stale wikilink edge is pruned", () => {
    syncMarkdownIngest(store, ingestMarkdown({
      relPath: PATH,
      source: '# T\n\n## A\nsee [[B]]\n\n## B\nB\n',
    }))
    const bId = 'design:packages/web/DESIGN.md#b'
    expect(store.getMentionStats(bId).rejected).toBe(0)
    syncMarkdownIngest(store, ingestMarkdown({
      relPath: PATH,
      source: '# T\n\n## A\nno more link\n\n## B\nB\n',
    }))
    expect(store.getMentionStats(bId).rejected).toBe(0)
  })

  it('leaves cross-source links into our sections alone (does not unlink user notes)', () => {
    syncMarkdownIngest(store, ingestMarkdown({
      relPath: PATH,
      source: '# T\n\n## A\nbody\n',
    }))
    const aId = 'design:packages/web/DESIGN.md#a'
    const userNote = store.create({ title: 'My Plan', body: 'see [[A]]', kind: 'user' })
    store.link(userNote.id, aId, 'mentions') // user mentions the design section

    // Re-ingest the SAME file. The cross-source link from user → A must survive.
    syncMarkdownIngest(store, ingestMarkdown({
      relPath: PATH,
      source: '# T\n\n## A\nbody updated\n',
    }))
    expect(store.outgoing(userNote.id).find(l => l.toId === aId)).toBeDefined()
  })

  it('scopes reconciliation by sourceId — a different markdown file is untouched', () => {
    syncMarkdownIngest(store, ingestMarkdown({
      relPath: 'packages/web/DESIGN.md',
      source: '# Web\n\n## Color\nbody\n',
    }))
    syncMarkdownIngest(store, ingestMarkdown({
      relPath: 'packages/api/DESIGN.md',
      source: '# API\n\n## Routes\nbody\n',
    }))
    // Re-ingest just web; api notes survive.
    syncMarkdownIngest(store, ingestMarkdown({
      relPath: 'packages/web/DESIGN.md',
      source: '# Web\n\n## Color\nbody\n',
    }))
    expect(store.bySource('markdown', 'packages/api/DESIGN.md')).toHaveLength(2)
  })
})

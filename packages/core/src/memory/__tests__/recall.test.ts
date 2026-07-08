import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NoteStore, type Note } from '../notes.js'
import { buildFtsQuery, recallNotes, formatRecalledNotes, recallContextMessage } from '../recall.js'

function freshStore(): NoteStore {
  return new NoteStore({ dataDir: mkdtempSync(join(tmpdir(), 'recall-')) })
}

describe('buildFtsQuery', () => {
  it('tokenizes, drops short + stopwords, ORs the terms', () => {
    expect(buildFtsQuery('the Vulkan inference PATH for bc250')).toBe('vulkan OR inference OR path OR bc250')
  })
  it('strips FTS5 operators/quotes so the query is safe', () => {
    expect(buildFtsQuery('"foo" OR (bar*) AND baz:qux')).not.toMatch(/["*():]/)
  })
  it('returns empty for stopword/short-only input', () => {
    expect(buildFtsQuery('the a an of to')).toBe('')
  })
  it('caps at 8 terms', () => {
    expect(buildFtsQuery('alpha bravo charlie delta echo foxtrot golf hotel india juliet').split(' OR ')).toHaveLength(8)
  })
})

describe('recallNotes (real FTS5 NoteStore)', () => {
  it('returns BM25-ranked matches and never throws on operator-laden input', () => {
    const s = freshStore()
    s.create({ title: 'Vulkan on BC-250', body: 'llama.cpp vulkan gfx1013 inference path', kind: 'learning' })
    s.create({ title: 'Syncthing replication', body: 'hub and spoke notes replication', kind: 'learning' })
    const hits = recallNotes(s, '"vulkan" OR (bc250*)', { limit: 5 })
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].title).toContain('Vulkan')
  })
  it('empty/stopword query → []', () => {
    const s = freshStore()
    s.create({ title: 'x', body: 'y', kind: 'learning' })
    expect(recallNotes(s, 'the a of')).toEqual([])
  })
  it('respects maxChars budget (drops overflow beyond the first)', () => {
    const s = freshStore()
    s.create({ title: 'alpha one', body: 'alpha '.repeat(15), kind: 'learning' })
    s.create({ title: 'alpha two', body: 'alpha '.repeat(15), kind: 'learning' })
    expect(recallNotes(s, 'alpha', { limit: 5, maxChars: 100 })).toHaveLength(1)
  })
  it('store.search throwing → [] (fail-safe)', () => {
    const fake = { search: () => { throw new Error('fts boom') } } as unknown as NoteStore
    expect(recallNotes(fake, 'anything relevant here')).toEqual([])
  })
})

describe('formatRecalledNotes', () => {
  it('renders a deterministic block; snippet capped; newlines collapsed', () => {
    const notes: Note[] = [{
      id: '1', title: 'T1', body: 'line1\nline2 ' + 'z'.repeat(400), kind: 'learning',
      sourceType: null, sourceId: null, createdAt: 0, updatedAt: 0, rev: 1, origin: null,
    }]
    const out = formatRecalledNotes(notes, 300)
    expect(out).toContain('## Relevant memory')
    expect(out).toContain('[learning] T1:')
    expect(out).not.toContain('\nline2')
    expect(out).toContain('…')
  })
  it('empty notes → empty string', () => {
    expect(formatRecalledNotes([])).toBe('')
  })
})

describe('recallContextMessage', () => {
  it('returns a user message when notes match', () => {
    const s = freshStore()
    s.create({ title: 'Vulkan BC-250', body: 'gfx1013 inference', kind: 'learning' })
    const msg = recallContextMessage(s, 'vulkan inference')
    expect(msg?.role).toBe('user')
    expect(msg?.content).toContain('## Relevant memory')
  })
  it('returns null when nothing matches', () => {
    const s = freshStore()
    s.create({ title: 'unrelated', body: 'zzz', kind: 'learning' })
    expect(recallContextMessage(s, 'vulkan inference')).toBeNull()
  })
})

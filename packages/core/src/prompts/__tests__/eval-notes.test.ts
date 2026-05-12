import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../../memory/notes.js'
import {
  writeEvalResultAsNote, writeEvalResultsAsNotes,
  recentEvalNotes, latestEvalVerdicts,
  evalSourceId, evalNoteId,
} from '../eval-notes.js'
import type { EvalResult } from '../eval-runner.js'

let tempDir: string
let store: NoteStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'eval-notes-'))
  store = new NoteStore({ dataDir: tempDir })
})

afterEach(() => {
  store.close()
  rmSync(tempDir, { recursive: true, force: true })
})

function makeResult(opts: {
  promptId?: string
  version?: number
  fixtureId?: string
  ok?: boolean
  ranAt: number
  label?: string
}): EvalResult {
  return {
    promptId: opts.promptId ?? 'planner',
    promptVersion: opts.version ?? 1,
    fixtureId: opts.fixtureId ?? 'happy-path',
    fixtureLabel: opts.label ?? opts.fixtureId ?? 'happy-path',
    ok: opts.ok ?? true,
    assertions: [],
    responsePreview: 'preview body',
    responseLength: 12,
    ranAt: opts.ranAt,
    durationMs: 7,
    model: 'mock',
  }
}

describe('writeEvalResultAsNote', () => {
  it('persists a kind=eval note with the canonical id and source scoping', () => {
    const r = makeResult({ ranAt: 1_700_000_000_000 })
    const ref = writeEvalResultAsNote(store, r)
    expect(ref.noteId).toBe(evalNoteId(r))
    const note = store.get(ref.noteId)!
    expect(note.kind).toBe('eval')
    expect(note.sourceType).toBe('eval')
    expect(note.sourceId).toBe(evalSourceId('planner', 1, 'happy-path'))
    expect(note.title.startsWith('✓')).toBe(true)
  })

  it('marks failed runs with a ✗ in the title', () => {
    const r = makeResult({ ranAt: 1, ok: false })
    const ref = writeEvalResultAsNote(store, r)
    const note = store.get(ref.noteId)!
    expect(note.title.startsWith('✗')).toBe(true)
  })

  it('embeds the rendered markdown report in the body', () => {
    const r = makeResult({ ranAt: 1, label: 'my-fixture' })
    const ref = writeEvalResultAsNote(store, r)
    const note = store.get(ref.noteId)!
    expect(note.body).toContain('# planner@1 · my-fixture')
    expect(note.body).toContain('PASS')
  })

  it('upserts (re-write of same id replaces body)', () => {
    const r1 = makeResult({ ranAt: 1 })
    writeEvalResultAsNote(store, r1)
    const r2 = { ...r1, responsePreview: 'second body' }
    const ref = writeEvalResultAsNote(store, r2)
    expect(store.get(ref.noteId)!.body).toContain('second body')
  })
})

describe('writeEvalResultsAsNotes', () => {
  it('writes every result and returns refs in order', () => {
    const results = [1, 2, 3].map(i => makeResult({ ranAt: i }))
    const refs = writeEvalResultsAsNotes(store, results)
    expect(refs).toHaveLength(3)
    expect(store.list({ kind: 'eval' })).toHaveLength(3)
  })
})

describe('recentEvalNotes', () => {
  it('returns notes for one (prompt, fixture) sorted newest-first', () => {
    writeEvalResultsAsNotes(store, [
      makeResult({ ranAt: 100 }),
      makeResult({ ranAt: 300 }),
      makeResult({ ranAt: 200 }),
    ])
    const recent = recentEvalNotes(store, 'planner', 1, 'happy-path')
    expect(recent.map(n => Number(n.id.split(':').pop()))).toEqual([300, 200, 100])
  })

  it('limits to N entries when requested', () => {
    writeEvalResultsAsNotes(store, [1, 2, 3, 4, 5].map(i => makeResult({ ranAt: i * 10 })))
    expect(recentEvalNotes(store, 'planner', 1, 'happy-path', 2)).toHaveLength(2)
  })

  it('only returns notes for the asked-for fixture', () => {
    writeEvalResultsAsNotes(store, [
      makeResult({ ranAt: 1, fixtureId: 'a' }),
      makeResult({ ranAt: 2, fixtureId: 'b' }),
      makeResult({ ranAt: 3, fixtureId: 'a' }),
    ])
    const a = recentEvalNotes(store, 'planner', 1, 'a')
    expect(a).toHaveLength(2)
    expect(a.every(n => n.id.includes(':a:'))).toBe(true)
  })

  it('returns [] when no eval has run for that fixture', () => {
    expect(recentEvalNotes(store, 'planner', 1, 'never-ran')).toEqual([])
  })
})

describe('latestEvalVerdicts', () => {
  it('returns one entry per fixture, with the newest verdict', () => {
    writeEvalResultsAsNotes(store, [
      makeResult({ ranAt: 1, fixtureId: 'a', ok: false }),
      makeResult({ ranAt: 5, fixtureId: 'a', ok: true }),  // newer wins
      makeResult({ ranAt: 3, fixtureId: 'b', ok: false }),
    ])
    const verdicts = latestEvalVerdicts(store, 'planner', 1)
    expect(verdicts).toHaveLength(2)
    expect(verdicts.find(v => v.fixtureId === 'a')!.ok).toBe(true)
    expect(verdicts.find(v => v.fixtureId === 'b')!.ok).toBe(false)
  })

  it('only considers the asked-for prompt + version', () => {
    writeEvalResultsAsNotes(store, [
      makeResult({ ranAt: 1, fixtureId: 'a', version: 1 }),
      makeResult({ ranAt: 2, fixtureId: 'a', version: 2 }),
    ])
    expect(latestEvalVerdicts(store, 'planner', 1)).toHaveLength(1)
    expect(latestEvalVerdicts(store, 'planner', 2)).toHaveLength(1)
  })

  it('returns [] when no eval has been run', () => {
    expect(latestEvalVerdicts(store, 'planner', 1)).toEqual([])
  })
})

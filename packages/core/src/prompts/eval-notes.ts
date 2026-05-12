// packages/core/src/prompts/eval-notes.ts
//
// Persists EvalResult objects as `kind='eval'` notes in the unified
// memory substrate. Each eval run becomes its own note (history is just
// `bySource(...)`, newest first), so the canvas shows a violet trail of
// past evaluations and the gate can read recent results in O(history).
//
// Note id format: `eval:<promptId>:<promptVersion>:<fixtureId>:<ranAt>`
//   - Stable + unique: ranAt is a wall-clock millisecond timestamp.
//   - Sortable lexicographically (within the same prompt+fixture) because
//     ranAt is a fixed-width number; sufficient for "newest first" queries.
//
// Source scoping (used by recentEvalNotes):
//   - sourceType = 'eval'
//   - sourceId   = `prompt:<promptId>:<promptVersion>:<fixtureId>`
//   so all history for one (prompt, fixture) shares a sourceId.

import type { NoteStore, Note } from '../memory/notes.js'
import { renderEvalResultMarkdown, type EvalResult } from './eval-runner.js'

export interface PersistedEvalRef {
  noteId: string
  ok: boolean
  ranAt: number
  fixtureId: string
}

export function evalSourceId(promptId: string, version: number, fixtureId: string): string {
  return `prompt:${promptId}:${version}:${fixtureId}`
}

export function evalNoteId(result: EvalResult): string {
  return `eval:${result.promptId}:${result.promptVersion}:${result.fixtureId}:${result.ranAt}`
}

/**
 * Persist a single eval result as a kind='eval' note. Idempotent for the
 * same (promptId, version, fixtureId, ranAt) — subsequent writes with the
 * same id upsert the body (rare; usually each run produces a fresh ranAt).
 */
export function writeEvalResultAsNote(
  store: NoteStore,
  result: EvalResult,
): PersistedEvalRef {
  const id = evalNoteId(result)
  const sourceId = evalSourceId(result.promptId, result.promptVersion, result.fixtureId)
  const title = `${result.ok ? '✓' : '✗'} ${result.promptId}@${result.promptVersion} · ${result.fixtureLabel}`
  const body = renderEvalResultMarkdown(result)
  store.upsert({
    id, title, body, kind: 'eval',
    sourceType: 'eval',
    sourceId,
  })
  return { noteId: id, ok: result.ok, ranAt: result.ranAt, fixtureId: result.fixtureId }
}

export function writeEvalResultsAsNotes(
  store: NoteStore,
  results: readonly EvalResult[],
): PersistedEvalRef[] {
  return results.map(r => writeEvalResultAsNote(store, r))
}

/**
 * All eval notes for one (prompt, fixture), newest first. Uses the
 * deterministic note-id format to sort by `ranAt` without a separate index.
 */
export function recentEvalNotes(
  store: NoteStore,
  promptId: string,
  version: number,
  fixtureId: string,
  limit = 10,
): Note[] {
  const sourceId = evalSourceId(promptId, version, fixtureId)
  const all = store.bySource('eval', sourceId)
  // bySource returns updated_at DESC which is "newest first" for
  // unmodified rows; explicit sort by encoded ranAt makes the order
  // deterministic even when two notes have identical updated_at.
  return all
    .sort((a, b) => decodeRanAt(b.id) - decodeRanAt(a.id))
    .slice(0, limit)
}

/**
 * Aggregate latest verdict per fixture for a prompt: returns one entry
 * per fixture whose most recent eval is recorded, with that verdict.
 * The gate uses this to decide pass/fail without re-running anything.
 */
export interface LatestEvalVerdict {
  fixtureId: string
  ok: boolean
  ranAt: number
  noteId: string
}

export function latestEvalVerdicts(
  store: NoteStore,
  promptId: string,
  version: number,
): LatestEvalVerdict[] {
  // Pull every eval note for this prompt+version across all fixtures and
  // keep the newest per fixture. Doable in SQL with window functions but
  // the JS path is fine for the scale we'll see.
  const all = store.list({ kind: 'eval', limit: 100_000 })
  const prefix = `eval:${promptId}:${version}:`
  const newest = new Map<string, LatestEvalVerdict>()
  for (const n of all) {
    if (!n.id.startsWith(prefix)) continue
    const fixtureId = n.id.slice(prefix.length).split(':')[0]
    const ranAt = decodeRanAt(n.id)
    const ok = n.title.startsWith('✓')
    const existing = newest.get(fixtureId)
    if (!existing || existing.ranAt < ranAt) {
      newest.set(fixtureId, { fixtureId, ok, ranAt, noteId: n.id })
    }
  }
  return [...newest.values()].sort((a, b) => a.fixtureId.localeCompare(b.fixtureId))
}

function decodeRanAt(noteId: string): number {
  const tail = noteId.split(':').pop() ?? ''
  const n = Number(tail)
  return Number.isFinite(n) ? n : 0
}

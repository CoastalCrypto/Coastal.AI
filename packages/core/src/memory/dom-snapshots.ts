// packages/core/src/memory/dom-snapshots.ts
//
// Persists browser-snapshot results as `kind='dom'` notes and exposes a
// query for the most recent good snapshot per URL (the "baseline" the
// gate compares against). Generic over the snapshotter — anything that
// produces a DomSnapshot can feed in here.
//
// Note id format: `dom:<url-slug>:<takenAt>` so history sorts naturally.
// Source scoping: sourceType='dom-snapshot', sourceId=`url:<url>` so all
// history for one URL shares a sourceId and bySource() returns the trail.

import type { NoteStore, Note } from './notes.js'

export interface DomSnapshot {
  /** The URL that was fetched. Becomes part of the note id + sourceId. */
  url: string
  /** HTTP status code returned. 0 if the fetch itself errored. */
  status: number
  /** Length of the response body in chars. Used for shrink detection. */
  bodyLength: number
  /** First N chars of the body — kept for note body / debugging. */
  bodyPreview: string
  /** Console-error lines if a JS-executing snapshotter captured them. */
  consoleErrors: string[]
  /** Wall-clock millisecond timestamp. */
  takenAt: number
  /** Wall-clock duration of the fetch in ms. */
  durationMs: number
  /** ok = HTTP status is 2xx/3xx AND no fetch-level error. */
  ok: boolean
  /** Optional fetch-level error message (DNS, timeout, etc). */
  fetchError?: string | null
}

const BODY_PREVIEW_CHARS = 1500

export function urlSlug(url: string): string {
  // Compress to a stable, slug-safe shape. No need for cryptographic
  // uniqueness — just a deterministic id component.
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 200)
}

export function domNoteId(snapshot: DomSnapshot): string {
  return `dom:${urlSlug(snapshot.url)}:${snapshot.takenAt}`
}

export function domSourceId(url: string): string {
  return `url:${url}`
}

export interface PersistedSnapshotRef {
  noteId: string
  url: string
  ok: boolean
  takenAt: number
}

export function writeDomSnapshotAsNote(
  store: NoteStore,
  snapshot: DomSnapshot,
): PersistedSnapshotRef {
  const id = domNoteId(snapshot)
  const sourceId = domSourceId(snapshot.url)
  const title = `${snapshot.ok ? '✓' : '✗'} ${snapshot.url} (HTTP ${snapshot.status})`
  const body = renderSnapshotMarkdown(snapshot)
  store.upsert({
    id, title, body, kind: 'dom',
    sourceType: 'dom-snapshot',
    sourceId,
  })
  return { noteId: id, url: snapshot.url, ok: snapshot.ok, takenAt: snapshot.takenAt }
}

export function writeDomSnapshotsAsNotes(
  store: NoteStore,
  snapshots: readonly DomSnapshot[],
): PersistedSnapshotRef[] {
  return snapshots.map(s => writeDomSnapshotAsNote(store, s))
}

/**
 * Newest-first snapshot history for a single URL. Used by the gate to
 * compare a fresh snapshot against the previous baseline.
 */
export function recentDomNotes(store: NoteStore, url: string, limit = 10): Note[] {
  const all = store.bySource('dom-snapshot', domSourceId(url))
  return all
    .sort((a, b) => decodeTakenAt(b.id) - decodeTakenAt(a.id))
    .slice(0, limit)
}

/**
 * Most recent OK snapshot for a URL, or null. The gate uses this as the
 * baseline; comparisons against a known-bad snapshot would just propagate
 * regressions silently.
 */
export function latestOkSnapshot(store: NoteStore, url: string): DomSnapshot | null {
  for (const note of recentDomNotes(store, url, 100)) {
    if (note.title.startsWith('✓')) return parseSnapshotFromBody(note.body, url)
  }
  return null
}

/**
 * Most recent snapshot of any verdict for a URL. Used to compare the
 * current run against the immediately prior one for delta reporting.
 */
export function latestSnapshot(store: NoteStore, url: string): DomSnapshot | null {
  const recent = recentDomNotes(store, url, 1)
  if (recent.length === 0) return null
  return parseSnapshotFromBody(recent[0].body, url)
}

// ---------------------------------------------------------------------------
// Marshaling helpers (note body ⇄ structured snapshot)
// ---------------------------------------------------------------------------

function renderSnapshotMarkdown(s: DomSnapshot): string {
  const lines: string[] = [
    `# ${s.url}`,
    '',
    `- **Result:** ${s.ok ? 'OK ✓' : 'FAIL ✗'}`,
    `- **Status:** ${s.status}`,
    `- **Body length:** ${s.bodyLength} chars`,
    `- **Console errors:** ${s.consoleErrors.length}`,
    `- **Taken at:** ${new Date(s.takenAt).toISOString()}`,
    `- **Duration:** ${s.durationMs}ms`,
  ]
  if (s.fetchError) lines.push(`- **Fetch error:** ${s.fetchError}`)
  // Trailing structured block we can parse back into a DomSnapshot. JSON
  // line so that latestOkSnapshot() can reconstruct without regex per field.
  lines.push('', '```snapshot-meta', JSON.stringify({
    url: s.url, status: s.status, bodyLength: s.bodyLength,
    consoleErrors: s.consoleErrors, takenAt: s.takenAt, durationMs: s.durationMs,
    ok: s.ok, fetchError: s.fetchError ?? null,
  }), '```')
  if (s.consoleErrors.length > 0) {
    lines.push('', '## Console Errors', ...s.consoleErrors.map(e => `- ${e}`))
  }
  lines.push('', '## Body Preview', '```html',
    (s.bodyPreview || '').slice(0, BODY_PREVIEW_CHARS) || '(empty)',
    '```')
  return lines.join('\n')
}

function parseSnapshotFromBody(body: string, fallbackUrl: string): DomSnapshot {
  const m = body.match(/```snapshot-meta\s*\n([\s\S]*?)\n```/)
  if (!m) {
    return {
      url: fallbackUrl, status: 0, bodyLength: 0, bodyPreview: '',
      consoleErrors: [], takenAt: 0, durationMs: 0, ok: false,
      fetchError: 'parse failed: no snapshot-meta block in note body',
    }
  }
  try {
    const meta = JSON.parse(m[1]) as Omit<DomSnapshot, 'bodyPreview'>
    // bodyPreview isn't kept in the structured meta; pull it from the markdown.
    const bp = body.match(/```html\s*\n([\s\S]*?)\n```/)
    return { ...meta, bodyPreview: bp ? bp[1] : '' }
  } catch (err) {
    return {
      url: fallbackUrl, status: 0, bodyLength: 0, bodyPreview: '',
      consoleErrors: [], takenAt: 0, durationMs: 0, ok: false,
      fetchError: `parse failed: ${(err as Error).message}`,
    }
  }
}

function decodeTakenAt(noteId: string): number {
  const tail = noteId.split(':').pop() ?? ''
  const n = Number(tail)
  return Number.isFinite(n) ? n : 0
}

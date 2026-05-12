// packages/core/src/memory/markdown-sync.ts
//
// Reconciles a single markdown ingest into NoteStore. Scoped by the
// produced notes' (sourceType, sourceId) so other ingesters and
// user-authored notes never get touched.
//
// Same hygiene as code-graph-sync: stale link removals carry
// `recordFeedback: false` because file edits aren't user disuse.

import type { NoteStore } from './notes.js'
import type { MarkdownIngestResult, MarkdownNoteSpec } from './markdown-ingest.js'

export interface MarkdownSyncResult {
  added: number
  updated: number
  removed: number
  edgesAdded: number
  edgesRemoved: number
}

export function syncMarkdownIngest(
  store: NoteStore,
  ingest: MarkdownIngestResult,
): MarkdownSyncResult {
  const result: MarkdownSyncResult = {
    added: 0, updated: 0, removed: 0, edgesAdded: 0, edgesRemoved: 0,
  }
  if (ingest.notes.length === 0) return result

  // All notes in a single ingest share sourceType + sourceId — pick from
  // the first to scope the existing-row query.
  const sourceType = ingest.notes[0].sourceType
  const sourceId = ingest.notes[0].sourceId

  const existing = store.bySource(sourceType, sourceId)
  const existingIds = new Set(existing.map(n => n.id))
  const incomingIds = new Set(ingest.notes.map(n => n.id))

  // Upsert each incoming note.
  for (const spec of ingest.notes) {
    const existed = existingIds.has(spec.id)
    upsertNote(store, spec)
    if (existed) result.updated++
    else result.added++
  }

  // Remove notes that disappeared from this ingest. CASCADE drops their
  // outgoing edges; we still need to drop their incoming edges from
  // surviving notes (handled by NoteStore.delete via FK CASCADE).
  for (const stale of existing) {
    if (!incomingIds.has(stale.id)) {
      store.delete(stale.id)
      result.removed++
    }
  }

  // Reconcile links. Scoped to (from ∈ ingest, to ∈ ingest, kind ∈ {contains, mentions}).
  // Outside-scope edges (e.g. user notes pointing into our sections) are
  // left alone; an in-file restructure shouldn't sever cross-source links.
  type LinkKey = string
  const desiredLinks = new Set<LinkKey>(
    ingest.links.map(l => linkKey(l.fromId, l.toId, l.kind)),
  )

  // Add missing.
  for (const link of ingest.links) {
    const created = store.link(link.fromId, link.toId, link.kind)
    if (created) result.edgesAdded++
  }

  // Remove stale: walk the outgoing edges of each ingested note and drop
  // any (to ∈ ingest) edge that the new ingest doesn't declare.
  for (const note of ingest.notes) {
    for (const link of store.outgoing(note.id)) {
      if (!incomingIds.has(link.toId)) continue // cross-source — leave alone
      if (link.kind !== 'contains' && link.kind !== 'mentions') continue
      if (!desiredLinks.has(linkKey(link.fromId, link.toId, link.kind))) {
        const removed = store.unlink(note.id, link.toId, link.kind, { recordFeedback: false })
        if (removed > 0) result.edgesRemoved++
      }
    }
  }

  return result
}

function upsertNote(store: NoteStore, spec: MarkdownNoteSpec): void {
  store.upsert({
    id: spec.id,
    title: spec.title,
    body: spec.body,
    kind: spec.kind,
    sourceType: spec.sourceType,
    sourceId: spec.sourceId,
  })
}

function linkKey(from: string, to: string, kind: string): string {
  return `${from}|${to}|${kind}`
}

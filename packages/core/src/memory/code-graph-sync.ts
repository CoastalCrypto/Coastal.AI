// packages/core/src/memory/code-graph-sync.ts
//
// Reconciles a generic code-graph scan into NoteStore. Generic over the
// scan source so the architect's regex scanner and any future tree-sitter
// or LSP-based scanner can both feed the same notes substrate.

import type { NoteStore, NoteLink } from './notes.js'

export interface CodeGraphScanInput {
  notes: Array<{
    id: string
    relPath: string
    summary: string
    sourceType?: string
  }>
  edges: Array<{ fromId: string; toId: string }>
}

export interface CodeGraphSyncResult {
  /** New notes inserted in this sync. */
  added: number
  /** Notes whose body was rewritten (file changed since last sync). */
  updated: number
  /** Notes removed because they no longer appear in the scan. */
  removed: number
  /** Mentions edges added in this sync. */
  edgesAdded: number
  /** Stale mentions edges removed (without recording user feedback). */
  edgesRemoved: number
}

/**
 * Apply a fresh code scan to the notes store:
 *   - Upsert one `kind='code'` note per scanned file.
 *   - Reconcile `mentions` edges from this scan: add new ones, remove
 *     stale ones with `recordFeedback: false` so import churn never
 *     poisons the learned mention policy.
 *   - Delete code notes that disappeared from the scan (file was
 *     removed). Their incoming edges cascade away via the FK.
 *
 * Pure with respect to non-`code` notes — this never touches user notes,
 * design notes, eval notes, etc.
 */
export function syncCodeGraph(store: NoteStore, scan: CodeGraphScanInput): CodeGraphSyncResult {
  const result: CodeGraphSyncResult = {
    added: 0, updated: 0, removed: 0, edgesAdded: 0, edgesRemoved: 0,
  }

  const scanIds = new Set(scan.notes.map(n => n.id))
  const existingCode = store.list({ kind: 'code', limit: 100_000 })
  const existingIds = new Set(existingCode.map(n => n.id))

  for (const incoming of scan.notes) {
    const existed = existingIds.has(incoming.id)
    store.upsert({
      id: incoming.id,
      title: incoming.relPath,
      body: incoming.summary,
      kind: 'code',
      sourceType: incoming.sourceType ?? 'code-graph',
      sourceId: incoming.relPath,
    })
    if (existed) result.updated++
    else result.added++
  }

  for (const stale of existingCode) {
    if (!scanIds.has(stale.id)) {
      store.delete(stale.id)
      result.removed++
    }
  }

  // Edge reconciliation: scoped to code notes only. We compare the desired
  // edge set (from the scan) to the existing outgoing 'mentions' edges of
  // each scanned note, ignoring incoming edges from non-code notes.
  for (const incoming of scan.notes) {
    if (!scanIds.has(incoming.id)) continue
    const desired = new Set(
      scan.edges.filter(e => e.fromId === incoming.id).map(e => e.toId),
    )
    const current: NoteLink[] = store.outgoing(incoming.id).filter(l => l.kind === 'mentions')
    const currentToCodeOnly = current.filter(l => l.toId.startsWith('code:'))
    const currentSet = new Set(currentToCodeOnly.map(l => l.toId))

    for (const targetId of desired) {
      if (!scanIds.has(targetId)) continue // target not in this scan; skip
      if (!currentSet.has(targetId)) {
        const created = store.link(incoming.id, targetId, 'mentions')
        if (created) result.edgesAdded++
      }
    }
    for (const link of currentToCodeOnly) {
      if (!desired.has(link.toId)) {
        const removed = store.unlink(incoming.id, link.toId, 'mentions', { recordFeedback: false })
        if (removed > 0) result.edgesRemoved++
      }
    }
  }

  return result
}

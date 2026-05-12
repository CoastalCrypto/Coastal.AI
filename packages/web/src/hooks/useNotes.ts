import { useState, useEffect, useCallback, useMemo } from 'react'
import { coreClient, type NoteRecord, type NoteLinkRecord, type NoteKind } from '../api/client'
import type { GraphNode, GraphEdge } from '../types/agent-graph'

/**
 * Pulls the full note set + their link rows and shapes them as canvas
 * nodes/edges so the existing MyceliumCanvas can render them alongside
 * agents/tools/models without any layout-engine changes.
 *
 * Listing all notes is fine for the size we expect (low thousands). When
 * we outgrow that, swap to subgraph queries scoped to the visible viewport.
 */
export interface UseNotesResult {
  notes: NoteRecord[]
  noteNodes: GraphNode[]
  noteEdges: GraphEdge[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  /**
   * Drop a single edge from the canvas state and persist the unlink.
   * Removing a 'mentions' edge records user feedback server-side.
   */
  unlink: (fromId: string, toId: string) => Promise<void>
}

export function useNotes(filter: { kind?: NoteKind } = {}): UseNotesResult {
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [edges, setEdges] = useState<NoteLinkRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await coreClient.listNotes({ kind: filter.kind, limit: 500 })
      setNotes(list.notes)
      // The list endpoint doesn't bundle edges — fetch each note's outgoing
      // links in parallel. Cheap as long as we cap list size; we'll move to
      // a /links bulk endpoint once the corpus grows.
      const edgeBundles = await Promise.all(
        list.notes.map(n => coreClient.getNote(n.id).then(r => r.outgoing).catch(() => [])),
      )
      setEdges(edgeBundles.flat())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes')
    } finally {
      setLoading(false)
    }
  }, [filter.kind])

  useEffect(() => { void refresh() }, [refresh])

  const unlink = useCallback(async (fromId: string, toId: string) => {
    // Optimistic local removal. The server will record feedback on its end;
    // we don't need to round-trip the rejection counter into the UI yet.
    setEdges(prev => prev.filter(e => !(e.fromId === fromId && e.toId === toId)))
    try { await coreClient.unlinkNotes(fromId, toId) }
    catch (err) {
      console.error('[useNotes] unlink failed', err)
      void refresh() // re-sync on failure
    }
  }, [refresh])

  const noteNodes = useMemo<GraphNode[]>(() =>
    notes.map(n => ({
      id: `note:${n.id}`,
      label: n.title,
      status: 'idle',
      role: n.kind,
      toolsCount: 0,
      nodeType: 'note',
      lastActivity: n.updatedAt,
    })),
  [notes])

  const noteEdges = useMemo<GraphEdge[]>(() =>
    edges.map(e => ({
      id: `note-link:${e.fromId}->${e.toId}:${e.kind}`,
      source: `note:${e.fromId}`,
      target: `note:${e.toId}`,
      label: e.kind,
      active: false,
      edgeType: 'note-note',
      weight: e.kind === 'mentions' ? 0.4 : 0.7,
    })),
  [edges])

  return { notes, noteNodes, noteEdges, loading, error, refresh, unlink }
}

import { LosslessAdapter } from './lossless.js'
import { Mem0Adapter } from './mem0.js'
import { InfinityClient, type SearchResult } from './infinity-client.js'
import { NoteStore, type Note } from './notes.js'
import { parseAll, makeLearnedPolicy } from './wikilinks.js'
import type { MemoryEntry, MemoryQuery } from './types.js'

export interface UnifiedMemoryConfig {
  dataDir: string
  mem0ApiKey?: string
  infinityUrl?: string
  cloudConsentGranted?: boolean
}

export class UnifiedMemory {
  private lossless: LosslessAdapter
  private mem0: Mem0Adapter | null
  private infinity: InfinityClient
  private infinityAvailable = false
  /** Long-term, navigable knowledge graph (notes + backlinks). Populated by
   *  the architect's learning slices (code-review-graph, eval results, etc.)
   *  and exposed verbatim to the canvas. */
  readonly notes: NoteStore

  constructor(config: UnifiedMemoryConfig) {
    this.lossless = new LosslessAdapter({ dataDir: config.dataDir })
    this.notes = new NoteStore({ dataDir: config.dataDir })
    if (config.mem0ApiKey && config.cloudConsentGranted) {
      this.mem0 = new Mem0Adapter({ apiKey: config.mem0ApiKey })
      console.log('[memory] Mem0 cloud memory: ENABLED (user consented)')
    } else if (config.mem0ApiKey && !config.cloudConsentGranted) {
      this.mem0 = null
      console.warn('[memory] Mem0 API key found but cloud consent not granted. Enable in Settings → Cloud Features.')
    } else {
      this.mem0 = null
    }
    this.infinity = new InfinityClient(config.infinityUrl ?? 'http://localhost:23817')
    // Probe Infinity in background — don't block constructor
    this.infinity.isAvailable().then(ok => {
      this.infinityAvailable = ok
      if (ok) console.log('[memory] Infinity vector DB connected')
    }).catch(() => {})
  }

  async write(
    entry: MemoryEntry,
    retention: 'ephemeral' | 'useful' | 'remember' = 'useful'
  ): Promise<void> {
    if (retention === 'ephemeral') return

    await this.lossless.write(entry)

    if (this.infinityAvailable) {
      this.infinity
        .upsert('memories', entry.id ?? entry.sessionId, entry.content, [], { sessionId: entry.sessionId, role: entry.role })
        .catch((err) => console.warn('[memory] infinity upsert failed:', err))
    }

    if (retention === 'remember' && this.mem0) {
      this.mem0
        .remember(entry.sessionId, entry.content)
        .catch((err) => console.warn('[memory] mem0 write failed:', err))
    }
  }

  async semanticSearch(query: string, vector: number[], topK = 10): Promise<SearchResult[]> {
    if (this.infinityAvailable) {
      return this.infinity.hybridSearch('memories', query, vector, topK)
    }
    // Fallback: SQLite LIKE search via lossless adapter
    const all = await this.lossless.query({ sessionId: '', limit: 500 })
    const lower = query.toLowerCase()
    return all
      .filter(e => e.content.toLowerCase().includes(lower))
      .slice(0, topK)
      .map(e => ({ id: e.sessionId, text: e.content, score: 1, meta: { role: e.role } }))
  }

  async queryHistory(q: MemoryQuery): Promise<MemoryEntry[]> {
    return this.lossless.query(q)
  }

  search(query: string, limit?: number): MemoryEntry[] {
    return this.lossless.search(query, limit)
  }

  async searchPersonalized(userId: string, query: string) {
    if (!this.mem0) return []
    return this.mem0.search(userId, query)
  }

  /**
   * Flush entries beyond `windowSize` to mem0 before they fall out of the
   * active context window. Call fire-and-forget from chatRoutes.
   * No-op when mem0 is not configured.
   */
  async flushOldEntries(sessionId: string, windowSize = 20): Promise<void> {
    if (!this.mem0) return
    // Fetch one extra page beyond the window to find displaced entries
    const overflow = await this.lossless.query({ sessionId, limit: windowSize * 2 })
    const displaced = overflow.slice(windowSize)
    if (displaced.length === 0) return
    for (const entry of displaced) {
      this.mem0
        .remember(sessionId, `[${entry.role}]: ${entry.content}`)
        .catch((err) => console.warn('[memory] flush to mem0 failed:', err))
    }
  }

  /**
   * Reconcile auto-`mentions` links for `note` based on its current body.
   *
   * Steps:
   *   1. Build the entity table from all other notes (id → [title]).
   *   2. Parse wikilinks and entity mentions through the learned policy.
   *   3. Resolve targets: wikilinks match by title or by id; mentions
   *      already resolve to canonical ids via the entity table.
   *   4. Diff against the current outgoing `mentions` edges from this note.
   *      Add new ones; remove ones the new parse no longer produces — but
   *      pass `recordFeedback: false` so this internal churn does not
   *      poison the learned policy.
   *
   * Returns the set of target ids the note now mentions, for callers that
   * want to render or log them.
   */
  materializeMentions(note: Note): Set<string> {
    const allOthers = this.notes.list({ limit: 10_000 }).filter(n => n.id !== note.id)
    const entities = new Map<string, string[]>()
    const titleIndex = new Map<string, string>() // lowercased title → id
    for (const n of allOthers) {
      entities.set(n.id, [n.title])
      titleIndex.set(n.title.toLowerCase().trim(), n.id)
    }

    const policy = makeLearnedPolicy(t => this.notes.getMentionStats(t))
    const parsed = parseAll(note.body, entities, policy)

    const resolved = new Set<string>()
    for (const m of parsed.mentions) resolved.add(m.target)
    for (const w of parsed.wikilinks) {
      // Wikilinks may be a title or a raw id. Try title first.
      const byTitle = titleIndex.get(w.target.toLowerCase().trim())
      if (byTitle && byTitle !== note.id) { resolved.add(byTitle); continue }
      // Treat as id only if we can confirm a note exists with that id.
      if (w.target !== note.id && this.notes.get(w.target)) resolved.add(w.target)
    }

    const existing = new Set(
      this.notes.outgoing(note.id).filter(l => l.kind === 'mentions').map(l => l.toId),
    )
    for (const targetId of resolved) {
      if (!existing.has(targetId)) this.notes.link(note.id, targetId, 'mentions')
    }
    for (const targetId of existing) {
      if (!resolved.has(targetId)) {
        this.notes.unlink(note.id, targetId, 'mentions', { recordFeedback: false })
      }
    }
    return resolved
  }

  async close(): Promise<void> {
    await this.lossless.close()
    this.notes.close()
    // Note: mem0ai MemoryClient has no close() — HTTP connections drain naturally
  }
}

export type { MemoryEntry, MemoryQuery, Note }

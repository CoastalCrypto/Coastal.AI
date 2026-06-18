import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { CORE_KINDS, isRegisteredKind, type CoreNoteKind } from './kinds-registry.js'

// Re-exported for back-compat: `NOTE_KINDS` was the canonical list before
// the kinds-registry split. Code that only needs the core set still works.
// Plugins that contribute additional kinds should import from
// './kinds-registry.js' directly and call registerKind() at module load.
export { CORE_KINDS as NOTE_KINDS }

/**
 * NoteKind is intentionally widened to `string` post-Tier-2: plugins
 * register their own kinds (`trade`, future: `image_gen`, `audio_clip`)
 * without forking core. Use `CoreNoteKind` when you specifically need
 * compile-time guarantee of one of the eight built-in kinds.
 */
export type NoteKind = string
export type { CoreNoteKind }

// Link kinds describe the relationship between two notes. `mentions` is
// the auto-derived default from wikilinks/entity scans; the others are
// explicit and meaningful enough to deserve their own edge color later.
export const LINK_KINDS = [
  'mentions',
  'derives_from',
  'contradicts',
  'supersedes',
  'contains',
] as const
export type LinkKind = typeof LINK_KINDS[number]

export interface Note {
  id: string
  title: string
  body: string
  kind: NoteKind
  sourceType: string | null
  sourceId: string | null
  createdAt: number
  updatedAt: number
  /** Lamport clock for cross-node replication LWW. Local mutations bump it. */
  rev: number
  /** Node id this revision was replicated from; null for locally authored notes. */
  origin: string | null
}

export interface NoteInput {
  title: string
  body: string
  kind: NoteKind
  sourceType?: string | null
  sourceId?: string | null
  id?: string
  origin?: string | null
}

/** A note received from a peer, carrying its Lamport rev + origin. */
export interface ReplicatedNote {
  id: string
  title: string
  body: string
  kind: NoteKind
  sourceType: string | null
  sourceId: string | null
  rev: number
  origin: string | null
}

export interface NotePatch {
  title?: string
  body?: string
  kind?: NoteKind
  sourceType?: string | null
  sourceId?: string | null
}

export interface NoteLink {
  fromId: string
  toId: string
  kind: LinkKind
  createdAt: number
}

export interface ListFilter {
  kind?: NoteKind
  sourceType?: string
  limit?: number
  offset?: number
}

interface NoteRow {
  id: string
  title: string
  body: string
  kind: string
  source_type: string | null
  source_id: string | null
  created_at: number
  updated_at: number
  rev: number
  origin: string | null
}

interface LinkRow {
  from_id: string
  to_id: string
  kind: string
  created_at: number
}

export interface MentionFeedback {
  target: string
  rejectedCount: number
  lastRejectedAt: number | null
}

interface FeedbackRow {
  target: string
  rejected_count: number
  last_rejected_at: number | null
}

const linkKindList = LINK_KINDS.map(k => `'${k}'`).join(',')

export class NoteStore {
  private db: Database.Database

  constructor(config: { dataDir: string }) {
    mkdirSync(config.dataDir, { recursive: true })
    this.db = new Database(join(config.dataDir, 'obsidian.db'))
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(`
      -- kind is validated at the application layer (NoteStore.create /
      -- upsert call assertRegisteredKind) so plugins can register
      -- additional kinds at runtime via the kinds-registry without
      -- needing a schema migration. The DB-level CHECK was dropped in
      -- the Tier 2 refactor (2026-05-11).
      CREATE TABLE IF NOT EXISTS notes (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL,
        kind        TEXT NOT NULL,
        source_type TEXT,
        source_id   TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        rev         INTEGER NOT NULL DEFAULT 1,
        origin      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_notes_kind        ON notes(kind);
      CREATE INDEX IF NOT EXISTS idx_notes_source      ON notes(source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_notes_updated     ON notes(updated_at DESC);

      CREATE TABLE IF NOT EXISTS note_links (
        from_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        to_id      TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN (${linkKindList})),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id, kind)
      );
      CREATE INDEX IF NOT EXISTS idx_links_from ON note_links(from_id);
      CREATE INDEX IF NOT EXISTS idx_links_to   ON note_links(to_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        id UNINDEXED,
        title,
        body,
        tokenize = 'porter ascii'
      );

      -- Tracks how often a given mention target has been rejected by the
      -- user (manual unlink of an auto-generated 'mentions' edge). The
      -- learned policy reads this to block future noisy auto-links.
      -- Keep is implicit: count of surviving 'mentions' edges to the target.
      CREATE TABLE IF NOT EXISTS mention_feedback (
        target            TEXT PRIMARY KEY,
        rejected_count    INTEGER NOT NULL DEFAULT 0,
        last_rejected_at  INTEGER
      );
    `)

    // Additive migration for DBs created before the replication columns existed.
    const cols = this.db.prepare(`PRAGMA table_info(notes)`).all() as { name: string }[]
    const has = (c: string) => cols.some(x => x.name === c)
    if (!has('rev')) this.db.exec(`ALTER TABLE notes ADD COLUMN rev INTEGER NOT NULL DEFAULT 1`)
    if (!has('origin')) this.db.exec(`ALTER TABLE notes ADD COLUMN origin TEXT`)
  }

  create(input: NoteInput): Note {
    assertRegisteredKind(input.kind)
    const now = Date.now()
    const id = input.id ?? randomUUID()
    const note: Note = {
      id,
      title: input.title,
      body: input.body,
      kind: input.kind,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      createdAt: now,
      updatedAt: now,
      rev: 1,
      origin: input.origin ?? null,
    }
    this.db
      .prepare(`
        INSERT INTO notes (id, title, body, kind, source_type, source_id, created_at, updated_at, rev, origin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(note.id, note.title, note.body, note.kind, note.sourceType, note.sourceId, note.createdAt, note.updatedAt, note.rev, note.origin)
    this.db
      .prepare(`INSERT INTO notes_fts (id, title, body) VALUES (?, ?, ?)`)
      .run(note.id, note.title, note.body)
    return note
  }

  /**
   * Insert-or-update by id. Used by deterministic ingestion pipelines
   * (code graph, design tokens, eval results) where the id is a stable
   * derived key and the body changes as the source of truth changes.
   *
   * Always returns the resulting note. Bumps `updatedAt` to now;
   * preserves the original `createdAt` if the row already existed.
   */
  upsert(input: NoteInput): Note {
    if (!input.id) {
      // Without a stable id, upsert collapses to create.
      return this.create(input)
    }
    const existing = this.get(input.id)
    if (existing) {
      const patched = this.update(input.id, {
        title: input.title,
        body: input.body,
        kind: input.kind,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
      })
      // update() returned non-null because we just confirmed existence above.
      return patched as Note
    }
    return this.create(input)
  }

  /**
   * Apply a note received from a peer. Lamport LWW: write only if the incoming
   * rev is strictly higher, or equal-rev with a higher origin id (deterministic
   * tie-break so all nodes converge). Stores rev = max(local, incoming).
   */
  applyReplicated(note: ReplicatedNote): 'applied' | 'skipped' {
    assertRegisteredKind(note.kind)
    const existing = this.get(note.id)
    if (existing) {
      const wins =
        note.rev > existing.rev ||
        (note.rev === existing.rev && (note.origin ?? '') > (existing.origin ?? ''))
      if (!wins) return 'skipped'
    }
    const now = Date.now()
    const mergedRev = existing ? Math.max(existing.rev, note.rev) : note.rev
    this.db
      .prepare(`
        INSERT INTO notes (id, title, body, kind, source_type, source_id, created_at, updated_at, rev, origin)
        VALUES (@id, @title, @body, @kind, @sourceType, @sourceId, @createdAt, @updatedAt, @rev, @origin)
        ON CONFLICT(id) DO UPDATE SET
          title=@title, body=@body, kind=@kind, source_type=@sourceType,
          source_id=@sourceId, updated_at=@updatedAt, rev=@rev, origin=@origin
      `)
      .run({
        id: note.id, title: note.title, body: note.body, kind: note.kind,
        sourceType: note.sourceType, sourceId: note.sourceId,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
        rev: mergedRev, origin: note.origin,
      })
    this.db.prepare(`DELETE FROM notes_fts WHERE id = ?`).run(note.id)
    this.db.prepare(`INSERT INTO notes_fts (id, title, body) VALUES (?, ?, ?)`).run(note.id, note.title, note.body)
    return 'applied'
  }

  update(id: string, patch: NotePatch): Note | null {
    const existing = this.get(id)
    if (!existing) return null
    if (patch.kind !== undefined) assertRegisteredKind(patch.kind)
    const next: Note = {
      ...existing,
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.body !== undefined && { body: patch.body }),
      ...(patch.kind !== undefined && { kind: patch.kind }),
      ...(patch.sourceType !== undefined && { sourceType: patch.sourceType }),
      ...(patch.sourceId !== undefined && { sourceId: patch.sourceId }),
      updatedAt: Date.now(),
      rev: existing.rev + 1,
    }
    this.db
      .prepare(`
        UPDATE notes
        SET title = ?, body = ?, kind = ?, source_type = ?, source_id = ?, updated_at = ?, rev = ?
        WHERE id = ?
      `)
      .run(next.title, next.body, next.kind, next.sourceType, next.sourceId, next.updatedAt, next.rev, next.id)
    // FTS5 doesn't support UPDATE WHERE id; delete + reinsert is the idiom.
    this.db.prepare(`DELETE FROM notes_fts WHERE id = ?`).run(next.id)
    this.db.prepare(`INSERT INTO notes_fts (id, title, body) VALUES (?, ?, ?)`).run(next.id, next.title, next.body)
    return next
  }

  get(id: string): Note | null {
    const row = this.db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as NoteRow | undefined
    return row ? rowToNote(row) : null
  }

  delete(id: string): boolean {
    // CASCADE removes link rows; we still need to clean FTS manually.
    this.db.prepare(`DELETE FROM notes_fts WHERE id = ?`).run(id)
    const info = this.db.prepare(`DELETE FROM notes WHERE id = ?`).run(id)
    return info.changes > 0
  }

  list(filter: ListFilter = {}): Note[] {
    const where: string[] = []
    const params: (string | number)[] = []
    if (filter.kind) { where.push('kind = ?'); params.push(filter.kind) }
    if (filter.sourceType) { where.push('source_type = ?'); params.push(filter.sourceType) }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const limit = filter.limit ?? 100
    const offset = filter.offset ?? 0
    const rows = this.db
      .prepare(`SELECT * FROM notes ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as NoteRow[]
    return rows.map(rowToNote)
  }

  /**
   * All notes derived from a single (sourceType, sourceId) origin. Used by
   * ingest pipelines (markdown, code graph) to scope reconciliation to the
   * notes they own, leaving everything else untouched.
   */
  bySource(sourceType: string, sourceId: string): Note[] {
    const rows = this.db
      .prepare(`SELECT * FROM notes WHERE source_type = ? AND source_id = ? ORDER BY updated_at DESC`)
      .all(sourceType, sourceId) as NoteRow[]
    return rows.map(rowToNote)
  }

  search(query: string, limit = 20): Note[] {
    if (!query.trim()) return []
    const rows = this.db
      .prepare(`
        SELECT n.* FROM notes n
        JOIN notes_fts fts ON fts.id = n.id
        WHERE notes_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `)
      .all(query, limit) as NoteRow[]
    return rows.map(rowToNote)
  }

  link(fromId: string, toId: string, kind: LinkKind = 'mentions'): NoteLink | null {
    if (fromId === toId) return null
    const now = Date.now()
    try {
      this.db
        .prepare(`INSERT OR IGNORE INTO note_links (from_id, to_id, kind, created_at) VALUES (?, ?, ?, ?)`)
        .run(fromId, toId, kind, now)
    } catch {
      return null
    }
    return { fromId, toId, kind, createdAt: now }
  }

  /**
   * Removes link rows. When a `mentions` edge is removed (either explicitly
   * via kind='mentions' or implicitly via an unfiltered call), the target
   * is also recorded as user-rejected so the learned policy can suppress
   * future auto-mentions of it. Pass `recordFeedback: false` to skip this
   * (used by the materialize-links pipeline when reconciling generated
   * mentions on note edits — those aren't user signal).
   */
  unlink(
    fromId: string,
    toId: string,
    kind?: LinkKind,
    opts: { recordFeedback?: boolean } = {},
  ): number {
    const recordFeedback = opts.recordFeedback ?? true
    const willRemoveMention = kind === undefined || kind === 'mentions'
    const existedAsMention = willRemoveMention
      ? (this.db
          .prepare(`SELECT 1 FROM note_links WHERE from_id = ? AND to_id = ? AND kind = 'mentions'`)
          .get(fromId, toId) as { 1: number } | undefined) !== undefined
      : false

    const sql = kind
      ? `DELETE FROM note_links WHERE from_id = ? AND to_id = ? AND kind = ?`
      : `DELETE FROM note_links WHERE from_id = ? AND to_id = ?`
    const params = kind ? [fromId, toId, kind] : [fromId, toId]
    const changes = this.db.prepare(sql).run(...params).changes

    if (recordFeedback && existedAsMention && changes > 0) {
      this.recordMentionRejection(toId)
    }
    return changes
  }

  // ------------------------------------------------------------------
  // Learned mention policy
  // ------------------------------------------------------------------

  /**
   * Bump the rejection counter for `target`. Called automatically by
   * `unlink` when a mentions edge is removed, but also exposed so the
   * future settings UI can let users blocklist a target outright.
   */
  recordMentionRejection(target: string): void {
    const now = Date.now()
    this.db
      .prepare(`
        INSERT INTO mention_feedback (target, rejected_count, last_rejected_at)
        VALUES (?, 1, ?)
        ON CONFLICT(target) DO UPDATE SET
          rejected_count = rejected_count + 1,
          last_rejected_at = excluded.last_rejected_at
      `)
      .run(target, now)
  }

  /** Reset the learned signal for a target — used by the UI's "trust again" button. */
  clearMentionFeedback(target: string): void {
    this.db.prepare(`DELETE FROM mention_feedback WHERE target = ?`).run(target)
  }

  /** All feedback rows. The UI lists these as the editable surface. */
  listMentionFeedback(): MentionFeedback[] {
    const rows = this.db
      .prepare(`SELECT target, rejected_count, last_rejected_at FROM mention_feedback ORDER BY rejected_count DESC`)
      .all() as FeedbackRow[]
    return rows.map(r => ({
      target: r.target,
      rejectedCount: r.rejected_count,
      lastRejectedAt: r.last_rejected_at,
    }))
  }

  /**
   * Aggregate stats for one target — kept (surviving mentions edges into
   * it) plus rejected (cumulative manual-unlink count). Stable signal the
   * learned predicate uses to decide whether to block.
   */
  getMentionStats(target: string): { kept: number; rejected: number; lastRejectedAt: number | null } {
    const kept = (this.db
      .prepare(`SELECT COUNT(*) AS n FROM note_links WHERE to_id = ? AND kind = 'mentions'`)
      .get(target) as { n: number }).n
    const fb = this.db
      .prepare(`SELECT rejected_count, last_rejected_at FROM mention_feedback WHERE target = ?`)
      .get(target) as { rejected_count: number; last_rejected_at: number | null } | undefined
    return {
      kept,
      rejected: fb?.rejected_count ?? 0,
      lastRejectedAt: fb?.last_rejected_at ?? null,
    }
  }

  outgoing(id: string): NoteLink[] {
    const rows = this.db.prepare(`SELECT * FROM note_links WHERE from_id = ?`).all(id) as LinkRow[]
    return rows.map(rowToLink)
  }

  backlinks(id: string): NoteLink[] {
    const rows = this.db.prepare(`SELECT * FROM note_links WHERE to_id = ?`).all(id) as LinkRow[]
    return rows.map(rowToLink)
  }

  /**
   * Local subgraph centered on `rootId` out to `depth` hops in either
   * direction. Used by the canvas to zoom into a single note's neighborhood
   * without dragging the entire knowledge base into the simulation.
   */
  subgraph(rootId: string, depth = 1): { nodes: Note[]; edges: NoteLink[] } {
    const nodeIds = new Set<string>([rootId])
    const edges: NoteLink[] = []
    const frontier = new Set<string>([rootId])
    for (let d = 0; d < depth; d++) {
      const next = new Set<string>()
      for (const id of frontier) {
        for (const link of [...this.outgoing(id), ...this.backlinks(id)]) {
          edges.push(link)
          for (const neighbor of [link.fromId, link.toId]) {
            if (!nodeIds.has(neighbor)) {
              nodeIds.add(neighbor)
              next.add(neighbor)
            }
          }
        }
      }
      if (next.size === 0) break
      frontier.clear()
      next.forEach(n => frontier.add(n))
    }
    const placeholders = Array.from(nodeIds).map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT * FROM notes WHERE id IN (${placeholders})`)
      .all(...nodeIds) as NoteRow[]
    return { nodes: rows.map(rowToNote), edges: dedupeLinks(edges) }
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as n FROM notes`).get() as { n: number }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}

/**
 * Replaces the dropped SQLite CHECK constraint. Throws when an
 * unregistered kind shows up at write time. Plugins must call
 * `registerKind('foo')` (idempotent) before writing notes of kind 'foo'.
 */
function assertRegisteredKind(kind: string): void {
  if (!isRegisteredKind(kind)) {
    throw new Error(
      `NoteStore: unregistered note kind "${kind}". ` +
      `Call registerKind("${kind}") from your package's entry point first.`,
    )
  }
}

function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    kind: row.kind as NoteKind,
    sourceType: row.source_type,
    sourceId: row.source_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rev: row.rev,
    origin: row.origin,
  }
}

function rowToLink(row: LinkRow): NoteLink {
  return {
    fromId: row.from_id,
    toId: row.to_id,
    kind: row.kind as LinkKind,
    createdAt: row.created_at,
  }
}

function dedupeLinks(links: NoteLink[]): NoteLink[] {
  const seen = new Set<string>()
  const out: NoteLink[] = []
  for (const l of links) {
    const key = `${l.fromId}|${l.toId}|${l.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(l)
  }
  return out
}

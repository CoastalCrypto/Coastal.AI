import { writeFileSync, rmSync, readdirSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NoteStore, Note } from './notes.js'
import { serializeNote } from './replication-frontmatter.js'

export interface ExportResult { written: number; removed: number }
export type NoteSelector = (note: Note) => boolean

/**
 * Reconcile a folder of <id>.md files to exactly the notes matching `select`.
 * Writes/overwrites selected notes; removes .md for ids no longer selected.
 * Idempotent: re-running with the same state is a no-op (write count = 0).
 */
export function exportNotes(store: NoteStore, dir: string, select: NoteSelector): ExportResult {
  mkdirSync(dir, { recursive: true })
  const selected = store.list({ limit: 1_000_000 }).filter(select)
  const selectedIds = new Set(selected.map(n => n.id))

  let written = 0
  for (const n of selected) {
    const text = serializeNote({
      id: n.id, title: n.title, body: n.body, kind: n.kind,
      sourceType: n.sourceType, sourceId: n.sourceId, rev: n.rev, origin: n.origin,
    })
    const path = join(dir, `${n.id}.md`)
    const prev = safeRead(path)
    if (prev !== text) { writeFileSync(path, text); written++ }
  }

  let removed = 0
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const id = f.slice(0, -3)
    if (!selectedIds.has(id)) { rmSync(join(dir, f)); removed++ }
  }
  return { written, removed }
}

function safeRead(path: string): string | null {
  try { return readFileSync(path, 'utf8') } catch { return null }
}

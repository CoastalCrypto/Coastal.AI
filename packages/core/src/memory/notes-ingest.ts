import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NoteStore } from './notes.js'
import { parseNoteFile } from './replication-frontmatter.js'

export interface IngestResult { applied: number; skipped: number; invalid: number; deleted: number }

/**
 * Reconcile the local store to a folder of <id>.md replication files.
 * Applies peer notes via Lamport LWW; deletes local replicated notes whose
 * file disappeared. Only touches notes whose local `origin` is non-null
 * (i.e. previously replicated in) — locally authored notes are never deleted.
 */
export function ingestDir(store: NoteStore, dir: string): IngestResult {
  const res: IngestResult = { applied: 0, skipped: 0, invalid: 0, deleted: 0 }
  const seen = new Set<string>()

  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const parsed = parseNoteFile(readFileSync(join(dir, f), 'utf8'))
    if (!parsed.ok) { res.invalid++; continue }
    seen.add(parsed.note.id)
    const outcome = store.applyReplicated(parsed.note)
    res[outcome]++ // 'applied' | 'skipped'
  }

  // Deletions: replicated notes no longer present in the folder.
  for (const n of store.list({ limit: 1_000_000 })) {
    if (n.origin !== null && !seen.has(n.id)) {
      store.delete(n.id)
      res.deleted++
    }
  }
  return res
}

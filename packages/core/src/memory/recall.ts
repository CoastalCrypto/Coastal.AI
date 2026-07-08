// packages/core/src/memory/recall.ts
//
// Note recall: pull the most relevant notes into an agent's context using the
// existing FTS5 NoteStore.search (BM25). Pure over the store; fail-safe (any
// error → no recall). The injection is a `user`-role message so the headroom
// compression decorator compresses it — recall and compression compound.

import type { Note, NoteStore } from './notes.js'

export interface RecallOpts {
  /** Max notes to recall (FTS5 limit). Default 5. */
  limit?: number
  /** Total body-char budget for the recalled set. Default 2000. */
  maxChars?: number
  /** Per-note body snippet cap. Default 300. */
  snippetChars?: number
}

const DEFAULT_LIMIT = 5
const DEFAULT_MAX_CHARS = 2000
const DEFAULT_SNIPPET = 300

const STOPWORDS = new Set([
  'the', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'is', 'are', 'be',
  'this', 'that', 'it', 'as', 'at', 'by', 'from', 'an', 'a',
])

/**
 * Turn arbitrary task text into a safe FTS5 query: alphanumeric tokens, drop
 * short + stopword tokens, dedupe, cap at 8, join with OR (broad BM25 recall).
 * Guarantees no FTS5 operator/quote reaches `MATCH` (which would throw).
 */
export function buildFtsQuery(text: string): string {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (raw.length < 3 || STOPWORDS.has(raw) || seen.has(raw)) continue
    seen.add(raw)
    terms.push(raw)
    if (terms.length >= 8) break
  }
  return terms.join(' OR ')
}

/** Recall the top relevant notes for a raw query text. Fail-safe: errors → []. */
export function recallNotes(store: NoteStore, queryText: string, opts: RecallOpts = {}): Note[] {
  const q = buildFtsQuery(queryText)
  if (!q) return []
  const limit = opts.limit ?? DEFAULT_LIMIT
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS

  let hits: Note[]
  try {
    hits = store.search(q, limit)
  } catch {
    return []
  }

  // Greedy by rank; always keep the top hit, then add while under budget.
  const out: Note[] = []
  let total = 0
  for (const n of hits) {
    const len = n.body.length
    if (out.length === 0 || total + len <= maxChars) {
      out.push(n)
      total += len
    }
  }
  return out
}

/** Render recalled notes into a compact, deterministic context block. */
export function formatRecalledNotes(notes: Note[], snippetChars = DEFAULT_SNIPPET): string {
  if (notes.length === 0) return ''
  const lines = notes.map((n) => {
    const flat = n.body.replace(/\s+/g, ' ').trim()
    const snippet = flat.length > snippetChars ? flat.slice(0, snippetChars) + '…' : flat
    return `- [${n.kind}] ${n.title}: ${snippet}`
  })
  return `## Relevant memory\n${lines.join('\n')}`
}

/**
 * Build a `user` context message from recalled notes, or null if nothing
 * relevant. Returned shape is structurally a ChatMessage (role 'user') without
 * importing the type — core does not depend on @coastal-ai/llm-client.
 */
export function recallContextMessage(
  store: NoteStore,
  queryText: string,
  opts: RecallOpts = {},
): { role: 'user'; content: string } | null {
  const notes = recallNotes(store, queryText, opts)
  if (notes.length === 0) return null
  return { role: 'user', content: formatRecalledNotes(notes, opts.snippetChars) }
}

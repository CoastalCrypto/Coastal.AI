import { z } from 'zod'
import type { ReplicatedNote } from './notes.js'

export type { ReplicatedNote } from './notes.js'

const FrontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  kind: z.string().min(1),
  rev: z.number().int().nonnegative(),
  origin: z.string().nullable(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
})

/** Serialize a note to `---\n<yaml>\n---\n<body>`. Body is verbatim. */
export function serializeNote(note: ReplicatedNote): string {
  const fm = [
    `id: ${JSON.stringify(note.id)}`,
    `title: ${JSON.stringify(note.title)}`,
    `kind: ${JSON.stringify(note.kind)}`,
    `rev: ${note.rev}`,
    `origin: ${note.origin === null ? 'null' : JSON.stringify(note.origin)}`,
    `sourceType: ${note.sourceType === null ? 'null' : JSON.stringify(note.sourceType)}`,
    `sourceId: ${note.sourceId === null ? 'null' : JSON.stringify(note.sourceId)}`,
  ].join('\n')
  return `---\n${fm}\n---\n${note.body}`
}

export type ParseResult =
  | { ok: true; note: ReplicatedNote }
  | { ok: false; error: string }

/** Parse a `<id>.md` replication file. Pure (no FS). */
export function parseNoteFile(text: string): ParseResult {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!m) return { ok: false, error: 'no frontmatter block' }
  const raw: Record<string, unknown> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    const key = line.slice(0, i).trim()
    const val = line.slice(i + 1).trim()
    if (val === 'null') raw[key] = null
    else if (/^-?\d+$/.test(val)) raw[key] = Number(val)
    else { try { raw[key] = JSON.parse(val) } catch { raw[key] = val } }
  }
  const parsed = FrontmatterSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.message }
  const fm = parsed.data
  return {
    ok: true,
    note: {
      id: fm.id, title: fm.title, body: m[2], kind: fm.kind as ReplicatedNote['kind'],
      sourceType: fm.sourceType, sourceId: fm.sourceId, rev: fm.rev, origin: fm.origin,
    },
  }
}

// packages/core/src/memory/markdown-ingest.ts
//
// Markdown → atomic notes ingester. Each H2 section becomes its own
// `kind` note (default: 'design') so the planner — and humans — can
// navigate sections individually rather than scrolling through one
// huge document. Mirrors the Zettelkasten "atomic note" idea.
//
// Linking model:
//   - file-note `contains` each section-note (structural)
//   - section-notes that include [[Section Title]] wikilinks resolve
//     against other sections in the same file → `mentions` edges
//   - cross-file references stay unresolved here; the broader
//     UnifiedMemory.materializeMentions handles that on user-edited notes
//
// The ingester is pure: it returns notes + links. A separate sync
// function reconciles them against the store, scoped by sourceId so
// other ingesters don't get clobbered.

import type { LinkKind, NoteKind } from './notes.js'

export interface MarkdownIngestInput {
  /** Project-relative path of the markdown file. Becomes the sourceId. */
  relPath: string
  /** Raw file contents. */
  source: string
  /** Note kind for the file + sections. Defaults to 'design'. */
  kind?: NoteKind
  /** sourceType label written onto every produced note. */
  sourceType?: string
}

export interface MarkdownNoteSpec {
  id: string
  title: string
  body: string
  kind: NoteKind
  sourceType: string
  sourceId: string
  /** 1 for the file-level note, 2 for H2 sections, etc. */
  level: number
  /** Anchor slug used in the id (`design:path#anchor`). */
  anchor: string | null
}

export interface MarkdownLinkSpec {
  fromId: string
  toId: string
  kind: LinkKind
}

export interface MarkdownIngestResult {
  notes: MarkdownNoteSpec[]
  links: MarkdownLinkSpec[]
}

export function ingestMarkdown(input: MarkdownIngestInput): MarkdownIngestResult {
  const kind = input.kind ?? 'design'
  const sourceType = input.sourceType ?? 'markdown'
  const sections = splitSections(input.source)

  const fileTitle = deriveFileTitle(input.source, input.relPath)
  const fileId = markdownNoteId(input.relPath, null, kind)
  const fileNote: MarkdownNoteSpec = {
    id: fileId,
    title: fileTitle,
    body: renderFileSummary(input.relPath, sections),
    kind,
    sourceType,
    sourceId: input.relPath,
    level: 1,
    anchor: null,
  }

  const sectionNotes: MarkdownNoteSpec[] = sections.map(s => ({
    id: markdownNoteId(input.relPath, s.anchor, kind),
    title: s.title,
    body: s.body,
    kind,
    sourceType,
    sourceId: input.relPath,
    level: s.level,
    anchor: s.anchor,
  }))

  // file → contains → each section
  const links: MarkdownLinkSpec[] = sectionNotes.map(s => ({
    fromId: fileId, toId: s.id, kind: 'contains' as const,
  }))

  // Resolve in-file wikilinks: [[Section Title]] in any section's body
  // links to that section if it exists in this file.
  const titleIndex = new Map<string, string>()
  for (const s of sectionNotes) titleIndex.set(s.title.toLowerCase().trim(), s.id)
  for (const s of sectionNotes) {
    for (const target of extractWikilinkTargets(s.body)) {
      const targetId = titleIndex.get(target.toLowerCase().trim())
      if (!targetId || targetId === s.id) continue
      links.push({ fromId: s.id, toId: targetId, kind: 'mentions' })
    }
  }

  return { notes: [fileNote, ...sectionNotes], links }
}

/** Stable id helper. Uses anchor slug when present, file path otherwise. */
export function markdownNoteId(relPath: string, anchor: string | null, kind: NoteKind = 'design'): string {
  const path = relPath.split(/[\\/]+/).join('/')
  return anchor ? `${kind}:${path}#${anchor}` : `${kind}:${path}`
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Section {
  title: string
  level: number
  anchor: string
  body: string
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm

function splitSections(source: string): Section[] {
  const sections: Section[] = []
  // Find every heading; we treat H2+ as sections (H1 is the file title).
  type Hit = { level: number; title: string; bodyStart: number }
  const hits: Hit[] = []
  let m: RegExpExecArray | null
  HEADING_RE.lastIndex = 0
  while ((m = HEADING_RE.exec(source)) !== null) {
    const level = m[1].length
    const title = m[2].trim()
    // Body starts after the heading line's terminating newline.
    const lineEnd = source.indexOf('\n', m.index)
    const bodyStart = lineEnd >= 0 ? lineEnd + 1 : source.length
    hits.push({ level, title, bodyStart })
  }

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]
    if (h.level < 2) continue // H1 is the file note's title; skip section
    const next = hits[i + 1]
    const bodyEnd = next ? findHeadingStart(source, next.bodyStart) : source.length
    const body = source.slice(h.bodyStart, bodyEnd).trimEnd()
    sections.push({
      title: h.title,
      level: h.level,
      anchor: slugify(h.title),
      body,
    })
  }
  return sections
}

function findHeadingStart(source: string, bodyStart: number): number {
  // bodyStart is the char *after* the next heading's terminating \n.
  // Walk back to the heading's first character (start of its line).
  let i = bodyStart - 1
  while (i > 0 && source[i] !== '\n') i--
  return i < 0 ? 0 : i + 1
}

function deriveFileTitle(source: string, relPath: string): string {
  const m = source.match(/^#\s+(.+?)\s*#*\s*$/m)
  if (m) return m[1].trim()
  // Fall back to the file's basename without extension.
  const base = relPath.split(/[\\/]+/).pop() ?? relPath
  return base.replace(/\.[^.]+$/, '')
}

function renderFileSummary(relPath: string, sections: Section[]): string {
  const lines: string[] = [`Source: ${relPath}`, '', `Sections (${sections.length}):`]
  for (const s of sections) lines.push(`- ${s.title}`)
  return lines.join('\n')
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section'
}

const WIKILINK_RE = /\[\[([^\[\]\n]+?)\]\]/g

function extractWikilinkTargets(body: string): string[] {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const target = m[1].trim()
    if (target.length > 0) out.add(target)
  }
  return [...out]
}

// packages/core/src/memory/visual-diff.ts
//
// Lightweight structural diff between two DomSnapshots. No vision model
// needed; instead extracts a "user-visible signature" from each HTML
// body (headings, button labels, link texts, form labels, error
// keywords) and reports the symmetric difference.
//
// Why structural and not pixel/vision: most regressions worth catching
// are textual — a button label changed from "Save" to "Submit", a
// heading went away, an error keyword appeared. A future UI-TARS
// adapter can swap in for visual confirmation; both write the same
// kind='visual_diff' note shape so downstream consumers stay agnostic.

import type { NoteStore } from './notes.js'
import type { DomSnapshot } from './dom-snapshots.js'
import { urlSlug } from './dom-snapshots.js'

export interface VisualSignature {
  headings: string[]
  buttons: string[]
  links: string[]
  labels: string[]
  /** Whether the body contains common error markers (Error, 500, Stack trace…). */
  hasErrorKeywords: boolean
}

export interface VisualDiff {
  url: string
  baselineTakenAt: number
  freshTakenAt: number
  /** Items that appeared in fresh but not baseline. */
  added: { headings: string[]; buttons: string[]; links: string[]; labels: string[] }
  /** Items that appeared in baseline but not fresh. */
  removed: { headings: string[]; buttons: string[]; links: string[]; labels: string[] }
  /** Jaccard similarity on the union signature, 0–1. 1 = identical signature. */
  similarity: number
  /** True when fresh introduces error keywords baseline didn't have. */
  newErrorKeywords: boolean
  /** True when this counts as a meaningful regression (heuristic). */
  regressed: boolean
}

const HEADING_RE = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi
const BUTTON_RE = /<button[^>]*>([\s\S]*?)<\/button>/gi
const LINK_RE = /<a\s[^>]*>([\s\S]*?)<\/a>/gi
const LABEL_RE = /<label[^>]*>([\s\S]*?)<\/label>/gi
const ERROR_KEYWORDS_RE = /\b(error|exception|stack trace|500|fatal|uncaught)\b/i

export function extractSignature(body: string): VisualSignature {
  return {
    headings: extractAll(body, HEADING_RE, m => m[2]),
    buttons:  extractAll(body, BUTTON_RE, m => m[1]),
    links:    extractAll(body, LINK_RE,   m => m[1]),
    labels:   extractAll(body, LABEL_RE,  m => m[1]),
    hasErrorKeywords: ERROR_KEYWORDS_RE.test(body),
  }
}

export function computeVisualDiff(baseline: DomSnapshot, fresh: DomSnapshot): VisualDiff {
  const a = extractSignature(baseline.bodyPreview)
  const b = extractSignature(fresh.bodyPreview)
  const added = {
    headings: setDiff(b.headings, a.headings),
    buttons:  setDiff(b.buttons,  a.buttons),
    links:    setDiff(b.links,    a.links),
    labels:   setDiff(b.labels,   a.labels),
  }
  const removed = {
    headings: setDiff(a.headings, b.headings),
    buttons:  setDiff(a.buttons,  b.buttons),
    links:    setDiff(a.links,    b.links),
    labels:   setDiff(a.labels,   b.labels),
  }
  const similarity = jaccard(
    [...a.headings, ...a.buttons, ...a.links, ...a.labels],
    [...b.headings, ...b.buttons, ...b.links, ...b.labels],
  )
  const newErrorKeywords = b.hasErrorKeywords && !a.hasErrorKeywords
  const regressed = newErrorKeywords
    || removed.headings.length > 0
    || removed.buttons.length > 0
    || similarity < 0.6
  return {
    url: fresh.url,
    baselineTakenAt: baseline.takenAt,
    freshTakenAt: fresh.takenAt,
    added, removed, similarity,
    newErrorKeywords, regressed,
  }
}

// ---------------------------------------------------------------------------
// Notes persistence
// ---------------------------------------------------------------------------

export function visualDiffNoteId(diff: VisualDiff): string {
  return `visual_diff:${urlSlug(diff.url)}:${diff.baselineTakenAt}-${diff.freshTakenAt}`
}

export function visualDiffSourceId(url: string): string {
  return `url:${url}`
}

export interface PersistedVisualDiffRef {
  noteId: string
  url: string
  regressed: boolean
}

export function writeVisualDiffAsNote(store: NoteStore, diff: VisualDiff): PersistedVisualDiffRef {
  const id = visualDiffNoteId(diff)
  const sourceId = visualDiffSourceId(diff.url)
  const tick = diff.regressed ? '✗' : '✓'
  const title = `${tick} visual diff ${diff.url} (${(diff.similarity * 100).toFixed(0)}%)`
  const body = renderVisualDiffMarkdown(diff)
  store.upsert({
    id, title, body, kind: 'visual_diff',
    sourceType: 'dom-diff',
    sourceId,
  })
  return { noteId: id, url: diff.url, regressed: diff.regressed }
}

function renderVisualDiffMarkdown(d: VisualDiff): string {
  const lines: string[] = [
    `# Visual diff: ${d.url}`,
    '',
    `- **Verdict:** ${d.regressed ? 'REGRESSED ✗' : 'OK ✓'}`,
    `- **Similarity:** ${(d.similarity * 100).toFixed(1)}%`,
    `- **New error keywords:** ${d.newErrorKeywords ? 'YES' : 'no'}`,
    `- **Baseline:** ${new Date(d.baselineTakenAt).toISOString()}`,
    `- **Fresh:**    ${new Date(d.freshTakenAt).toISOString()}`,
    '',
    '```diff-meta',
    JSON.stringify({
      url: d.url,
      baselineTakenAt: d.baselineTakenAt,
      freshTakenAt: d.freshTakenAt,
      similarity: d.similarity,
      newErrorKeywords: d.newErrorKeywords,
      regressed: d.regressed,
      added: d.added, removed: d.removed,
    }),
    '```',
  ]
  for (const [section, addList, removeList] of [
    ['Headings', d.added.headings, d.removed.headings],
    ['Buttons',  d.added.buttons,  d.removed.buttons],
    ['Links',    d.added.links,    d.removed.links],
    ['Labels',   d.added.labels,   d.removed.labels],
  ] as const) {
    if (addList.length === 0 && removeList.length === 0) continue
    lines.push('', `## ${section}`)
    for (const x of addList) lines.push(`+ ${trim(x)}`)
    for (const x of removeList) lines.push(`- ${trim(x)}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractAll(body: string, re: RegExp, pick: (m: RegExpExecArray) => string): string[] {
  const out: string[] = []
  // Cloned regex so concurrent extracts don't share lastIndex.
  const r = new RegExp(re.source, re.flags)
  let m: RegExpExecArray | null
  while ((m = r.exec(body)) !== null) {
    const text = stripTags(pick(m)).trim()
    if (text.length > 0) out.push(text)
  }
  return out
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function setDiff(a: string[], b: string[]): string[] {
  const bs = new Set(b)
  return a.filter(x => !bs.has(x))
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  const sa = new Set(a)
  const sb = new Set(b)
  const inter = [...sa].filter(x => sb.has(x)).length
  const union = new Set([...sa, ...sb]).size
  return union === 0 ? 1 : inter / union
}

function trim(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

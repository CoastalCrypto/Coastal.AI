// packages/core/src/memory/impact.ts
//
// Renders an impact-radius summary for the planner. Given a target file
// (project-relative path), returns a compact prose block listing:
//   - which other files import it (the "blast radius" if you change it)
//   - what the file itself imports (its dependencies)
//   - top-level exports (so the planner knows what surface it's editing)
//
// The query is just notes.backlinks(id) + notes.outgoing(id) — the
// substrate slice already gives us this for free. This module is pure
// formatting on top.

import type { NoteStore } from './notes.js'
import { codeGraphNoteId } from './code-graph-id.js'

const MAX_IMPACT_LIST = 12

export interface ImpactSummary {
  /** The target file the summary is centered on. */
  target: string
  /** Files that import the target, project-relative paths. */
  importedBy: string[]
  /** Files the target imports, project-relative paths. */
  imports: string[]
  /** Top-level exports declared in the file (parsed from the note body). */
  exports: string[]
  /** Pre-rendered prose block ready to paste into a prompt. */
  prose: string
}

export function getImpactSummary(store: NoteStore, relPath: string): ImpactSummary | null {
  const id = codeGraphNoteId(relPath)
  const note = store.get(id)
  if (!note) return null

  const importedBy = store.backlinks(id)
    .filter(l => l.kind === 'mentions' && l.fromId.startsWith('code:'))
    .map(l => l.fromId.replace(/^code:/, ''))
    .sort()

  const imports = store.outgoing(id)
    .filter(l => l.kind === 'mentions' && l.toId.startsWith('code:'))
    .map(l => l.toId.replace(/^code:/, ''))
    .sort()

  const exports = parseExportsFromSummary(note.body)

  const prose = renderProse(relPath, importedBy, imports, exports)
  return { target: relPath, importedBy, imports, exports, prose }
}

/**
 * Aggregate impact summary for multiple target files. Caller passes the
 * planning stage's `targetHints`; we render one block each, joined by a
 * separator, ready for direct prompt insertion.
 */
export function getImpactSummaryForTargets(
  store: NoteStore,
  relPaths: readonly string[],
): string {
  const blocks: string[] = []
  for (const p of relPaths) {
    const summary = getImpactSummary(store, p)
    if (summary) blocks.push(summary.prose)
  }
  return blocks.join('\n\n')
}

function renderProse(
  target: string,
  importedBy: string[],
  imports: string[],
  exports: string[],
): string {
  const importedByLine = importedBy.length === 0
    ? '(no other project files import this — safe to refactor)'
    : truncate(importedBy, MAX_IMPACT_LIST).join(', ')
  const importsLine = imports.length === 0
    ? '(no project imports — leaf module)'
    : truncate(imports, MAX_IMPACT_LIST).join(', ')
  const exportsLine = exports.length === 0
    ? '(no top-level exports detected)'
    : truncate(exports, MAX_IMPACT_LIST).join(', ')

  return [
    `### IMPACT: ${target}`,
    `Imported by (${importedBy.length}): ${importedByLine}`,
    `Imports (${imports.length}): ${importsLine}`,
    `Exports (${exports.length}): ${exportsLine}`,
  ].join('\n')
}

function truncate<T>(arr: T[], n: number): (T | string)[] {
  if (arr.length <= n) return arr
  return [...arr.slice(0, n), `+${arr.length - n} more`]
}

/**
 * The code-graph scanner formats note bodies with `Exports: foo, bar, baz`
 * lines. Parse them back so the planner can see what the file currently
 * declares without re-reading the source. Stays in sync as long as the
 * scanner is the only writer of `kind='code'` notes.
 */
function parseExportsFromSummary(body: string): string[] {
  const m = body.match(/^Exports:\s*(.+?)$/m)
  if (!m) return []
  const list = m[1].trim()
  if (list.startsWith('(')) return [] // sentinel placeholder
  return list.split(',').map(s => s.trim()).filter(s => !s.startsWith('+'))
}

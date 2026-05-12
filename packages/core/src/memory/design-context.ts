// packages/core/src/memory/design-context.ts
//
// Returns design notes scoped to a target package, formatted for the
// planner prompt. Activates when the work item touches a package that
// has its own DESIGN.md; the planner sees the design tokens + component
// idioms it needs to respect when emitting UI changes.
//
// The detection is intentionally simple: targetHints ↘ enclosing
// `packages/<name>/...` ↘ look up `kind='design'` notes whose sourceId
// equals `packages/<name>/DESIGN.md`. No fuzzy matching, no globs.

import type { NoteStore, Note } from './notes.js'

const SECTION_BUDGET_CHARS = 6000
const PER_SECTION_BUDGET = 1200

export interface DesignContext {
  /** The package name that triggered the lookup (e.g. 'web'). */
  packageName: string
  /** The DESIGN.md path that was loaded. */
  sourceId: string
  /** Section notes contained in the DESIGN.md, in source order. */
  sections: Note[]
  /** Pre-rendered prose ready to splice into the planner prompt. */
  prose: string
}

/** Extract distinct package names from a list of project-relative paths. */
export function packagesFromPaths(paths: readonly string[]): string[] {
  const out = new Set<string>()
  for (const p of paths) {
    const m = p.split(/[\\/]+/)
    if (m[0] === 'packages' && m[1]) out.add(m[1])
  }
  return [...out].sort()
}

export function getDesignContext(store: NoteStore, packageName: string): DesignContext | null {
  const sourceId = `packages/${packageName}/DESIGN.md`
  const notes = store.bySource('markdown', sourceId).filter(n => n.kind === 'design')
  if (notes.length === 0) return null

  // bySource returns updated_at DESC; the file note (no anchor) and
  // sections share an updated_at within milliseconds. Stable order:
  // file note first (id has no '#'), then sections by their anchor
  // appearance — we can't know markdown order from the DB so fall back
  // to an alphabetical-ish sort by id which corresponds to slug order.
  const fileNote = notes.find(n => !n.id.includes('#')) ?? null
  const sections = notes
    .filter(n => n.id.includes('#'))
    .sort((a, b) => a.id.localeCompare(b.id))

  const prose = renderProse(packageName, sourceId, fileNote, sections)
  return { packageName, sourceId, sections, prose }
}

/**
 * Aggregate design context for a list of target paths. Looks up DESIGN.md
 * for each enclosing package; concatenates the prose blocks; silently
 * skips packages without a design doc.
 */
export function getDesignContextForTargets(
  store: NoteStore,
  paths: readonly string[],
): string {
  const blocks: string[] = []
  for (const pkg of packagesFromPaths(paths)) {
    const ctx = getDesignContext(store, pkg)
    if (ctx) blocks.push(ctx.prose)
  }
  return blocks.join('\n\n')
}

function renderProse(
  packageName: string,
  sourceId: string,
  fileNote: Note | null,
  sections: Note[],
): string {
  const lines: string[] = [`### DESIGN (${packageName} — ${sourceId})`]
  if (fileNote) lines.push(fileNote.body.trim())
  let used = lines.join('\n').length
  for (const s of sections) {
    if (used >= SECTION_BUDGET_CHARS) {
      lines.push(`(+${sections.length - (sections.indexOf(s))} more sections truncated for budget)`)
      break
    }
    const body = s.body.length > PER_SECTION_BUDGET
      ? s.body.slice(0, PER_SECTION_BUDGET) + ' …(truncated)'
      : s.body
    const block = `\n#### ${s.title}\n${body}`
    lines.push(block)
    used += block.length
  }
  return lines.join('\n')
}

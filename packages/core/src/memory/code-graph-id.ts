// packages/core/src/memory/code-graph-id.ts
//
// Shared id format for code-graph notes. Lives in core (not the architect)
// so callers on the query side (impact, REST, future learnings stages) can
// derive ids without depending on the architect's scanner module.

const PREFIX = 'code:'

export function codeGraphNoteId(relPath: string): string {
  return PREFIX + relPath.split(/[\\/]+/).join('/')
}

export function isCodeGraphNoteId(id: string): boolean {
  return id.startsWith(PREFIX)
}

export function codeGraphRelPath(id: string): string | null {
  if (!isCodeGraphNoteId(id)) return null
  return id.slice(PREFIX.length)
}

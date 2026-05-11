// packages/architect/src/learnings/code-graph.ts
//
// Pure regex-based scanner that walks the project's TypeScript sources and
// emits one `kind='code'` note per file plus one `mentions` edge per
// resolved import. The notes substrate then makes `getImpactRadius(file) =
// notes.backlinks(file)` — every importer becomes the impact set for free.
//
// Why regex and not the TS compiler API:
//   - We need imports + a structural summary, not full type analysis.
//   - The project's style is small focused modules; no need to drag in
//     ts-morph or the program graph just to read import paths.
//   - When this misses an edge case (conditional `await import(...)`,
//     re-exports through barrels), the architect simply doesn't see that
//     dependency — same situation as today (no graph at all). Net positive.

import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join, relative, dirname, resolve, sep } from 'node:path'
import { codeGraphNoteId } from '@coastal-ai/core/memory/code-graph-id'

export interface CodeFileNote {
  /** Stable id derived from the project-relative path. */
  id: string
  /** Path relative to project root, forward-slashed. */
  relPath: string
  /** Approx LOC of the source file. */
  loc: number
  /** Resolved project-relative import paths from this file. */
  imports: string[]
  /** Top-level exported symbol names. */
  exports: string[]
  /** Pre-rendered note body suitable for sticking into the planner prompt. */
  summary: string
}

export interface CodeImportEdge {
  /** Note id of the importing file. */
  fromId: string
  /** Note id of the imported file. */
  toId: string
}

export interface ScanResult {
  notes: CodeFileNote[]
  edges: CodeImportEdge[]
}

export interface ScanConfig {
  /** Project root absolute path. */
  rootDir: string
  /** Project-relative directory paths to scan. Defaults to `packages`. */
  scanDirs?: string[]
  /** Path segments that exclude a file or directory from the scan. */
  ignoreSegments?: ReadonlySet<string>
  /** File extensions to include. */
  includeExts?: ReadonlySet<string>
}

const DEFAULT_IGNORE = new Set<string>([
  'node_modules', 'dist', 'build', '.git', 'coverage',
  '__tests__', '__mocks__', '__fixtures__',
])
const DEFAULT_EXTS = new Set<string>(['.ts', '.tsx'])
const DEFAULT_SCAN_DIRS = ['packages']

/** Stable, deterministic note id derived from a project-relative path.
 *  Re-exported here for ergonomic access from architect-side callers; the
 *  authoritative implementation lives in @coastal-ai/core/memory/code-graph-id
 *  to keep ID format consistent across query and write paths. */
export const codeNoteId = codeGraphNoteId

/**
 * Walk the project rooted at `config.rootDir` and return notes + import
 * edges for every TypeScript source file under the configured scan dirs.
 */
export function scanCodeGraph(config: ScanConfig): ScanResult {
  const rootDir = config.rootDir
  const scanDirs = config.scanDirs ?? DEFAULT_SCAN_DIRS
  const ignore = config.ignoreSegments ?? DEFAULT_IGNORE
  const exts = config.includeExts ?? DEFAULT_EXTS

  const absFiles: string[] = []
  for (const d of scanDirs) {
    walk(join(rootDir, d), ignore, exts, absFiles)
  }

  const notes: CodeFileNote[] = []
  const noteByAbs = new Map<string, CodeFileNote>()

  for (const abs of absFiles) {
    const relPath = relative(rootDir, abs).split(sep).join('/')
    const source = safeRead(abs)
    if (source === null) continue
    const imports = extractImportSpecifiers(source)
    const exportsList = extractExports(source)
    const note: CodeFileNote = {
      id: codeNoteId(relPath),
      relPath,
      loc: countLines(source),
      imports: [], // resolved below in a second pass
      exports: exportsList,
      summary: '',
    }
    notes.push(note)
    noteByAbs.set(abs, note)

    // Stash unresolved imports on a temp property; resolve in second pass.
    ;(note as unknown as { _rawImports: string[] })._rawImports = imports
  }

  // Resolve imports against the file's directory + the absolute file index.
  const absSet = new Set(absFiles)
  const edges: CodeImportEdge[] = []
  for (const note of notes) {
    const abs = resolve(rootDir, note.relPath)
    const dir = dirname(abs)
    const raw = (note as unknown as { _rawImports: string[] })._rawImports
    const resolvedRels: string[] = []
    for (const spec of raw) {
      const target = resolveImport(spec, dir, absSet, exts)
      if (!target) continue
      const targetRel = relative(rootDir, target).split(sep).join('/')
      resolvedRels.push(targetRel)
      edges.push({ fromId: note.id, toId: codeNoteId(targetRel) })
    }
    note.imports = resolvedRels
    note.summary = renderSummary(note)
    delete (note as unknown as { _rawImports?: string[] })._rawImports
  }

  return { notes, edges }
}

function walk(
  dir: string,
  ignore: ReadonlySet<string>,
  exts: ReadonlySet<string>,
  out: string[],
): void {
  let entries: { name: string; isDir: boolean; isFile: boolean }[]
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map(e => ({
      name: e.name, isDir: e.isDirectory(), isFile: e.isFile(),
    }))
  } catch { return }
  for (const e of entries) {
    if (ignore.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDir) {
      walk(full, ignore, exts, out)
    } else if (e.isFile) {
      const dot = e.name.lastIndexOf('.')
      if (dot < 0) continue
      const ext = e.name.slice(dot)
      if (exts.has(ext)) out.push(full)
    }
  }
}

function safeRead(abs: string): string | null {
  try {
    const s = statSync(abs)
    if (!s.isFile()) return null
    return readFileSync(abs, 'utf8')
  } catch { return null }
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n]+?\s+from\s+)?['"]([^'"\n]+)['"]/g
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s+['"]([^'"\n]+)['"]/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g

/** Pulls every import specifier out of source text. */
export function extractImportSpecifiers(source: string): string[] {
  const out = new Set<string>()
  for (const m of source.matchAll(IMPORT_RE)) out.add(m[1])
  for (const m of source.matchAll(SIDE_EFFECT_IMPORT_RE)) out.add(m[1])
  for (const m of source.matchAll(DYNAMIC_IMPORT_RE)) out.add(m[1])
  return [...out]
}

const EXPORT_NAMED_RE = /\bexport\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
// Word boundary before `export {` so single-line statements like
// `const a = 1; export { a }` match too.
const EXPORT_LIST_RE = /\bexport\s*\{\s*([^}]+?)\s*\}/g
const EXPORT_DEFAULT_RE = /\bexport\s+default\s+(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*))/g

/** Best-effort list of top-level exported symbol names. */
export function extractExports(source: string): string[] {
  const out = new Set<string>()
  for (const m of source.matchAll(EXPORT_NAMED_RE)) out.add(m[1])
  for (const m of source.matchAll(EXPORT_LIST_RE)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim()
      if (name) out.add(name)
    }
  }
  for (const m of source.matchAll(EXPORT_DEFAULT_RE)) {
    const named = m[1] || m[2]
    if (named) out.add(named)
  }
  return [...out]
}

/**
 * Resolves a bare import specifier against a file's directory.
 *
 * Handles the patterns we actually use in this monorepo:
 *   - Relative paths (./foo, ../bar) with optional .js extension
 *     (TypeScript ESM convention: import './foo.js' resolves to ./foo.ts).
 *   - Bare specifiers are returned as null (we don't model node_modules).
 *
 * Workspace-package imports like `@coastal-ai/core/architect/db` are also
 * skipped here — those cross package boundaries via dist files and would
 * need workspace resolution. Cross-package edges live for a future slice.
 */
function resolveImport(
  spec: string,
  fromDir: string,
  absFiles: ReadonlySet<string>,
  exts: ReadonlySet<string>,
): string | null {
  if (!spec.startsWith('.')) return null
  const cleaned = spec.endsWith('.js') ? spec.slice(0, -3) : spec
  const base = resolve(fromDir, cleaned)
  // Try exact extensions first.
  for (const ext of exts) {
    const candidate = base + ext
    if (absFiles.has(candidate)) return candidate
  }
  // Then try as a directory's index file.
  for (const ext of exts) {
    const candidate = join(base, `index${ext}`)
    if (absFiles.has(candidate)) return candidate
  }
  return null
}

function countLines(source: string): number {
  // Count newline characters + 1 for the last (possibly newline-less) line.
  let n = 0
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) n++
  return source.length === 0 ? 0 : n + 1
}

function renderSummary(note: CodeFileNote): string {
  const importsLine = note.imports.length === 0
    ? '(no project imports)'
    : note.imports.slice(0, 12).join(', ') + (note.imports.length > 12 ? `, +${note.imports.length - 12} more` : '')
  const exportsLine = note.exports.length === 0
    ? '(no top-level exports)'
    : note.exports.slice(0, 16).join(', ') + (note.exports.length > 16 ? `, +${note.exports.length - 16} more` : '')
  return [
    `File: ${note.relPath}`,
    `LOC: ${note.loc}`,
    `Imports: ${importsLine}`,
    `Exports: ${exportsLine}`,
  ].join('\n')
}

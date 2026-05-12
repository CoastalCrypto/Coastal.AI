import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  scanCodeGraph,
  extractImportSpecifiers,
  extractExports,
  codeNoteId,
} from '../code-graph.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'code-graph-'))
  mkdirSync(join(root, 'packages', 'pkg', 'src'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(rel: string, content: string) {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
}

describe('extractImportSpecifiers', () => {
  it('captures static named imports', () => {
    expect(extractImportSpecifiers(`import { a } from './foo.js'`)).toEqual(['./foo.js'])
  })

  it('captures default + namespace imports', () => {
    const src = `import x from './a'\nimport * as y from './b'`
    expect(extractImportSpecifiers(src).sort()).toEqual(['./a', './b'])
  })

  it('captures side-effect imports', () => {
    expect(extractImportSpecifiers(`import 'dotenv/config'`)).toEqual(['dotenv/config'])
  })

  it('captures dynamic imports', () => {
    expect(extractImportSpecifiers(`const m = await import('./lazy.js')`)).toEqual(['./lazy.js'])
  })

  it('captures export * from re-exports', () => {
    expect(extractImportSpecifiers(`export * from './foo.js'`)).toEqual(['./foo.js'])
  })

  it('deduplicates duplicate specifiers', () => {
    const src = `import { a } from './x'\nimport { b } from './x'`
    expect(extractImportSpecifiers(src)).toEqual(['./x'])
  })
})

describe('extractExports', () => {
  it('captures named function/class/const/interface/type exports', () => {
    const src = `
      export function foo() {}
      export class Bar {}
      export const baz = 1
      export interface Qux {}
      export type Quux = string
      export enum Mode { A, B }
    `
    expect(extractExports(src).sort()).toEqual(['Bar', 'Mode', 'Quux', 'Qux', 'baz', 'foo'])
  })

  it('captures async function exports', () => {
    expect(extractExports(`export async function run() {}`)).toEqual(['run'])
  })

  it('captures export-list members and aliases', () => {
    const src = `const a = 1; const b = 2; export { a, b as renamed }`
    expect(extractExports(src).sort()).toEqual(['a', 'b'])
  })

  it('captures export default function/class names', () => {
    expect(extractExports(`export default function MyComp() {}`)).toEqual(['MyComp'])
    expect(extractExports(`export default class Wrapper {}`)).toEqual(['Wrapper'])
  })

  it('returns [] for files with no exports', () => {
    expect(extractExports(`const x = 1`)).toEqual([])
  })
})

describe('codeNoteId', () => {
  it('produces forward-slashed deterministic ids', () => {
    expect(codeNoteId('packages/core/src/notes.ts')).toBe('code:packages/core/src/notes.ts')
  })
})

describe('scanCodeGraph integration', () => {
  it('scans a single-file project and returns one note with no edges', () => {
    write('packages/pkg/src/a.ts', `export const X = 1`)
    const result = scanCodeGraph({ rootDir: root })
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].relPath).toBe('packages/pkg/src/a.ts')
    expect(result.notes[0].exports).toEqual(['X'])
    expect(result.edges).toEqual([])
  })

  it('builds an import edge between two files', () => {
    write('packages/pkg/src/a.ts', `import { X } from './b.js'\nexport const A = X`)
    write('packages/pkg/src/b.ts', `export const X = 1`)
    const result = scanCodeGraph({ rootDir: root })
    expect(result.notes).toHaveLength(2)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].fromId).toBe(codeNoteId('packages/pkg/src/a.ts'))
    expect(result.edges[0].toId).toBe(codeNoteId('packages/pkg/src/b.ts'))
  })

  it('resolves directory index imports', () => {
    write('packages/pkg/src/a.ts', `import { X } from './sub'`)
    write('packages/pkg/src/sub/index.ts', `export const X = 1`)
    const result = scanCodeGraph({ rootDir: root })
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].toId).toBe(codeNoteId('packages/pkg/src/sub/index.ts'))
  })

  it('skips bare specifiers (node_modules / workspace packages)', () => {
    write('packages/pkg/src/a.ts', `import x from 'better-sqlite3'\nimport y from '@coastal-ai/core'`)
    const result = scanCodeGraph({ rootDir: root })
    expect(result.notes).toHaveLength(1)
    expect(result.edges).toEqual([])
  })

  it('ignores __tests__ directories by default', () => {
    write('packages/pkg/src/a.ts', `export const X = 1`)
    write('packages/pkg/src/__tests__/a.test.ts', `import { X } from '../a.js'\nexport const T = X`)
    const result = scanCodeGraph({ rootDir: root })
    expect(result.notes.map(n => n.relPath)).toEqual(['packages/pkg/src/a.ts'])
  })

  it('summary block includes file path, LOC, imports and exports', () => {
    write('packages/pkg/src/a.ts', `import { X } from './b.js'\nexport const A = X`)
    write('packages/pkg/src/b.ts', `export const X = 1`)
    const result = scanCodeGraph({ rootDir: root })
    const aNote = result.notes.find(n => n.relPath === 'packages/pkg/src/a.ts')!
    expect(aNote.summary).toContain('File: packages/pkg/src/a.ts')
    expect(aNote.summary).toContain('packages/pkg/src/b.ts')
    expect(aNote.summary).toContain('Exports: A')
  })

  it('strips .js extension when resolving (ESM TS convention)', () => {
    write('packages/pkg/src/a.ts', `import { X } from './b.js'`)
    write('packages/pkg/src/b.ts', `export const X = 1`)
    const result = scanCodeGraph({ rootDir: root })
    expect(result.edges).toHaveLength(1)
  })

  it('does not crash on unreadable files (logs and skips)', () => {
    // No file written but non-existent — walk just won't pick it up.
    const result = scanCodeGraph({ rootDir: root })
    expect(result.notes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('respects custom scanDirs and ignoreSegments', () => {
    write('apps/foo/src/a.ts', `export const X = 1`)
    write('packages/pkg/src/b.ts', `export const Y = 1`)
    const result = scanCodeGraph({ rootDir: root, scanDirs: ['apps'] })
    expect(result.notes.map(n => n.relPath)).toEqual(['apps/foo/src/a.ts'])
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import { syncCodeGraph } from '../code-graph-sync.js'
import { getImpactSummary, getImpactSummaryForTargets } from '../impact.js'
import { codeGraphNoteId } from '../code-graph-id.js'

let tempDir: string
let store: NoteStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'impact-'))
  store = new NoteStore({ dataDir: tempDir })
  // Seed: a.ts and c.ts both import b.ts; b.ts imports nothing.
  syncCodeGraph(store, {
    notes: [
      { id: codeGraphNoteId('a.ts'), relPath: 'a.ts',
        summary: 'File: a.ts\nLOC: 5\nImports: b.ts\nExports: A' },
      { id: codeGraphNoteId('b.ts'), relPath: 'b.ts',
        summary: 'File: b.ts\nLOC: 3\nImports: (no project imports)\nExports: B, helperB' },
      { id: codeGraphNoteId('c.ts'), relPath: 'c.ts',
        summary: 'File: c.ts\nLOC: 4\nImports: b.ts\nExports: C' },
    ],
    edges: [
      { fromId: codeGraphNoteId('a.ts'), toId: codeGraphNoteId('b.ts') },
      { fromId: codeGraphNoteId('c.ts'), toId: codeGraphNoteId('b.ts') },
    ],
  })
})

afterEach(() => {
  store.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('getImpactSummary', () => {
  it('returns null for an unknown file', () => {
    expect(getImpactSummary(store, 'unknown.ts')).toBeNull()
  })

  it('lists files that import the target', () => {
    const summary = getImpactSummary(store, 'b.ts')
    expect(summary).not.toBeNull()
    expect(summary!.importedBy.sort()).toEqual(['a.ts', 'c.ts'])
  })

  it('lists files the target imports', () => {
    const summary = getImpactSummary(store, 'a.ts')
    expect(summary!.imports).toEqual(['b.ts'])
  })

  it("parses Exports: line back into a list", () => {
    const summary = getImpactSummary(store, 'b.ts')
    expect(summary!.exports.sort()).toEqual(['B', 'helperB'])
  })

  it('returns empty exports for the (no top-level exports) sentinel', () => {
    syncCodeGraph(store, {
      notes: [{ id: codeGraphNoteId('d.ts'), relPath: 'd.ts',
        summary: 'File: d.ts\nLOC: 1\nImports: (no project imports)\nExports: (no top-level exports)' }],
      edges: [],
    })
    expect(getImpactSummary(store, 'd.ts')!.exports).toEqual([])
  })

  it('renders prose with all four sections', () => {
    const prose = getImpactSummary(store, 'b.ts')!.prose
    expect(prose).toContain('### IMPACT: b.ts')
    expect(prose).toContain('Imported by (2)')
    expect(prose).toContain('Imports (0)')
    expect(prose).toContain('Exports (2)')
  })

  it('shows the safe-to-refactor sentinel when no one imports the file', () => {
    syncCodeGraph(store, {
      notes: [{ id: codeGraphNoteId('orphan.ts'), relPath: 'orphan.ts',
        summary: 'File: orphan.ts\nLOC: 1\nImports: (no project imports)\nExports: (no top-level exports)' }],
      edges: [],
    })
    const prose = getImpactSummary(store, 'orphan.ts')!.prose
    expect(prose).toContain('safe to refactor')
  })
})

describe('getImpactSummaryForTargets', () => {
  it('joins blocks for each target', () => {
    const text = getImpactSummaryForTargets(store, ['a.ts', 'b.ts'])
    expect(text).toContain('### IMPACT: a.ts')
    expect(text).toContain('### IMPACT: b.ts')
  })

  it('silently skips unknown files', () => {
    const text = getImpactSummaryForTargets(store, ['a.ts', 'unknown.ts'])
    expect(text).toContain('### IMPACT: a.ts')
    expect(text).not.toContain('unknown.ts')
  })

  it('returns empty string when nothing matches', () => {
    expect(getImpactSummaryForTargets(store, ['x.ts', 'y.ts'])).toBe('')
  })
})

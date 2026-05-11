import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import { ingestMarkdown } from '../markdown-ingest.js'
import { syncMarkdownIngest } from '../markdown-sync.js'
import {
  packagesFromPaths, getDesignContext, getDesignContextForTargets,
} from '../design-context.js'

let dir: string
let store: NoteStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'design-ctx-'))
  store = new NoteStore({ dataDir: dir })
  syncMarkdownIngest(store, ingestMarkdown({
    relPath: 'packages/web/DESIGN.md',
    source: '# Web\n\n## Color Tokens\ncyan #00e5ff\n\n## Typography\nSpace Grotesk\n',
  }))
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('packagesFromPaths', () => {
  it('extracts distinct package names from project-relative paths', () => {
    expect(packagesFromPaths([
      'packages/web/src/index.tsx',
      'packages/web/src/App.tsx',
      'packages/core/src/server.ts',
    ])).toEqual(['core', 'web'])
  })

  it('ignores paths outside packages/', () => {
    expect(packagesFromPaths(['docs/handoff.md', 'README.md'])).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(packagesFromPaths([])).toEqual([])
  })
})

describe('getDesignContext', () => {
  it('returns null for a package without a DESIGN.md', () => {
    expect(getDesignContext(store, 'core')).toBeNull()
  })

  it('returns sections for a package that has a DESIGN.md', () => {
    const ctx = getDesignContext(store, 'web')
    expect(ctx).not.toBeNull()
    expect(ctx!.packageName).toBe('web')
    expect(ctx!.sections.map(s => s.title).sort()).toEqual(['Color Tokens', 'Typography'])
  })

  it('renders a labeled prose block with the file source path', () => {
    const ctx = getDesignContext(store, 'web')!
    expect(ctx.prose).toContain('### DESIGN (web — packages/web/DESIGN.md)')
    expect(ctx.prose).toContain('#### Color Tokens')
    expect(ctx.prose).toContain('cyan #00e5ff')
  })
})

describe('getDesignContextForTargets', () => {
  it('returns the right design block when a UI file is touched', () => {
    const text = getDesignContextForTargets(store, ['packages/web/src/App.tsx'])
    expect(text).toContain('### DESIGN (web')
    expect(text).toContain('Color Tokens')
  })

  it('returns empty string when no targeted package has design notes', () => {
    expect(getDesignContextForTargets(store, ['packages/core/src/server.ts'])).toBe('')
  })

  it('handles multiple packages, only emitting blocks where DESIGN.md exists', () => {
    syncMarkdownIngest(store, ingestMarkdown({
      relPath: 'packages/api/DESIGN.md',
      source: '# API\n\n## Routes\nfastify under /api/admin\n',
    }))
    const text = getDesignContextForTargets(store, [
      'packages/web/src/x.ts',
      'packages/api/src/y.ts',
      'packages/core/src/z.ts',
    ])
    expect(text).toContain('### DESIGN (api')
    expect(text).toContain('### DESIGN (web')
    expect(text).not.toContain('### DESIGN (core')
  })
})

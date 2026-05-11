// End-to-end test for the A2 chain:
//   architect ingestDesignDocs walks DESIGN.md files →
//   core syncMarkdownIngest stores them as 'design' notes →
//   core getDesignContextForTargets resolves prose for a UI work item →
//   planning prompt receives a DESIGN SYSTEM block.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { getDesignContextForTargets } from '@coastal-ai/core/memory/design-context'
import { ingestDesignDocs } from '../design-ingest.js'
import { runPlanningStage } from '../../stages/planning.js'

let projectRoot: string
let dbDir: string
let store: NoteStore

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'a2-proj-'))
  dbDir = mkdtempSync(join(tmpdir(), 'a2-db-'))
  store = new NoteStore({ dataDir: dbDir })
})

afterEach(() => {
  store.close()
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

function writeDesign(pkg: string, body: string) {
  mkdirSync(join(projectRoot, 'packages', pkg), { recursive: true })
  writeFileSync(join(projectRoot, 'packages', pkg, 'DESIGN.md'), body)
}

describe('A2 end-to-end: ingestDesignDocs → context → planner', () => {
  it('returns an empty summary when no DESIGN.md files exist', () => {
    mkdirSync(join(projectRoot, 'packages', 'web'), { recursive: true })
    const r = ingestDesignDocs(store, projectRoot)
    expect(r.files).toBe(0)
    expect(r.added).toBe(0)
  })

  it('discovers and ingests every packages/<name>/DESIGN.md', () => {
    writeDesign('web', '# Web\n\n## Color Tokens\ncyan #00e5ff\n\n## Typography\nSpace Grotesk\n')
    writeDesign('api', '# API\n\n## Routes\nfastify under /api/admin\n')
    const r = ingestDesignDocs(store, projectRoot)
    expect(r.files).toBe(2)
    expect(r.paths.sort()).toEqual(['packages/api/DESIGN.md', 'packages/web/DESIGN.md'])
    expect(store.bySource('markdown', 'packages/web/DESIGN.md')).toHaveLength(3) // file + 2 sections
    expect(store.bySource('markdown', 'packages/api/DESIGN.md')).toHaveLength(2) // file + 1 section
  })

  it('design context appears in the planner prompt for a UI work item', async () => {
    writeDesign('web', '# Web\n\n## Color Tokens\ncyan #00e5ff is the only blue\n')
    ingestDesignDocs(store, projectRoot)

    const designContext = getDesignContextForTargets(store, ['packages/web/src/App.tsx'])
    const callPlan = vi.fn().mockResolvedValue({
      text: `<plan>p</plan><diff>\`\`\`diff
--- a/packages/web/src/App.tsx
+++ b/packages/web/src/App.tsx
@@
+x
\`\`\`</diff>`,
      modelId: 'm',
    })

    await runPlanningStage({
      workItem: {
        id: 'w', title: 'restyle button', body: '',
        targetHints: ['packages/web/src/App.tsx'],
        budgetLoc: 100, allowSelfModify: false,
      } as any,
      reviseContext: null,
      readSourceFile: async () => '',
      client: { callPlan } as any,
      lockedPathCheck: () => null,
      designContext,
    })

    const promptArg = callPlan.mock.calls[0][0] as string
    expect(promptArg).toContain('DESIGN SYSTEM')
    expect(promptArg).toContain('### DESIGN (web — packages/web/DESIGN.md)')
    expect(promptArg).toContain('cyan #00e5ff is the only blue')
  })

  it("does NOT inject design context when the work item is in a package without a DESIGN.md", async () => {
    writeDesign('web', '# Web\n\n## Color Tokens\ncyan\n')
    ingestDesignDocs(store, projectRoot)

    const designContext = getDesignContextForTargets(store, ['packages/core/src/server.ts'])
    expect(designContext).toBe('')
  })

  it('a re-ingest after restructure prunes stale sections', () => {
    writeDesign('web', '# Web\n\n## A\na\n\n## B\nb\n\n## C\nc\n')
    ingestDesignDocs(store, projectRoot)
    expect(store.bySource('markdown', 'packages/web/DESIGN.md')).toHaveLength(4)

    // Remove section C from disk and re-ingest.
    writeDesign('web', '# Web\n\n## A\na\n\n## B\nb\n')
    const second = ingestDesignDocs(store, projectRoot)
    expect(second.removed).toBe(1)
    expect(store.bySource('markdown', 'packages/web/DESIGN.md').map(n => n.title).sort())
      .toEqual(['A', 'B', 'Web'])
  })
})

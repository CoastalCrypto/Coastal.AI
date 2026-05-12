// End-to-end test for the A1 chain:
//   architect scanner → core syncCodeGraph → core getImpactSummaryForTargets
// → planning prompt receives a populated impact block.
//
// Uses a temp project on disk so the regex scanner has real files to walk,
// and a temp obsidian.db so the NoteStore is isolated.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { syncCodeGraph } from '@coastal-ai/core/memory/code-graph-sync'
import { getImpactSummaryForTargets } from '@coastal-ai/core/memory/impact'
import { scanCodeGraph } from '../code-graph.js'
import { runPlanningStage } from '../../stages/planning.js'

let projectRoot: string
let dbDir: string
let store: NoteStore

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'a1-proj-'))
  dbDir = mkdtempSync(join(tmpdir(), 'a1-db-'))
  store = new NoteStore({ dataDir: dbDir })
  // Build a tiny project: foo/index.ts ← imported by ← bar/use.ts and baz/use.ts
  mkdirSync(join(projectRoot, 'packages/foo/src'), { recursive: true })
  mkdirSync(join(projectRoot, 'packages/bar/src'), { recursive: true })
  mkdirSync(join(projectRoot, 'packages/baz/src'), { recursive: true })
  writeFileSync(join(projectRoot, 'packages/foo/src/index.ts'), `export function foo() { return 1 }\n`)
  writeFileSync(
    join(projectRoot, 'packages/bar/src/use.ts'),
    `import { foo } from '../../foo/src/index.js'\nexport const used = foo()\n`,
  )
  writeFileSync(
    join(projectRoot, 'packages/baz/src/use.ts'),
    `import { foo } from '../../foo/src/index.js'\nexport const used = foo()\n`,
  )
})

afterEach(() => {
  store.close()
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

describe('A1 end-to-end: scan → sync → impact → planner prompt', () => {
  it('discovers two importers of foo/index.ts and surfaces them as impact radius', () => {
    const scan = scanCodeGraph({ rootDir: projectRoot })
    const result = syncCodeGraph(store, scan)
    expect(result.added).toBe(3)
    expect(result.edgesAdded).toBe(2)

    const summary = getImpactSummaryForTargets(store, ['packages/foo/src/index.ts'])
    expect(summary).toContain('### IMPACT: packages/foo/src/index.ts')
    expect(summary).toContain('Imported by (2)')
    expect(summary).toContain('packages/bar/src/use.ts')
    expect(summary).toContain('packages/baz/src/use.ts')
    expect(summary).toContain('Exports (1): foo')
  })

  it('feeds the impact block into the planning prompt', async () => {
    syncCodeGraph(store, scanCodeGraph({ rootDir: projectRoot }))
    const impactSummary = getImpactSummaryForTargets(store, ['packages/foo/src/index.ts'])

    const callPlan = vi.fn().mockResolvedValue({
      text: `<plan>p</plan><diff>\`\`\`diff
--- a/packages/foo/src/index.ts
+++ b/packages/foo/src/index.ts
@@
+x
\`\`\`</diff>`,
      modelId: 'm',
    })

    await runPlanningStage({
      workItem: {
        id: 'w', title: 'rework foo', body: '',
        targetHints: ['packages/foo/src/index.ts'],
        budgetLoc: 100, allowSelfModify: false,
      } as any,
      reviseContext: null,
      readSourceFile: async () => 'export function foo() { return 1 }',
      client: { callPlan } as any,
      lockedPathCheck: () => null,
      impactSummary,
    })

    const promptArg = callPlan.mock.calls[0][0] as string
    expect(promptArg).toContain('IMPACT RADIUS')
    expect(promptArg).toContain('packages/bar/src/use.ts')
    expect(promptArg).toContain('packages/baz/src/use.ts')
  })

  it('a re-scan after a file is removed prunes the corresponding impact entry', () => {
    syncCodeGraph(store, scanCodeGraph({ rootDir: projectRoot }))
    rmSync(join(projectRoot, 'packages/baz/src/use.ts'))
    const re = syncCodeGraph(store, scanCodeGraph({ rootDir: projectRoot }))
    expect(re.removed).toBe(1)
    const summary = getImpactSummaryForTargets(store, ['packages/foo/src/index.ts'])
    expect(summary).toContain('Imported by (1)')
    expect(summary).not.toContain('packages/baz/src/use.ts')
  })
})

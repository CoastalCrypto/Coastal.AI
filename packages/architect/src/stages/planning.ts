// packages/architect/src/stages/planning.ts
//
// Pure-function planning stage: given a work item and a model client, produce
// either an `ok` result (plan + diff + model used), a `soft_fail` (parse,
// locked, or budget — fixable by retrying or revising), or a `hard_fail`
// (env_llm — operator-side failure that should not consume an iteration).
//
// All I/O is injected via closures so the function can be tested without a
// filesystem or network. Step 0 research (2026-05-02) confirmed `WorkItem`
// already carries `allowSelfModify: boolean` and a non-nullable `budgetLoc:
// number`, so the plan body is used as-written without field substitutions.
import type { WorkItem } from '@coastal-ai/core/architect/types'
import { registerPrompt, getPrompt } from '@coastal-ai/core/prompts/registry'
import type { ArchitectModelRouterClient } from '../model-router-client.js'
import { plannerPromptV1 } from '../prompts/planner.v1.js'

// Register the planner prompt with the core registry on module load.
// idempotent — registry refuses duplicate (id, version) but accepts the
// SAME definition object so re-imports during HMR / tests don't blow up.
registerPrompt(plannerPromptV1)

export interface PlanningInput {
  workItem: WorkItem
  reviseContext: { reason?: string; comment?: string; testOutput?: string; prComments?: string } | null
  readSourceFile: (relPath: string) => Promise<string>
  client: ArchitectModelRouterClient
  lockedPathCheck: (path: string) => string | null
  /**
   * Optional impact-radius prose for the targeted files. Comes from the
   * code-graph notes layer; a daemon callsite resolves it once per cycle
   * via getImpactSummaryForTargets(memory.notes, workItem.targetHints).
   * When absent, the planner runs exactly as before (backward compatible).
   */
  impactSummary?: string | null
  /**
   * Optional design-system prose surfaced when target files live under a
   * package that has its own DESIGN.md. The daemon resolves this via
   * getDesignContextForTargets(noteStore, workItem.targetHints). Empty
   * string → block omitted.
   */
  designContext?: string | null
}

export type PlanningResult =
  | { kind: 'ok'; plan: string; diff: string; modelUsed: string }
  | { kind: 'soft_fail'; failureKind: 'parse' | 'locked' | 'budget'; message: string; modelUsed?: string }
  | { kind: 'hard_fail'; failureKind: 'env_llm'; message: string }

const PLAN_RE = /<plan>([\s\S]*?)<\/plan>/i
const DIFF_RE = /<diff>\s*```diff\r?\n([\s\S]*?)```\s*<\/diff>/i

export async function runPlanningStage(input: PlanningInput): Promise<PlanningResult> {
  const { workItem, reviseContext, readSourceFile, client, lockedPathCheck, impactSummary, designContext } = input

  const sourceSnippets: string[] = []
  for (const hint of workItem.targetHints ?? []) {
    try {
      const content = await readSourceFile(hint)
      sourceSnippets.push(`### ${hint}\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\``)
    } catch { /* missing file → planner sees gap */ }
  }

  const reviseBlock = reviseContext
    ? `\n\nPRIOR ATTEMPT FEEDBACK\n${JSON.stringify(reviseContext, null, 2).slice(0, 2000)}\n`
    : ''

  const impactBlock = impactSummary && impactSummary.trim().length > 0
    ? `\n\nIMPACT RADIUS (from code-graph notes — keep blast surface in mind)\n${impactSummary.slice(0, 4000)}\n`
    : ''

  // Cap design context generously — it can be longer than impact prose
  // because it includes section bodies, but we still need a bound so a
  // huge DESIGN.md can't blow the prompt budget.
  const designBlock = designContext && designContext.trim().length > 0
    ? `\n\nDESIGN SYSTEM (respect existing tokens + idioms — do not introduce new ones)\n${designContext.slice(0, 8000)}\n`
    : ''

  const planner = getPrompt<import('../prompts/planner.v1.js').PlannerPromptVars>('planner', 1)
  const prompt = planner.render({
    title: workItem.title,
    body: workItem.body,
    targetHints: (workItem.targetHints ?? []).join(', ') || '(none)',
    acceptance: workItem.acceptance ?? '(none)',
    budgetLoc: workItem.budgetLoc,
    sources: sourceSnippets.join('\n\n') || '(none provided)',
    reviseBlock: reviseBlock + impactBlock + designBlock,
  })

  let text: string
  let modelUsed: string
  try {
    const r = await client.callPlan(prompt)
    text = r.text
    modelUsed = r.modelId
  } catch (err: any) {
    return { kind: 'hard_fail', failureKind: 'env_llm', message: err.message }
  }

  const planMatch = text.match(PLAN_RE)
  const diffMatch = text.match(DIFF_RE)
  if (!diffMatch) {
    return { kind: 'soft_fail', failureKind: 'parse', message: 'no <diff>```diff block found in response', modelUsed }
  }
  const plan = planMatch ? planMatch[1].trim() : ''
  const diff = diffMatch[1].trim()

  const touched = extractTouchedPaths(diff)
  for (const p of touched) {
    const locked = lockedPathCheck(p)
    if (locked && !workItem.allowSelfModify) {
      return { kind: 'soft_fail', failureKind: 'locked', message: locked, modelUsed }
    }
  }

  const addedLines = countAddedLines(diff)
  if (addedLines > workItem.budgetLoc) {
    return {
      kind: 'soft_fail', failureKind: 'budget',
      message: `diff added ${addedLines} lines, budget_loc=${workItem.budgetLoc}`,
      modelUsed,
    }
  }

  return { kind: 'ok', plan, diff, modelUsed }
}

function extractTouchedPaths(diff: string): string[] {
  const paths = new Set<string>()
  for (const m of diff.matchAll(/^[-+]{3}\s+([ab]\/)?(\S+)/gm)) {
    paths.add(m[2])
  }
  paths.delete('/dev/null')
  return [...paths]
}

function countAddedLines(diff: string): number {
  let n = 0
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+') && !line.startsWith('+++')) n++
  }
  return n
}

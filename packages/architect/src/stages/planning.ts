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
import type { ArchitectModelRouterClient } from '../model-router-client.js'

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
}

export type PlanningResult =
  | { kind: 'ok'; plan: string; diff: string; modelUsed: string }
  | { kind: 'soft_fail'; failureKind: 'parse' | 'locked' | 'budget'; message: string; modelUsed?: string }
  | { kind: 'hard_fail'; failureKind: 'env_llm'; message: string }

const PLAN_RE = /<plan>([\s\S]*?)<\/plan>/i
const DIFF_RE = /<diff>\s*```diff\r?\n([\s\S]*?)```\s*<\/diff>/i

export async function runPlanningStage(input: PlanningInput): Promise<PlanningResult> {
  const { workItem, reviseContext, readSourceFile, client, lockedPathCheck, impactSummary } = input

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

  const prompt = buildPlannerPrompt(workItem, sourceSnippets.join('\n\n'), reviseBlock + impactBlock)

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

function buildPlannerPrompt(item: WorkItem, sources: string, reviseBlock: string): string {
  return `You are the Coastal.AI Architect. Produce one plan and one unified-diff change for this work item.

WORK ITEM
Title: ${item.title}
Body: ${item.body}
Target hints: ${(item.targetHints ?? []).join(', ') || '(none)'}
Acceptance: ${item.acceptance ?? '(none)'}
Budget: ${item.budgetLoc} added lines max

SOURCE FILES
${sources || '(none provided)'}
${reviseBlock}
INSTRUCTIONS
- Output exactly: <plan>...</plan><diff>\`\`\`diff
  ...unified diff...
\`\`\`</diff>
- Plan: 2-5 sentences, prose, what you'll change and why.
- Diff: standard unified format, may touch multiple files.
- Keep added LOC under the budget.
- Do not modify unrelated code.
`
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

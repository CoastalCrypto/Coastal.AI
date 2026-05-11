// packages/architect/src/prompts/planner.v1.ts
//
// Versioned planner prompt template. Identical wording to the inline
// `buildPlannerPrompt` that lived in stages/planning.ts before A3 — the
// extraction is purely structural so eval history can pin to a stable
// (id, version) and the registry can enumerate prompts.
//
// Bump the version when you change wording, structure, or required vars
// in a way that meaningfully alters LLM behavior. Cosmetic comment edits
// or whitespace inside `expectedVars` don't count.

import type { PromptDefinition } from '@coastal-ai/core/prompts/registry'

export interface PlannerPromptVars {
  title: string
  body: string
  targetHints: string
  acceptance: string
  budgetLoc: number
  sources: string
  reviseBlock: string
}

export const plannerPromptV1: PromptDefinition<PlannerPromptVars> = {
  id: 'planner',
  version: 1,
  description: 'Coastal.AI architect planning prompt — produces <plan> + <diff>',
  expectedVars: [
    'title', 'body', 'targetHints', 'acceptance', 'budgetLoc',
    'sources', 'reviseBlock',
  ],
  render: (v) => `You are the Coastal.AI Architect. Produce one plan and one unified-diff change for this work item.

WORK ITEM
Title: ${v.title}
Body: ${v.body}
Target hints: ${v.targetHints}
Acceptance: ${v.acceptance}
Budget: ${v.budgetLoc} added lines max

SOURCE FILES
${v.sources}
${v.reviseBlock}
INSTRUCTIONS
- Output exactly: <plan>...</plan><diff>\`\`\`diff
  ...unified diff...
\`\`\`</diff>
- Plan: 2-5 sentences, prose, what you'll change and why.
- Diff: standard unified format, may touch multiple files.
- Keep added LOC under the budget.
- Do not modify unrelated code.
`,
}

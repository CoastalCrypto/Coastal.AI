// packages/architect/src/prompts/planner.fixtures.ts
//
// Eval fixtures for the planner prompt. Each fixture is a (vars,
// assertions) pair: render planner.v1 with these vars, ask the LLM,
// and the response must satisfy every assertion to pass.
//
// Keep fixtures TIGHT: structural / format-correctness assertions only.
// Behavioral evals (LLM-as-judge) are a separate variant we'll add when
// we actually start judging the *quality* of plans, not just whether
// they parse. The gate today catches "LLM stopped emitting <diff>"
// regressions, which is what most prompt drift looks like.

import type { Fixture } from '@coastal-ai/core/prompts/eval-runner'
import type { PlannerPromptVars } from './planner.v1.js'

const baseVars: PlannerPromptVars = {
  title: 'Add a hello() function to the greeting module',
  body: 'We need a tiny self-contained function `hello(name)` that returns "Hello, NAME!".',
  targetHints: 'src/greeting.ts',
  acceptance: 'A new exported `hello` function exists and returns the greeting string.',
  budgetLoc: 30,
  sources: '### src/greeting.ts\n```\n// (file does not yet exist)\n```',
  reviseBlock: '',
}

export const PLANNER_FIXTURES: readonly Fixture<PlannerPromptVars>[] = [
  {
    id: 'happy-path-emits-plan-and-diff',
    label: 'Happy path emits both <plan> and <diff>',
    vars: baseVars,
    assertions: [
      { kind: 'contains', value: '<plan>' },
      { kind: 'contains', value: '</plan>' },
      { kind: 'matches', pattern: '<diff>\\s*```diff', flags: 's' },
      { kind: 'matches', pattern: '```\\s*</diff>', flags: 's' },
      { kind: 'minLength', value: 60 },
    ],
  },
  {
    id: 'diff-touches-target-hint',
    label: 'Diff references the targeted file path',
    vars: baseVars,
    assertions: [
      { kind: 'contains', value: 'src/greeting.ts' },
      { kind: 'matches', pattern: '^[+-]{3}\\s+(?:[ab]/)?src/greeting\\.ts', flags: 'm' },
    ],
  },
  {
    id: 'no-explanatory-prose-after-diff',
    label: 'No trailing prose after </diff>',
    vars: baseVars,
    assertions: [
      // Allow whitespace, ban any non-trivial trailing content.
      { kind: 'matches', pattern: '</diff>\\s*$', flags: 's' },
    ],
  },
] as const

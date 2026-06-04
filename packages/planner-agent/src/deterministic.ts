// packages/planner-agent/src/deterministic.ts
//
// The deterministic decomposer. No LLM required — produces a fixed
// two-step plan for any goal:
//
//   step "code"   — kind='code_task'   (no deps)
//   step "review" — kind='review_task' (must_complete from "code")
//
// This is the simplest meaningful workflow that exercises the
// dependency graph machinery. Real-world workflows will use the
// LLM-backed decomposer; the deterministic one is the fallback for
// when no model client is configured AND the baseline for tests.

import type { Plan, PlanTaskPayload } from './types.js'

export function deterministicDecompose(input: PlanTaskPayload): Plan {
  return {
    goal: input.goal,
    steps: [
      {
        ref: 'code',
        kind: 'code_task',
        payload: {
          request: input.goal,
          language: input.language,
        },
      },
      {
        ref: 'review',
        kind: 'review_task',
        payload: {
          request: `Review the code produced for: ${input.goal}`,
        },
        dependsOn: ['code'],
      },
    ],
  }
}

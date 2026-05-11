// packages/architect/src/learnings/run-evals.ts
//
// Wires the architect's existing model client to the core eval runner
// for a specific prompt's fixtures. Persists each result as an eval note
// so the gate (and the canvas) sees them.
//
// Default LLM = ArchitectModelRouterClient.callPlan, since the planner
// prompt is what we're evaluating today. When future prompts get their
// own fixtures, this module will gain sibling runners (one per prompt).

import type { NoteStore } from '@coastal-ai/core/memory/notes'
import type { PromptDefinition } from '@coastal-ai/core/prompts/registry'
import {
  runEvalSuite, type Fixture, type LLM,
} from '@coastal-ai/core/prompts/eval-runner'
import { writeEvalResultsAsNotes, type PersistedEvalRef } from '@coastal-ai/core/prompts/eval-notes'

export interface RunPromptEvalsInput<V> {
  prompt: PromptDefinition<V>
  fixtures: readonly Fixture<V>[]
  llm: LLM
  store: NoteStore
  /** Optional model id to record on each eval note. */
  model?: string | null
}

export interface RunPromptEvalsResult {
  passed: number
  failed: number
  refs: PersistedEvalRef[]
}

export async function runPromptEvals<V>(
  input: RunPromptEvalsInput<V>,
): Promise<RunPromptEvalsResult> {
  const results = await runEvalSuite(input.prompt, input.fixtures, input.llm, { model: input.model ?? null })
  const refs = writeEvalResultsAsNotes(input.store, results)
  return {
    passed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    refs,
  }
}

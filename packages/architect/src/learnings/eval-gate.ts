// packages/architect/src/learnings/eval-gate.ts
//
// Pure gate: reads the latest eval verdicts for a (prompt, version) from
// the notes layer and returns a {ok, output} record matching the shape
// of the other building gates (lint/type/build/test).
//
// Policy:
//   - All recorded fixtures pass → ok=true
//   - Any recorded fixture fails → ok=false (with a list of failing fixtures)
//   - No verdicts at all       → ok=true with output='no eval history'
//     (don't block on missing data — surface a "stale" message instead;
//      the daemon can prompt the user to run evals if they care)
//
// The runner that actually executes evals lives in run-evals.ts; this
// module only reads.

import type { NoteStore } from '@coastal-ai/core/memory/notes'
import { latestEvalVerdicts } from '@coastal-ai/core/prompts/eval-notes'

export interface EvalGateOutput {
  ok: boolean
  output: string
  /** Number of fixtures whose latest verdict was a fail. */
  failed: number
  /** Total fixtures with a recorded verdict. */
  total: number
}

export function runEvalGate(
  store: NoteStore,
  promptId: string,
  version: number,
): EvalGateOutput {
  const verdicts = latestEvalVerdicts(store, promptId, version)
  if (verdicts.length === 0) {
    return {
      ok: true,
      output: `eval gate: no eval history for ${promptId}@${version} — skipping (run evals to populate)`,
      failed: 0,
      total: 0,
    }
  }
  const failed = verdicts.filter(v => !v.ok)
  if (failed.length === 0) {
    return {
      ok: true,
      output: `eval gate: ${verdicts.length}/${verdicts.length} fixtures passing for ${promptId}@${version}`,
      failed: 0,
      total: verdicts.length,
    }
  }
  const list = failed.map(v => `  - ${v.fixtureId} (last ran ${new Date(v.ranAt).toISOString()})`).join('\n')
  return {
    ok: false,
    output: `eval gate: ${failed.length}/${verdicts.length} fixtures FAILING for ${promptId}@${version}\n${list}`,
    failed: failed.length,
    total: verdicts.length,
  }
}

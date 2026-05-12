// Integration test: planner.v1 prompt + planner.fixtures + mock LLM →
// eval results persisted as notes → eval gate reads them and produces
// the right verdict.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { runPromptEvals } from '../run-evals.js'
import { runEvalGate } from '../eval-gate.js'
import { plannerPromptV1 } from '../../prompts/planner.v1.js'
import { PLANNER_FIXTURES } from '../../prompts/planner.fixtures.js'

let dir: string
let store: NoteStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'run-evals-'))
  store = new NoteStore({ dataDir: dir })
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const WELL_FORMED_RESPONSE = `<plan>
Add a hello() function that returns the greeting string.
</plan>
<diff>
\`\`\`diff
--- a/src/greeting.ts
+++ b/src/greeting.ts
@@
+export function hello(name: string): string { return \`Hello, \${name}!\` }
\`\`\`
</diff>`

describe('runPromptEvals + planner fixtures', () => {
  it('all fixtures pass when the LLM emits a well-formed response', async () => {
    const summary = await runPromptEvals({
      prompt: plannerPromptV1,
      fixtures: PLANNER_FIXTURES,
      llm: async () => WELL_FORMED_RESPONSE,
      store,
    })
    expect(summary.passed).toBe(PLANNER_FIXTURES.length)
    expect(summary.failed).toBe(0)
    expect(store.list({ kind: 'eval' })).toHaveLength(PLANNER_FIXTURES.length)
  })

  it('some fixtures fail when the LLM returns prose instead of the contract', async () => {
    const summary = await runPromptEvals({
      prompt: plannerPromptV1,
      fixtures: PLANNER_FIXTURES,
      llm: async () => 'Sure! Here is what I would do…',
      store,
    })
    expect(summary.failed).toBeGreaterThan(0)
  })

  it('end-to-end: failing eval round → eval gate fails the build', async () => {
    await runPromptEvals({
      prompt: plannerPromptV1,
      fixtures: PLANNER_FIXTURES,
      llm: async () => 'no diff here', // breaks structural assertions
      store,
    })
    const verdict = runEvalGate(store, plannerPromptV1.id, plannerPromptV1.version)
    expect(verdict.ok).toBe(false)
    expect(verdict.failed).toBeGreaterThan(0)
  })

  it('end-to-end: passing eval round → gate ok', async () => {
    await runPromptEvals({
      prompt: plannerPromptV1,
      fixtures: PLANNER_FIXTURES,
      llm: async () => WELL_FORMED_RESPONSE,
      store,
    })
    expect(runEvalGate(store, plannerPromptV1.id, plannerPromptV1.version).ok).toBe(true)
  })

  it('records the model id on every produced eval note', async () => {
    await runPromptEvals({
      prompt: plannerPromptV1,
      fixtures: PLANNER_FIXTURES,
      llm: async () => WELL_FORMED_RESPONSE,
      store,
      model: 'ollama:llama3.2',
    })
    const notes = store.list({ kind: 'eval' })
    expect(notes.every(n => n.body.includes('ollama:llama3.2'))).toBe(true)
  })
})

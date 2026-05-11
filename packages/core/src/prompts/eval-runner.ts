// packages/core/src/prompts/eval-runner.ts
//
// Tiny deterministic evaluator. Given a prompt + a fixture (variables to
// render with) + an LLM function + a list of assertions, runs the LLM
// once and produces a pass/fail score per assertion plus an overall verdict.
//
// Intentionally LLM-agnostic: the caller supplies any function with the
// signature `(prompt: string) => Promise<string>`. The architect daemon
// will pass its existing modelClient.callPlan; tests pass a mock that
// returns canned strings; a future promptfoo adapter can wrap a
// promptfoo CLI subprocess into the same shape.
//
// Assertions are intentionally simple — regex / contains / length — to
// keep the gate deterministic. Behavioral evals (LLM-as-judge) can ship
// later as a separate assertion variant; the result shape is stable.

import type { PromptDefinition, PromptVariables } from './registry.js'

export type LLM = (prompt: string) => Promise<string>

export type Assertion =
  | { kind: 'contains'; value: string; not?: boolean; reason?: string }
  | { kind: 'matches';  pattern: string; flags?: string; not?: boolean; reason?: string }
  | { kind: 'minLength'; value: number; reason?: string }
  | { kind: 'maxLength'; value: number; reason?: string }

export interface Fixture<V = PromptVariables> {
  /** Stable id per prompt — used as the eval-note sourceId suffix. */
  id: string
  /** Human label shown in eval reports. */
  label: string
  /** Variables to render the prompt with. */
  vars: V
  /** Assertions that the LLM response must satisfy. All must pass for an OK. */
  assertions: readonly Assertion[]
}

export interface AssertionResult {
  assertion: Assertion
  passed: boolean
  /** Filled in when failed; describes what went wrong. */
  detail?: string
}

export interface EvalResult {
  /** (id, version) of the prompt that was evaluated. */
  promptId: string
  promptVersion: number
  /** Fixture id that produced this result. */
  fixtureId: string
  /** Mirrors fixture.label for human-readable reports. */
  fixtureLabel: string
  /** True iff every assertion passed. */
  ok: boolean
  /** Per-assertion pass/fail with detail on misses. */
  assertions: AssertionResult[]
  /** Truncated raw LLM response for the eval note body. */
  responsePreview: string
  /** Full response length pre-truncation. */
  responseLength: number
  /** ISO timestamp when this eval ran. */
  ranAt: number
  /** Wall-clock duration of the LLM call in ms. */
  durationMs: number
  /** Optional model identifier returned by the LLM caller. */
  model?: string | null
}

const RESPONSE_PREVIEW_CHARS = 800

export interface RunEvalOptions {
  /** Optional model id to record in the result, when the caller knows it. */
  model?: string | null
}

export async function runEval<V>(
  prompt: PromptDefinition<V>,
  fixture: Fixture<V>,
  llm: LLM,
  opts: RunEvalOptions = {},
): Promise<EvalResult> {
  const rendered = prompt.render(fixture.vars)
  const start = Date.now()
  let response = ''
  let llmError: Error | null = null
  try {
    response = await llm(rendered)
  } catch (err) {
    llmError = err instanceof Error ? err : new Error(String(err))
  }
  const durationMs = Date.now() - start

  // If the LLM blew up, every assertion fails with the LLM error noted.
  // We still return a result rather than throwing — the caller (gate /
  // notes writer) wants a record of the failure, not an unhandled reject.
  const assertions: AssertionResult[] = llmError
    ? fixture.assertions.map(a => ({
        assertion: a, passed: false,
        detail: `LLM call failed before assertions could run: ${llmError!.message}`,
      }))
    : fixture.assertions.map(a => evaluateAssertion(a, response))

  return {
    promptId: prompt.id,
    promptVersion: prompt.version,
    fixtureId: fixture.id,
    fixtureLabel: fixture.label,
    ok: assertions.every(a => a.passed),
    assertions,
    responsePreview: response.slice(0, RESPONSE_PREVIEW_CHARS),
    responseLength: response.length,
    ranAt: Date.now(),
    durationMs,
    model: opts.model ?? null,
  }
}

export async function runEvalSuite<V>(
  prompt: PromptDefinition<V>,
  fixtures: readonly Fixture<V>[],
  llm: LLM,
  opts: RunEvalOptions = {},
): Promise<EvalResult[]> {
  const results: EvalResult[] = []
  for (const f of fixtures) {
    results.push(await runEval(prompt, f, llm, opts))
  }
  return results
}

// ---------------------------------------------------------------------------
// Assertion engine
// ---------------------------------------------------------------------------

function evaluateAssertion(a: Assertion, response: string): AssertionResult {
  switch (a.kind) {
    case 'contains': {
      const hit = response.includes(a.value)
      const passed = a.not ? !hit : hit
      return passed
        ? { assertion: a, passed: true }
        : { assertion: a, passed: false,
            detail: a.not
              ? `expected response NOT to contain "${a.value}" but it did`
              : `expected response to contain "${a.value}"` }
    }
    case 'matches': {
      let re: RegExp
      try { re = new RegExp(a.pattern, a.flags) }
      catch (err) {
        return { assertion: a, passed: false,
          detail: `invalid regex /${a.pattern}/${a.flags ?? ''}: ${(err as Error).message}` }
      }
      const hit = re.test(response)
      const passed = a.not ? !hit : hit
      return passed
        ? { assertion: a, passed: true }
        : { assertion: a, passed: false,
            detail: a.not
              ? `expected response NOT to match /${a.pattern}/${a.flags ?? ''}`
              : `expected response to match /${a.pattern}/${a.flags ?? ''}` }
    }
    case 'minLength':
      return response.length >= a.value
        ? { assertion: a, passed: true }
        : { assertion: a, passed: false,
            detail: `response length ${response.length} < min ${a.value}` }
    case 'maxLength':
      return response.length <= a.value
        ? { assertion: a, passed: true }
        : { assertion: a, passed: false,
            detail: `response length ${response.length} > max ${a.value}` }
  }
}

/**
 * Render an EvalResult as a markdown block suitable for a note body. Used
 * by eval-notes.ts when persisting to the store, but exported here so any
 * other consumer (CLI, future REST report) can use the same format.
 */
export function renderEvalResultMarkdown(result: EvalResult): string {
  const head = [
    `# ${result.promptId}@${result.promptVersion} · ${result.fixtureLabel}`,
    '',
    `- **Result:** ${result.ok ? 'PASS ✓' : 'FAIL ✗'}`,
    `- **Fixture:** \`${result.fixtureId}\``,
    `- **Ran at:** ${new Date(result.ranAt).toISOString()}`,
    `- **Duration:** ${result.durationMs}ms`,
    `- **Model:** ${result.model ?? '(unknown)'}`,
    `- **Response length:** ${result.responseLength} chars`,
    '',
    '## Assertions',
  ]
  const rows = result.assertions.map(a => {
    const tick = a.passed ? '✓' : '✗'
    const desc = describeAssertion(a.assertion)
    return a.passed ? `- ${tick} ${desc}` : `- ${tick} ${desc} — ${a.detail}`
  })
  const body = [
    '',
    '## Response (preview)',
    '```',
    result.responsePreview || '(empty)',
    '```',
  ]
  return [...head, ...rows, ...body].join('\n')
}

function describeAssertion(a: Assertion): string {
  switch (a.kind) {
    case 'contains':  return `contains${a.not ? ' NOT' : ''} "${a.value}"`
    case 'matches':   return `matches${a.not ? ' NOT' : ''} /${a.pattern}/${a.flags ?? ''}`
    case 'minLength': return `length >= ${a.value}`
    case 'maxLength': return `length <= ${a.value}`
  }
}

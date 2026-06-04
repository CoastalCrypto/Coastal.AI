// packages/planner-agent/src/llm-decompose.ts
//
// LLM-backed plan decomposer. Asks the model to emit a structured
// JSON plan; the parser is defensive — invalid JSON, missing fields,
// or unknown task kinds fall back to the deterministic plan.

import type { LlmClient } from '@coastal-ai/llm-client'
import type { Plan, PlanStep, PlanTaskPayload } from './types.js'
import { deterministicDecompose } from './deterministic.js'

export interface LlmDecomposerConfig {
  client: LlmClient
  model: string
  /** Task kinds the planner is allowed to emit. Default: code_task, review_task. */
  allowedKinds?: ReadonlySet<string>
  /** Temperature for the planning call. Default 0.3. */
  temperature?: number
}

const DEFAULT_KINDS = new Set(['code_task', 'review_task'])

const PLANNER_SYSTEM_PROMPT = `You are a planning assistant. Given a goal, output a JSON plan that decomposes it into ordered, dependency-aware subtasks.

Output ONLY valid JSON in this exact shape — no commentary, no markdown fences:

{
  "steps": [
    {
      "ref": "string-unique-id",
      "kind": "code_task" | "review_task",
      "payload": { "request": "natural-language description" },
      "dependsOn": ["other-step-ref", ...]
    }
  ]
}

Rules:
- Every step must have a unique ref.
- Use code_task for anything that produces code.
- Use review_task for anything that evaluates code.
- A review_task should always depend on the code_task it reviews.
- Keep plans small — 1 to 5 steps maximum.
- Prefer fewer steps when the goal is simple.`

export function createLlmDecomposer(config: LlmDecomposerConfig) {
  const {
    client, model,
    allowedKinds = DEFAULT_KINDS,
    temperature = 0.3,
  } = config

  return async function decompose(input: PlanTaskPayload): Promise<Plan> {
    try {
      const res = await client.chat({
        model,
        temperature,
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: `Goal: ${input.goal}` },
        ],
      })
      const plan = parsePlan(res.message.content, input, allowedKinds)
      if (plan) return plan
    } catch {
      // Model unreachable, timeout, or auth — fall through to fallback.
    }
    return deterministicDecompose(input)
  }
}

function parsePlan(
  raw: string,
  input: PlanTaskPayload,
  allowedKinds: ReadonlySet<string>,
): Plan | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    // Try to extract JSON from a code fence if the model misbehaved
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (!fenced) return null
    try { parsed = JSON.parse(fenced[1].trim()) } catch { return null }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const stepsRaw = (parsed as { steps?: unknown }).steps
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) return null

  const steps: PlanStep[] = []
  const seenRefs = new Set<string>()
  for (const raw of stepsRaw) {
    if (!raw || typeof raw !== 'object') continue
    const candidate = raw as Record<string, unknown>
    const ref = typeof candidate.ref === 'string' ? candidate.ref : null
    const kind = typeof candidate.kind === 'string' ? candidate.kind : null
    if (!ref || !kind) continue
    if (seenRefs.has(ref)) continue
    if (!allowedKinds.has(kind)) continue

    const payload = (candidate.payload && typeof candidate.payload === 'object')
      ? candidate.payload
      : { request: input.goal }

    const dependsOn = Array.isArray(candidate.dependsOn)
      ? candidate.dependsOn.filter((d): d is string => typeof d === 'string')
      : undefined

    seenRefs.add(ref)
    steps.push({ ref, kind, payload, dependsOn })
  }

  if (steps.length === 0) return null
  // Validate dependency closure — drop dangling refs
  for (const step of steps) {
    if (!step.dependsOn) continue
    step.dependsOn = step.dependsOn.filter(d => seenRefs.has(d))
    if (step.dependsOn.length === 0) delete step.dependsOn
  }
  return { goal: input.goal, steps }
}

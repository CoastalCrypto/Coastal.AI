import type { ModelRouter } from '../models/router.js'

export interface CommitmentVerdict {
  satisfied: boolean
  note: string
}

const VERIFY_PROMPT = (expectation: string, reply: string) => `
You are checking whether a teammate's reply addresses what was specifically asked of them.

Expectation: ${expectation}

Reply: ${reply}

Respond ONLY with valid JSON in this exact format: {"satisfied": true, "note": "one short sentence why"}
No other text.
`.trim()

/**
 * Cheap LLM-as-judge check. Fails open toward `satisfied: false` — an
 * unreadable verdict must surface as unresolved, never be treated as quietly
 * satisfied. This is the direct fix for CooperBench's finding that agent
 * messages went unverified and got silently dropped.
 */
export async function verifyCommitment(
  router: Pick<ModelRouter, 'chat'>,
  model: string,
  expectation: string,
  reply: string,
): Promise<CommitmentVerdict> {
  try {
    const { reply: raw } = await router.chat(
      [{ role: 'user', content: VERIFY_PROMPT(expectation, reply) }],
      { model },
    )
    const parsed = JSON.parse(raw.trim()) as { satisfied?: unknown; note?: unknown }
    if (typeof parsed.satisfied !== 'boolean') {
      return { satisfied: false, note: 'verification unavailable' }
    }
    return { satisfied: parsed.satisfied, note: typeof parsed.note === 'string' ? parsed.note : '' }
  } catch {
    return { satisfied: false, note: 'verification unavailable' }
  }
}

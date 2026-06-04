// packages/reviewing-agent/src/worker.ts

import type { LlmClient, ChatMessage } from '@coastal-ai/llm-client'
import { LlmClientError } from '@coastal-ai/llm-client'
import type { ReviewTaskPayload, ReviewTaskResult, ReviewVerdict } from './types.js'

export interface ReviewerWorkerConfig {
  client: LlmClient
  defaultModel: string
  systemPrompt?: string
  /** Temperature. Default 0.1 (reviewers should be focused, not creative). */
  temperature?: number
  maxTokens?: number
}

const DEFAULT_SYSTEM_PROMPT = `You are a senior code reviewer. Review the code below and respond in this strict format:

VERDICT: <approve|request_changes|reject>
SUMMARY: <one-line summary>
ISSUES:
- <issue 1, or "none">

Be honest. Approve when the code is correct, idiomatic, and handles errors at boundaries. Request changes for missing error handling, unclear naming, dead code, or style problems. Reject only for fundamentally wrong implementations.`

export function createReviewerWorker(config: ReviewerWorkerConfig) {
  const {
    client, defaultModel,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    temperature = 0.1,
    maxTokens = 1024,
  } = config

  return async function reviewerWorker(task: { payload: unknown }): Promise<ReviewTaskResult> {
    const payload = task.payload as ReviewTaskPayload
    if (!payload || typeof payload.request !== 'string') {
      throw new LlmClientError(
        'invalid_request',
        'reviewer worker: task.payload.request must be a string',
      )
    }
    const messages = buildMessages(systemPrompt, payload)
    const model = payload.model ?? defaultModel
    const res = await client.chat({
      model, messages, temperature, maxTokens,
    })
    const parsed = parseReviewResponse(res.message.content)
    return {
      ...parsed,
      modelUsed: res.modelUsed ?? model,
      finishReason: res.finishReason,
      usage: res.usage,
    }
  }
}

function buildMessages(systemPrompt: string, payload: ReviewTaskPayload): ChatMessage[] {
  const userParts: string[] = []
  userParts.push(`Review request: ${payload.request.trim()}`)
  if (payload.language) {
    userParts.push(`Language: ${payload.language}`)
  }
  if (payload.code) {
    userParts.push('')
    userParts.push('Code:')
    userParts.push('```')
    userParts.push(payload.code)
    userParts.push('```')
  }
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userParts.join('\n') },
  ]
}

/**
 * Defensive parser — pulls VERDICT / SUMMARY / ISSUES out of a free-form
 * model response. If the model went rogue and didn't follow the format,
 * we default to 'request_changes' with the raw text as summary (better
 * than failing the task outright).
 */
export function parseReviewResponse(raw: string): {
  verdict: ReviewVerdict
  summary: string
  issues?: string[]
} {
  const text = raw.trim()
  const verdictMatch = text.match(/VERDICT:\s*(approve|request_changes|reject)/i)
  const summaryMatch = text.match(/SUMMARY:\s*(.+?)(\n|$)/i)
  const issuesIndex = text.search(/ISSUES:/i)
  const issuesBlock = issuesIndex >= 0 ? text.slice(issuesIndex + 7) : ''
  const issues = issuesBlock
    ? issuesBlock.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-') || l.startsWith('*'))
        .map(l => l.replace(/^[-*]\s*/, '').trim())
        .filter(l => l && l.toLowerCase() !== 'none')
    : []

  return {
    verdict: (verdictMatch ? verdictMatch[1].toLowerCase() : 'request_changes') as ReviewVerdict,
    summary: summaryMatch ? summaryMatch[1].trim() : text.slice(0, 200),
    issues: issues.length > 0 ? issues : undefined,
  }
}

/** Claim policy companion. Matches Task.kind === 'review_task'. */
export function reviewerShouldClaim(task: { kind: string }): boolean {
  return task.kind === 'review_task'
}

// packages/coding-agent/src/worker.ts
//
// The coder's worker function. Takes an LlmClient + a Task, returns
// the generated code. Pure function modulo the LlmClient — easy to
// unit-test with a stub.

import type { LlmClient, ChatMessage } from '@coastal-ai/llm-client'
import { LlmClientError } from '@coastal-ai/llm-client'
import type { CodeTaskPayload, CodeTaskResult } from './types.js'

export interface CoderWorkerConfig {
  client: LlmClient
  /** Default model when the task's payload doesn't override. */
  defaultModel: string
  /**
   * Optional system prompt override. Defaults to a code-focused
   * prompt that asks for clean, well-named output.
   */
  systemPrompt?: string
  /** Temperature. Default 0.2 (low — code generation should be focused). */
  temperature?: number
  /** Max tokens to generate. Default 2048. */
  maxTokens?: number
}

const DEFAULT_SYSTEM_PROMPT = `You are a senior software engineer. Generate code that is correct, readable, and idiomatic for the requested language. Use clear identifiers; prefer composition over inheritance; handle errors at boundaries. Output ONLY the requested code — no commentary, no markdown fences, unless the user explicitly asks otherwise.`

/**
 * Build a Task → Result worker function suitable for plugging into a
 * CoordinationDaemon. The returned function captures the LlmClient
 * and config; the daemon calls it with each claimed Task.
 *
 * Throws LlmClientError on network/auth/server failures — the
 * daemon's failure path will requeue with retry, per Hermes Tenacity
 * pattern.
 */
export function createCoderWorker(config: CoderWorkerConfig) {
  const {
    client,
    defaultModel,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    temperature = 0.2,
    maxTokens = 2048,
  } = config

  return async function coderWorker(task: { payload: unknown }): Promise<CodeTaskResult> {
    const payload = task.payload as CodeTaskPayload
    if (!payload || typeof payload.request !== 'string') {
      throw new LlmClientError(
        'invalid_request',
        'coder worker: task.payload.request must be a string',
      )
    }
    const messages = buildMessages(systemPrompt, payload)
    const model = payload.model ?? defaultModel
    const res = await client.chat({
      model,
      messages,
      temperature,
      maxTokens,
    })
    return {
      output: res.message.content,
      modelUsed: res.modelUsed ?? model,
      finishReason: res.finishReason,
      usage: res.usage,
    }
  }
}

function buildMessages(systemPrompt: string, payload: CodeTaskPayload): ChatMessage[] {
  const out: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ]
  const userParts: string[] = []
  if (payload.language) {
    userParts.push(`Target language: ${payload.language}`)
    userParts.push('')
  }
  userParts.push(payload.request.trim())
  if (payload.context?.notes?.length) {
    userParts.push('')
    userParts.push('Notes:')
    for (const note of payload.context.notes) {
      userParts.push(`- ${note}`)
    }
  }
  if (payload.context?.files?.length) {
    userParts.push('')
    userParts.push('Relevant files:')
    for (const file of payload.context.files) {
      userParts.push('')
      userParts.push(`# ${file.path}`)
      userParts.push('```')
      userParts.push(file.content)
      userParts.push('```')
    }
  }
  out.push({ role: 'user', content: userParts.join('\n') })
  return out
}

/**
 * The claim policy companion to coderWorker. Matches Task.kind ===
 * 'code_task'. Wire into CoordinationDaemon's shouldClaim config.
 */
export function coderShouldClaim(task: { kind: string }): boolean {
  return task.kind === 'code_task'
}

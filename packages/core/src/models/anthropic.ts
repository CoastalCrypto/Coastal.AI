// packages/core/src/models/anthropic.ts
//
// Native client for Anthropic's Messages API. README has advertised
// "Claude / Gemini / OpenAI work with an API key" since before this file
// existed — Gemini and OpenAI hold up (both speak an OpenAI-compatible
// endpoint, handled by openai-compat.ts), but there was no Anthropic
// adapter anywhere in the repo, so naming Claude specifically was false.
// This is the fix: a real adapter implementing the same InferenceClient
// every other backend here does, so ModelRouter can route to it like any
// other candidate once an API key is configured.
//
// Wire-format translation (system prompt placement, tool_use/tool_result
// content blocks) lives in anthropic-translate.ts, tested in isolation —
// this file is the HTTP transport and streaming parser around it.

import type { InferenceClient } from './openai-compat.js'
import type { LocalChatMessage } from './ollama.js'
import type { ChatMessage, OllamaToolSchema } from '../agents/session.js'
import type { ToolCall } from '../agents/types.js'
import { toAnthropicMessages, toAnthropicTools, fromAnthropicResponse, type AnthropicResponseBody } from './anthropic-translate.js'

export interface AnthropicConfig {
  apiKey: string
  baseUrl?: string
  /** Anthropic's API version header. Default '2023-06-01'. */
  apiVersion?: string
}

// Anthropic requires max_tokens on every request — there's no "unbounded"
// option the way Ollama/OpenAI-compatible servers default to. 4096 matches
// soulMaxTokens' ballpark elsewhere in config.ts without needing a new
// per-call override surface InferenceClient doesn't have.
const DEFAULT_MAX_TOKENS = 4096

export class AnthropicClient implements InferenceClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly apiVersion: string

  constructor(config: AnthropicConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.apiVersion = config.apiVersion ?? '2023-06-01'
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': this.apiVersion,
    }
  }

  async chat(model: string, messages: LocalChatMessage[]): Promise<string> {
    const { system, messages: anthropicMessages } = toAnthropicMessages(messages as ChatMessage[])
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, system, messages: anthropicMessages, max_tokens: DEFAULT_MAX_TOKENS, stream: false }),
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`)
    const body = await res.json() as AnthropicResponseBody
    return fromAnthropicResponse(body).content
  }

  async *chatStream(model: string, messages: LocalChatMessage[]): AsyncGenerator<string> {
    const { system, messages: anthropicMessages } = toAnthropicMessages(messages as ChatMessage[])
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, system, messages: anthropicMessages, max_tokens: DEFAULT_MAX_TOKENS, stream: true }),
      signal: AbortSignal.timeout(300_000),
    })
    if (!res.ok) throw new Error(`Anthropic stream error ${res.status}: ${await res.text()}`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        try {
          const event = JSON.parse(payload) as { type: string; delta?: { type: string; text?: string } }
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
            yield event.delta.text
          }
        } catch { /* skip malformed SSE lines */ }
      }
    }
  }

  async chatWithTools(
    model: string,
    messages: ChatMessage[],
    tools: OllamaToolSchema[],
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
    const { system, messages: anthropicMessages } = toAnthropicMessages(messages)
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model, system, messages: anthropicMessages, max_tokens: DEFAULT_MAX_TOKENS,
        tools: tools.length ? toAnthropicTools(tools) : undefined,
        stream: false,
      }),
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`)
    const body = await res.json() as AnthropicResponseBody
    return fromAnthropicResponse(body)
  }
}

/**
 * Anthropic model IDs all start with "claude-" (claude-opus-4-5,
 * claude-sonnet-4-5, claude-haiku-4-5, and every dated predecessor) — a
 * stable enough convention to route on without a separate per-agent
 * "which backend" config field.
 */
export function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-')
}

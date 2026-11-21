// packages/core/src/models/anthropic-translate.ts
//
// Pure translation between Coastal's internal ChatMessage[]/ToolCall shape
// (agents/session.ts, agents/types.ts — the same shape every other
// InferenceClient in this directory speaks) and Anthropic's Messages API
// wire format (https://docs.anthropic.com/en/api/messages). Kept separate
// from anthropic.ts's HTTP transport so the mapping itself — the part most
// likely to have an edge case wrong — is testable without a network stub.
//
// The three shape differences that matter here:
//   1. System prompt is a top-level `system` string, not a role:'system'
//      message mixed into the array.
//   2. Assistant tool calls are `tool_use` content blocks *inside* the
//      assistant message's content array, not a sibling `tool_calls` field.
//   3. Tool results are `tool_result` content blocks inside a role:'user'
//      message. Critically, when an assistant turn made N parallel tool
//      calls, all N results belong in ONE user message's content array —
//      not N separate user messages. AgenticLoop pushes one role:'tool'
//      ChatMessage per call (loop.ts's executeOne), so toAnthropicMessages
//      coalesces consecutive role:'tool' messages into a single turn.

import type { ChatMessage, OllamaToolSchema } from '../agents/session.js'
import type { ToolCall } from '../agents/types.js'

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicTool {
  name: string
  description: string
  input_schema: unknown
}

/**
 * Not yet translated: `images` on a ChatMessage. Anthropic supports image
 * content blocks, but no caller in this codebase sends vision input
 * through chatWithTools today (images only ever reach OllamaClient.chat —
 * see agents/loop.ts), so there's nothing exercising that path to get
 * right. Flagged here rather than silently dropped without a trace: if a
 * ChatMessage with `images` ever reaches this function, the images are
 * dropped and only the text content is sent.
 */
export function toAnthropicMessages(messages: ChatMessage[]): { system?: string; messages: AnthropicMessage[] } {
  const systemParts: string[] = []
  const out: AnthropicMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content)
      continue
    }

    if (msg.role === 'tool') {
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id ?? '',
        content: msg.content,
      }
      // Coalesce with the immediately preceding user turn if it's also
      // tool results — this is what groups N parallel tool_calls' results
      // into the single user message Anthropic expects for one turn.
      const prev = out[out.length - 1]
      if (prev && prev.role === 'user' && Array.isArray(prev.content) && prev.content.every(b => b.type === 'tool_result')) {
        prev.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }

    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const blocks: AnthropicContentBlock[] = []
      if (msg.content) blocks.push({ type: 'text', text: msg.content })
      for (const tc of msg.tool_calls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id ?? '',
          name: tc.function.name,
          input: tc.function.arguments,
        })
      }
      out.push({ role: 'assistant', content: blocks })
      continue
    }

    // Plain user or assistant message, no tool involvement.
    out.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content })
  }

  return { system: systemParts.length ? systemParts.join('\n\n') : undefined, messages: out }
}

export function toAnthropicTools(tools: OllamaToolSchema[]): AnthropicTool[] {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }))
}

export interface AnthropicResponseBody {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >
  stop_reason: string | null
}

/** Inverse of the assistant-message half of toAnthropicMessages. */
export function fromAnthropicResponse(body: AnthropicResponseBody): { content: string; toolCalls: ToolCall[] } {
  let content = ''
  const toolCalls: ToolCall[] = []
  for (const block of body.content) {
    if (block.type === 'text') {
      content += block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, args: block.input })
    }
  }
  return { content, toolCalls }
}

import { describe, it, expect } from 'vitest'
import { toAnthropicMessages, toAnthropicTools, fromAnthropicResponse } from '../anthropic-translate.js'
import type { ChatMessage, OllamaToolSchema } from '../../agents/session.js'

describe('toAnthropicMessages', () => {
  it('pulls role:system messages out into the top-level system string', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'hi' },
    ]
    const result = toAnthropicMessages(msgs)
    expect(result.system).toBe('You are a helpful assistant.')
    expect(result.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('joins multiple system messages with a blank line, in order', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'First.' },
      { role: 'system', content: 'Second.' },
      { role: 'user', content: 'hi' },
    ]
    expect(toAnthropicMessages(msgs).system).toBe('First.\n\nSecond.')
  })

  it('omits system entirely when there are no system messages', () => {
    const result = toAnthropicMessages([{ role: 'user', content: 'hi' }])
    expect(result.system).toBeUndefined()
  })

  it('passes plain user/assistant messages through as plain strings', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    expect(toAnthropicMessages(msgs).messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('turns an assistant tool_calls message into text + tool_use blocks', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant',
        content: "I'll check that for you.",
        tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: { path: 'a.txt' } } }],
      },
    ]
    expect(toAnthropicMessages(msgs).messages).toEqual([{
      role: 'assistant',
      content: [
        { type: 'text', text: "I'll check that for you." },
        { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a.txt' } },
      ],
    }])
  })

  it('omits the leading text block when the assistant tool-call message has no content', () => {
    const msgs: ChatMessage[] = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', function: { name: 'f', arguments: {} } }] },
    ]
    const result = toAnthropicMessages(msgs).messages[0]
    expect(result.content).toEqual([{ type: 'tool_use', id: 'call_1', name: 'f', input: {} }])
  })

  it('turns a single role:tool message into a user message with one tool_result block', () => {
    const msgs: ChatMessage[] = [{ role: 'tool', tool_call_id: 'call_1', content: 'file contents here' }]
    expect(toAnthropicMessages(msgs).messages).toEqual([{
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file contents here' }],
    }])
  })

  it('coalesces consecutive role:tool messages (parallel tool calls) into ONE user message', () => {
    // This is the case AgenticLoop actually produces for parallel reads —
    // loop.ts pushes one role:'tool' ChatMessage per call in a for-loop,
    // not one combined message. Anthropic expects all results from one
    // assistant turn's parallel tool_use blocks in a single user turn.
    const msgs: ChatMessage[] = [
      { role: 'tool', tool_call_id: 'call_1', content: 'result A' },
      { role: 'tool', tool_call_id: 'call_2', content: 'result B' },
      { role: 'tool', tool_call_id: 'call_3', content: 'result C' },
    ]
    const result = toAnthropicMessages(msgs).messages
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    expect(result[0].content).toEqual([
      { type: 'tool_result', tool_use_id: 'call_1', content: 'result A' },
      { type: 'tool_result', tool_use_id: 'call_2', content: 'result B' },
      { type: 'tool_result', tool_use_id: 'call_3', content: 'result C' },
    ])
  })

  it('does NOT coalesce tool results across an intervening non-tool message', () => {
    const msgs: ChatMessage[] = [
      { role: 'tool', tool_call_id: 'call_1', content: 'result A' },
      { role: 'assistant', content: 'okay, now what' },
      { role: 'tool', tool_call_id: 'call_2', content: 'result B' },
    ]
    const result = toAnthropicMessages(msgs).messages
    expect(result).toHaveLength(3)
    expect(result[0].content).toEqual([{ type: 'tool_result', tool_use_id: 'call_1', content: 'result A' }])
    expect(result[2].content).toEqual([{ type: 'tool_result', tool_use_id: 'call_2', content: 'result B' }])
  })

  it('handles a full realistic turn: system, user, assistant tool call, parallel tool results, final assistant reply', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'What is in a.txt and b.txt?' },
      {
        role: 'assistant', content: '',
        tool_calls: [
          { id: 'call_1', function: { name: 'read_file', arguments: { path: 'a.txt' } } },
          { id: 'call_2', function: { name: 'read_file', arguments: { path: 'b.txt' } } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'contents of a' },
      { role: 'tool', tool_call_id: 'call_2', content: 'contents of b' },
      { role: 'assistant', content: 'a.txt has "contents of a"; b.txt has "contents of b".' },
    ]
    const result = toAnthropicMessages(msgs)
    expect(result.system).toBe('Be concise.')
    expect(result.messages).toHaveLength(4)
    expect(result.messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'call_1', content: 'contents of a' },
      { type: 'tool_result', tool_use_id: 'call_2', content: 'contents of b' },
    ])
  })
})

describe('toAnthropicTools', () => {
  it('maps OllamaToolSchema to Anthropic tool shape', () => {
    const tools: OllamaToolSchema[] = [{
      type: 'function',
      function: { name: 'read_file', description: 'Reads a file', parameters: { type: 'object', properties: {} } },
    }]
    expect(toAnthropicTools(tools)).toEqual([{
      name: 'read_file', description: 'Reads a file', input_schema: { type: 'object', properties: {} },
    }])
  })
})

describe('fromAnthropicResponse', () => {
  it('extracts plain text with no tool calls', () => {
    const result = fromAnthropicResponse({ content: [{ type: 'text', text: 'hello there' }], stop_reason: 'end_turn' })
    expect(result).toEqual({ content: 'hello there', toolCalls: [] })
  })

  it('extracts tool_use blocks as ToolCalls, concatenating any text blocks', () => {
    const result = fromAnthropicResponse({
      content: [
        { type: 'text', text: "I'll look that up." },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.txt' } },
      ],
      stop_reason: 'tool_use',
    })
    expect(result).toEqual({
      content: "I'll look that up.",
      toolCalls: [{ id: 'toolu_1', name: 'read_file', args: { path: 'a.txt' } }],
    })
  })

  it('handles multiple parallel tool_use blocks in one response', () => {
    const result = fromAnthropicResponse({
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.txt' } },
        { type: 'tool_use', id: 'toolu_2', name: 'read_file', input: { path: 'b.txt' } },
      ],
      stop_reason: 'tool_use',
    })
    expect(result.toolCalls).toHaveLength(2)
    expect(result.toolCalls.map(tc => tc.id)).toEqual(['toolu_1', 'toolu_2'])
  })
})

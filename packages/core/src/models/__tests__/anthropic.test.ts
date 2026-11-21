import { describe, it, expect, vi } from 'vitest'
import { AnthropicClient, isAnthropicModel } from '../anthropic.js'

describe('isAnthropicModel', () => {
  it('recognizes claude- prefixed model IDs', () => {
    expect(isAnthropicModel('claude-opus-4-5')).toBe(true)
    expect(isAnthropicModel('claude-sonnet-4-5')).toBe(true)
    expect(isAnthropicModel('claude-haiku-4-5-20251001')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isAnthropicModel('llama3.2')).toBe(false)
    expect(isAnthropicModel('gpt-4o')).toBe(false)
    expect(isAnthropicModel('qwen2.5:0.5b')).toBe(false)
  })
})

describe('AnthropicClient', () => {
  it('chat sends x-api-key, anthropic-version, and a system/messages split body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'hello from claude' }], stop_reason: 'end_turn' }),
    }))
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' })
    const result = await client.chat('claude-sonnet-4-5', [
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'hi' },
    ])
    expect(result).toBe('hello from claude')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test')
    expect((init!.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(init!.body as string)
    expect(body.system).toBe('Be terse.')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.max_tokens).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })

  it('chat throws with the response body on a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'invalid x-api-key',
    }))
    const client = new AnthropicClient({ apiKey: 'bad-key' })
    await expect(client.chat('claude-sonnet-4-5', [{ role: 'user', content: 'hi' }]))
      .rejects.toThrow(/Anthropic error 401.*invalid x-api-key/)
    vi.unstubAllGlobals()
  })

  it('chatWithTools sends tools in Anthropic shape and parses tool_use blocks back into ToolCalls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: "I'll check." },
          { type: 'tool_use', id: 'toolu_01', name: 'read_file', input: { path: 'a.txt' } },
        ],
        stop_reason: 'tool_use',
      }),
    }))
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' })
    const result = await client.chatWithTools(
      'claude-sonnet-4-5',
      [{ role: 'user', content: 'what is in a.txt?' }],
      [{ type: 'function', function: { name: 'read_file', description: 'reads a file', parameters: { type: 'object', properties: {} } } }],
    )
    expect(result.content).toBe("I'll check.")
    expect(result.toolCalls).toEqual([{ id: 'toolu_01', name: 'read_file', args: { path: 'a.txt' } }])

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.tools).toEqual([{ name: 'read_file', description: 'reads a file', input_schema: { type: 'object', properties: {} } }])
    vi.unstubAllGlobals()
  })

  it('chatWithTools omits the tools field entirely when there are no tools', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
    }))
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' })
    await client.chatWithTools('claude-sonnet-4-5', [{ role: 'user', content: 'hi' }], [])
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.tools).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('chatStream yields only text_delta chunks from the SSE stream', async () => {
    const sseBody = [
      'data: {"type":"message_start"}',
      '',
      'data: {"type":"content_block_start"}',
      '',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}',
      '',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}',
      '',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          const encoder = new TextEncoder()
          const chunks = [encoder.encode(sseBody)]
          let i = 0
          return {
            read: async () => {
              if (i < chunks.length) return { done: false, value: chunks[i++] }
              return { done: true, value: undefined }
            },
          }
        },
      },
    }))

    const client = new AnthropicClient({ apiKey: 'sk-ant-test' })
    const chunks: string[] = []
    for await (const chunk of client.chatStream('claude-sonnet-4-5', [{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['Hel', 'lo'])
    vi.unstubAllGlobals()
  })

  it('respects a custom baseUrl and apiVersion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
    }))
    const client = new AnthropicClient({ apiKey: 'k', baseUrl: 'https://proxy.internal/', apiVersion: '2024-01-01' })
    await client.chat('claude-sonnet-4-5', [{ role: 'user', content: 'hi' }])
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://proxy.internal/v1/messages')
    expect((init!.headers as Record<string, string>)['anthropic-version']).toBe('2024-01-01')
    vi.unstubAllGlobals()
  })
})

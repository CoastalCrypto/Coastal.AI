// packages/llm-client/src/__tests__/openai-compatible.test.ts

import { describe, it, expect } from 'vitest'
import {
  createOpenAICompatibleClient,
  LlmClientError,
} from '../index.js'

// ─── stub fetch helpers ─────────────────────────────────────────────

function fetchOk(body: object): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch
}

function fetchStatus(status: number, text = ''): typeof fetch {
  return (async () => new Response(text, { status })) as unknown as typeof fetch
}

function fetchHangs(): typeof fetch {
  return ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      reject(e)
    })
  })) as unknown as typeof fetch
}

function fetchSseStream(chunks: string[]): typeof fetch {
  return (async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
    return new Response(stream, { status: 200 })
  }) as unknown as typeof fetch
}

// ─── tests ──────────────────────────────────────────────────────────

describe('createOpenAICompatibleClient.chat', () => {
  it('decodes a typical OpenAI response', async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://test.local',
      fetch: fetchOk({
        id: 'chatcmpl-1',
        model: 'gpt-4o-mini',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello, world!' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
        },
      }),
    })
    const res = await client.chat({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hi' }],
    })
    expect(res.message.content).toBe('Hello, world!')
    expect(res.finishReason).toBe('stop')
    expect(res.usage).toEqual({
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    })
    expect(res.modelUsed).toBe('gpt-4o-mini')
  })

  it('decodes a llama.cpp-style response (no usage field)', async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://test.local',
      fetch: fetchOk({
        id: 'cmpl-x',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
      }),
    })
    const res = await client.chat({
      model: 'qwen2.5-coder',
      messages: [{ role: 'user', content: 'test' }],
    })
    expect(res.message.content).toBe('ok')
    expect(res.usage).toBeUndefined()
  })

  it('throws LlmClientError with kind=rate_limit on 429', async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://test.local',
      fetch: fetchStatus(429, 'rate limited'),
    })
    await expect(client.chat({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toMatchObject({ kind: 'rate_limit', status: 429 })
  })

  it('throws LlmClientError with kind=auth on 401', async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://test.local',
      apiKey: 'bad-key',
      fetch: fetchStatus(401, 'unauthorized'),
    })
    await expect(client.chat({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toMatchObject({ kind: 'auth' })
  })

  it('throws LlmClientError with kind=server_error on 500', async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://test.local',
      fetch: fetchStatus(500, 'internal'),
    })
    await expect(client.chat({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toMatchObject({ kind: 'server_error' })
  })

  it('throws LlmClientError with kind=timeout when fetch hangs', async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://test.local',
      timeoutMs: 50,
      fetch: fetchHangs(),
    })
    await expect(client.chat({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('refuses chat() when stream:true', async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://test.local',
      fetch: fetchOk({ choices: [] }),
    })
    await expect(client.chat({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })).rejects.toMatchObject({ kind: 'invalid_request' })
  })

  it('strips trailing slash from baseUrl', async () => {
    let calledUrl: string | null = null
    const stub = (async (url: string) => {
      calledUrl = url
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }), { status: 200 })
    }) as unknown as typeof fetch
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://host:8080/',
      fetch: stub,
    })
    await client.chat({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
    expect(calledUrl).toBe('http://host:8080/v1/chat/completions')
  })

  it('sets Authorization header when apiKey is provided', async () => {
    let calledHeaders: Headers | null = null
    const stub = (async (_url: string, init?: RequestInit) => {
      calledHeaders = new Headers(init?.headers)
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }), { status: 200 })
    }) as unknown as typeof fetch
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://host',
      apiKey: 'sk-test',
      fetch: stub,
    })
    await client.chat({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
    expect(calledHeaders?.get('authorization')).toBe('Bearer sk-test')
  })
})

describe('createOpenAICompatibleClient.chatStream', () => {
  it('yields decoded chunks from SSE frames', async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://test.local',
      fetch: fetchSseStream([
        'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    })
    const collected: string[] = []
    let finishReason: string | undefined
    for await (const chunk of client.chatStream({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })) {
      collected.push(chunk.delta)
      if (chunk.finishReason) finishReason = chunk.finishReason
    }
    expect(collected.join('')).toBe('Hello!')
    expect(finishReason).toBe('stop')
  })

  it('refuses chatStream() when stream:false', async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: 'http://test.local',
      fetch: fetchOk({}),
    })
    await expect(async () => {
      const iter = client.chatStream({
        model: 'x',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      })
      for await (const _chunk of iter) { /* unreachable */ }
    }).rejects.toMatchObject({ kind: 'invalid_request' })
  })
})

describe('LlmClientError', () => {
  it('carries kind, message, status, cause', () => {
    const cause = new Error('underlying')
    const err = new LlmClientError('network', 'connection failed', cause)
    expect(err.kind).toBe('network')
    expect(err.message).toBe('connection failed')
    expect(err.cause).toBe(cause)
  })
})

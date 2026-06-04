// packages/coding-agent/src/__tests__/worker.test.ts

import { describe, it, expect } from 'vitest'
import type {
  LlmClient, ChatRequest, ChatResponse, ChatStreamChunk,
} from '@coastal-ai/llm-client'
import { LlmClientError } from '@coastal-ai/llm-client'
import {
  createCoderWorker, coderShouldClaim, CODE_TASK_KIND,
} from '../index.js'
import type { CodeTaskPayload } from '../types.js'

class StubClient implements LlmClient {
  public lastReq: ChatRequest | null = null
  constructor(private respond: (req: ChatRequest) => ChatResponse) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.lastReq = req
    return this.respond(req)
  }
  chatStream(_req: ChatRequest): AsyncIterable<ChatStreamChunk> {
    throw new Error('not used')
  }
}

describe('coderShouldClaim', () => {
  it('matches code_task', () => {
    expect(coderShouldClaim({ kind: CODE_TASK_KIND })).toBe(true)
    expect(coderShouldClaim({ kind: 'code_task' })).toBe(true)
  })
  it('rejects other kinds', () => {
    expect(coderShouldClaim({ kind: 'review' })).toBe(false)
    expect(coderShouldClaim({ kind: 'curator_report' })).toBe(false)
  })
})

describe('createCoderWorker', () => {
  it('calls the LLM with system + user messages and returns CodeTaskResult', async () => {
    const stub = new StubClient(() => ({
      message: { role: 'assistant', content: 'const x = 1' },
      finishReason: 'stop',
      modelUsed: 'qwen2.5-coder-7b',
      usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
    }))
    const worker = createCoderWorker({
      client: stub, defaultModel: 'qwen2.5-coder-7b',
    })
    const result = await worker({
      payload: { request: 'a TypeScript constant' } satisfies CodeTaskPayload,
    })
    expect(result.output).toBe('const x = 1')
    expect(result.modelUsed).toBe('qwen2.5-coder-7b')
    expect(result.finishReason).toBe('stop')
    expect(result.usage?.totalTokens).toBe(25)
    expect(stub.lastReq?.messages).toHaveLength(2)
    expect(stub.lastReq?.messages[0].role).toBe('system')
    expect(stub.lastReq?.messages[1].role).toBe('user')
  })

  it('passes language hint through to the prompt', async () => {
    const stub = new StubClient(() => ({
      message: { role: 'assistant', content: 'fn main() {}' },
      finishReason: 'stop',
    }))
    const worker = createCoderWorker({ client: stub, defaultModel: 'x' })
    await worker({
      payload: { request: 'hello world', language: 'rust' } satisfies CodeTaskPayload,
    })
    const userMsg = stub.lastReq?.messages[1].content ?? ''
    expect(userMsg).toContain('Target language: rust')
    expect(userMsg).toContain('hello world')
  })

  it('embeds context files in the user message', async () => {
    const stub = new StubClient(() => ({
      message: { role: 'assistant', content: 'output' },
      finishReason: 'stop',
    }))
    const worker = createCoderWorker({ client: stub, defaultModel: 'x' })
    await worker({
      payload: {
        request: 'refactor this',
        context: {
          files: [{ path: 'src/foo.ts', content: 'export const x = 1' }],
          notes: ['Keep the public API stable'],
        },
      } satisfies CodeTaskPayload,
    })
    const userMsg = stub.lastReq?.messages[1].content ?? ''
    expect(userMsg).toContain('src/foo.ts')
    expect(userMsg).toContain('export const x = 1')
    expect(userMsg).toContain('Keep the public API stable')
  })

  it('uses the payload model when supplied, otherwise defaultModel', async () => {
    const stub = new StubClient(() => ({
      message: { role: 'assistant', content: 'ok' },
      finishReason: 'stop',
    }))
    const worker = createCoderWorker({ client: stub, defaultModel: 'default-model' })

    await worker({
      payload: { request: 'a' } satisfies CodeTaskPayload,
    })
    expect(stub.lastReq?.model).toBe('default-model')

    await worker({
      payload: { request: 'b', model: 'override-model' } satisfies CodeTaskPayload,
    })
    expect(stub.lastReq?.model).toBe('override-model')
  })

  it('respects custom temperature / maxTokens / systemPrompt config', async () => {
    const stub = new StubClient(() => ({
      message: { role: 'assistant', content: 'ok' },
      finishReason: 'stop',
    }))
    const worker = createCoderWorker({
      client: stub,
      defaultModel: 'x',
      temperature: 0.9,
      maxTokens: 100,
      systemPrompt: 'custom system',
    })
    await worker({
      payload: { request: 'hi' } satisfies CodeTaskPayload,
    })
    expect(stub.lastReq?.temperature).toBe(0.9)
    expect(stub.lastReq?.maxTokens).toBe(100)
    expect(stub.lastReq?.messages[0].content).toBe('custom system')
  })

  it('rejects payload without a request string', async () => {
    const stub = new StubClient(() => ({
      message: { role: 'assistant', content: 'ok' },
      finishReason: 'stop',
    }))
    const worker = createCoderWorker({ client: stub, defaultModel: 'x' })
    await expect(worker({ payload: {} as unknown })).rejects.toBeInstanceOf(LlmClientError)
    await expect(worker({ payload: { request: 42 } as unknown }))
      .rejects.toMatchObject({ kind: 'invalid_request' })
  })

  it('lets LLM errors propagate (daemon will catch and requeue)', async () => {
    const stub = new StubClient(() => {
      throw new LlmClientError('rate_limit', 'simulated', undefined, 429)
    })
    const worker = createCoderWorker({ client: stub, defaultModel: 'x' })
    await expect(worker({
      payload: { request: 'a' } satisfies CodeTaskPayload,
    })).rejects.toMatchObject({ kind: 'rate_limit', status: 429 })
  })
})

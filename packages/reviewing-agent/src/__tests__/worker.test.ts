// packages/reviewing-agent/src/__tests__/worker.test.ts

import { describe, it, expect } from 'vitest'
import type {
  LlmClient, ChatRequest, ChatResponse, ChatStreamChunk,
} from '@coastal-ai/llm-client'
import { LlmClientError } from '@coastal-ai/llm-client'
import {
  createReviewerWorker, reviewerShouldClaim, parseReviewResponse,
  REVIEW_TASK_KIND,
} from '../index.js'
import type { ReviewTaskPayload } from '../types.js'

class StubClient implements LlmClient {
  public lastReq: ChatRequest | null = null
  constructor(private respondWith: (req: ChatRequest) => ChatResponse) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.lastReq = req
    return this.respondWith(req)
  }
  chatStream(_req: ChatRequest): AsyncIterable<ChatStreamChunk> {
    throw new Error('not used')
  }
}

describe('reviewerShouldClaim', () => {
  it('matches review_task', () => {
    expect(reviewerShouldClaim({ kind: REVIEW_TASK_KIND })).toBe(true)
    expect(reviewerShouldClaim({ kind: 'review_task' })).toBe(true)
  })
  it('rejects other kinds', () => {
    expect(reviewerShouldClaim({ kind: 'code_task' })).toBe(false)
    expect(reviewerShouldClaim({ kind: 'plan_task' })).toBe(false)
  })
})

describe('parseReviewResponse', () => {
  it('parses a well-formed response', () => {
    const parsed = parseReviewResponse(`
VERDICT: approve
SUMMARY: Looks good, ships idiomatic error handling.
ISSUES:
- none
`)
    expect(parsed.verdict).toBe('approve')
    expect(parsed.summary).toContain('Looks good')
    expect(parsed.issues).toBeUndefined()
  })

  it('parses issues', () => {
    const parsed = parseReviewResponse(`
VERDICT: request_changes
SUMMARY: A few issues found.
ISSUES:
- Missing error handling on line 12
- Variable name 'x' is unclear
- No tests
`)
    expect(parsed.verdict).toBe('request_changes')
    expect(parsed.issues).toHaveLength(3)
    expect(parsed.issues?.[0]).toContain('Missing error handling')
  })

  it('handles missing format gracefully', () => {
    const parsed = parseReviewResponse('this is unstructured')
    expect(parsed.verdict).toBe('request_changes') // safe default
    expect(parsed.summary).toBe('this is unstructured')
  })

  it('is case-insensitive for VERDICT', () => {
    const parsed = parseReviewResponse('verdict: REJECT\nsummary: nope')
    expect(parsed.verdict).toBe('reject')
  })
})

describe('createReviewerWorker', () => {
  it('calls the LLM and parses the response into ReviewTaskResult', async () => {
    const stub = new StubClient(() => ({
      message: {
        role: 'assistant',
        content: `VERDICT: approve\nSUMMARY: All good\nISSUES:\n- none`,
      },
      finishReason: 'stop',
      modelUsed: 'qwen2.5-coder',
    }))
    const worker = createReviewerWorker({ client: stub, defaultModel: 'qwen2.5-coder' })
    const result = await worker({
      payload: {
        request: 'Review this addition function',
        code: 'function add(a, b) { return a + b; }',
        language: 'javascript',
      } satisfies ReviewTaskPayload,
    })
    expect(result.verdict).toBe('approve')
    expect(result.summary).toBe('All good')
    expect(result.modelUsed).toBe('qwen2.5-coder')
    expect(result.finishReason).toBe('stop')
  })

  it('includes the code in the user message when provided', async () => {
    const stub = new StubClient(() => ({
      message: { role: 'assistant', content: 'VERDICT: approve\nSUMMARY: x' },
      finishReason: 'stop',
    }))
    const worker = createReviewerWorker({ client: stub, defaultModel: 'x' })
    await worker({
      payload: {
        request: 'review',
        code: 'const x = 1',
        language: 'typescript',
      } satisfies ReviewTaskPayload,
    })
    const userMsg = stub.lastReq?.messages[1].content ?? ''
    expect(userMsg).toContain('Language: typescript')
    expect(userMsg).toContain('const x = 1')
  })

  it('rejects payload without a request string', async () => {
    const stub = new StubClient(() => ({
      message: { role: 'assistant', content: 'VERDICT: approve\nSUMMARY: x' },
      finishReason: 'stop',
    }))
    const worker = createReviewerWorker({ client: stub, defaultModel: 'x' })
    await expect(worker({ payload: {} as unknown }))
      .rejects.toBeInstanceOf(LlmClientError)
  })

  it('uses payload model when provided', async () => {
    const stub = new StubClient(() => ({
      message: { role: 'assistant', content: 'VERDICT: approve\nSUMMARY: ok' },
      finishReason: 'stop',
    }))
    const worker = createReviewerWorker({ client: stub, defaultModel: 'default' })
    await worker({
      payload: { request: 'r', model: 'override' } satisfies ReviewTaskPayload,
    })
    expect(stub.lastReq?.model).toBe('override')
  })
})

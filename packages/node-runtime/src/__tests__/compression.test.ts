import { describe, it, expect } from 'vitest'

import type { OpenObserveClient } from '@coastal-ai/coordination'
import type { LlmClient, CompressionStat } from '@coastal-ai/llm-client'

import { createCompressionStatsSink, wrapClientForRole } from '../compression.js'

const stat: CompressionStat = { model: 'qwen2.5-coder:7b', messagesCompressed: 2, tokensBefore: 900, tokensAfter: 300, tokensSaved: 600 }
const innerStub: LlmClient = { chat: async () => ({ message: { role: 'assistant', content: '' }, finishReason: 'stop' }), chatStream: async function* () {} }

describe('createCompressionStatsSink', () => {
  it('ingests a compression row (nodeId/role/model/tokens) into the compression stream', () => {
    const calls: { stream: string; events: Record<string, unknown>[] }[] = []
    const client: OpenObserveClient = {
      ingest: async (stream, events) => { calls.push({ stream, events }); return { ingested: events.length } },
      query: async () => [],
    }
    const sink = createCompressionStatsSink(client, 'n1', 'coder', () => 5000)
    sink(stat)
    expect(calls).toHaveLength(1)
    expect(calls[0].stream).toBe('compression')
    expect(calls[0].events[0]).toMatchObject({ nodeId: 'n1', role: 'coder', model: 'qwen2.5-coder:7b', tokensSaved: 600, ts: 5000 })
  })
  it('swallows ingest errors (best-effort telemetry)', () => {
    const client: OpenObserveClient = { ingest: async () => { throw new Error('down') }, query: async () => [] }
    const sink = createCompressionStatsSink(client, 'n1', 'coder')
    expect(() => sink(stat)).not.toThrow()
  })
})

describe('wrapClientForRole', () => {
  it('wraps the client when compression is enabled and the role is not excluded', () => {
    const wrapped = wrapClientForRole(innerStub, 'coder', { enabled: true, disabledRoles: [] })
    expect(wrapped).not.toBe(innerStub)
  })
  it('returns the inner client unchanged when compression is disabled', () => {
    expect(wrapClientForRole(innerStub, 'coder', { enabled: false, disabledRoles: [] })).toBe(innerStub)
  })
  it('returns the inner client unchanged when the role is excluded', () => {
    expect(wrapClientForRole(innerStub, 'coder', { enabled: true, disabledRoles: ['coder'] })).toBe(innerStub)
  })
})

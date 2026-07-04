import { describe, it, expect } from 'vitest'

import {
  createCompressingLlmClient,
  type CompressFn,
  type CompressionStat,
} from '../index.js'
import type { LlmClient, ChatMessage, ChatResponse, ChatStreamChunk } from '../index.js'

function recordingInner(): { client: LlmClient; seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = []
  const resp: ChatResponse = { message: { role: 'assistant', content: 'ok' }, finishReason: 'stop' }
  const client: LlmClient = {
    async chat(req) { seen.push(req.messages); return resp },
    async *chatStream(req) {
      seen.push(req.messages)
      yield { delta: 'ok', finishReason: 'stop' } as ChatStreamChunk
    },
  }
  return { client, seen }
}

/** Fake compressor: prefixes content with 'C:' + first 10 chars; token counts by length/4. */
const fakeCompress: CompressFn = async (messages) => {
  const out = messages.map((m) => ({ role: m.role, content: 'C:' + m.content.slice(0, 10) }))
  const tokensBefore = messages.reduce((a, m) => a + Math.ceil(m.content.length / 4), 0)
  const tokensAfter = out.reduce((a, m) => a + Math.ceil(m.content.length / 4), 0)
  return { messages: out, tokensBefore, tokensAfter, tokensSaved: tokensBefore - tokensAfter, compressed: true }
}

const big = (n: number) => 'x'.repeat(n)

describe('createCompressingLlmClient', () => {
  it('protects system + short messages, compresses large user messages', async () => {
    const { client, seen } = recordingInner()
    const c = createCompressingLlmClient(client, { compress: fakeCompress, minChars: 500 })
    await c.chat({ model: 'm', messages: [
      { role: 'system', content: big(1000) },
      { role: 'user', content: 'short' },
      { role: 'user', content: big(1000) },
    ] })
    const got = seen[0]
    expect(got[0].content).toBe(big(1000))              // system untouched
    expect(got[1].content).toBe('short')                // < minChars untouched
    expect(got[2].content.startsWith('C:')).toBe(true)  // compressed
  })

  it('fires onStats with token counts and the model', async () => {
    const { client } = recordingInner()
    const stats: CompressionStat[] = []
    const c = createCompressingLlmClient(client, { compress: fakeCompress, minChars: 500, onStats: (s) => stats.push(s) })
    await c.chat({ model: 'm', messages: [{ role: 'user', content: big(1000) }] })
    expect(stats).toHaveLength(1)
    expect(stats[0]).toMatchObject({ model: 'm', messagesCompressed: 1 })
    expect(stats[0].tokensSaved).toBeGreaterThan(0)
  })

  it('is fail-open: compress throws → inner receives the ORIGINAL messages', async () => {
    const { client, seen } = recordingInner()
    const throwing: CompressFn = async () => { throw new Error('proxy down') }
    const c = createCompressingLlmClient(client, { compress: throwing, minChars: 500 })
    const original = big(1000)
    await c.chat({ model: 'm', messages: [{ role: 'user', content: original }] })
    expect(seen[0][0].content).toBe(original)
  })

  it('keeps the original when the compressed result is not smaller', async () => {
    const { client, seen } = recordingInner()
    const bloat: CompressFn = async (messages) => ({
      messages: messages.map((m) => ({ role: m.role, content: m.content + '!!!' })),
      tokensBefore: 1, tokensAfter: 2, tokensSaved: -1, compressed: true,
    })
    const c = createCompressingLlmClient(client, { compress: bloat, minChars: 500 })
    const original = big(1000)
    await c.chat({ model: 'm', messages: [{ role: 'user', content: original }] })
    expect(seen[0][0].content).toBe(original)
  })

  it('swallows onStats errors', async () => {
    const { client } = recordingInner()
    const c = createCompressingLlmClient(client, {
      compress: fakeCompress, minChars: 500, onStats: () => { throw new Error('sink down') },
    })
    await expect(c.chat({ model: 'm', messages: [{ role: 'user', content: big(1000) }] })).resolves.toBeDefined()
  })

  it('chatStream compresses input and streams through unchanged', async () => {
    const { client, seen } = recordingInner()
    const c = createCompressingLlmClient(client, { compress: fakeCompress, minChars: 500 })
    const chunks: string[] = []
    for await (const ch of c.chatStream({ model: 'm', messages: [{ role: 'user', content: big(1000) }] })) {
      chunks.push(ch.delta)
    }
    expect(seen[0][0].content.startsWith('C:')).toBe(true)
    expect(chunks.join('')).toBe('ok')
  })
})

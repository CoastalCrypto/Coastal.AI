import { describe, it, expect, vi } from 'vitest'
import { verifyCommitment } from '../verify-commitment.js'

describe('verifyCommitment', () => {
  it('returns satisfied: true when the judge says so', async () => {
    const router = { chat: vi.fn().mockResolvedValue({ reply: '{"satisfied": true, "note": "gave a number"}', decision: {} }) }
    const verdict = await verifyCommitment(router as any, 'qwen2.5:0.5b', 'give a cost estimate', 'it is $5k')
    expect(verdict).toEqual({ satisfied: true, note: 'gave a number' })
  })

  it('returns satisfied: false when the judge says so', async () => {
    const router = { chat: vi.fn().mockResolvedValue({ reply: '{"satisfied": false, "note": "no number given"}', decision: {} }) }
    const verdict = await verifyCommitment(router as any, 'qwen2.5:0.5b', 'give a cost estimate', 'not sure')
    expect(verdict).toEqual({ satisfied: false, note: 'no number given' })
  })

  it('fails open toward unresolved when the judge returns malformed JSON', async () => {
    const router = { chat: vi.fn().mockResolvedValue({ reply: 'not json', decision: {} }) }
    const verdict = await verifyCommitment(router as any, 'qwen2.5:0.5b', 'x', 'y')
    expect(verdict).toEqual({ satisfied: false, note: 'verification unavailable' })
  })

  it('fails open toward unresolved when satisfied is missing or non-boolean', async () => {
    const router = { chat: vi.fn().mockResolvedValue({ reply: '{"note": "hmm"}', decision: {} }) }
    const verdict = await verifyCommitment(router as any, 'qwen2.5:0.5b', 'x', 'y')
    expect(verdict).toEqual({ satisfied: false, note: 'verification unavailable' })
  })

  it('fails open toward unresolved when the router call throws', async () => {
    const router = { chat: vi.fn().mockRejectedValue(new Error('model unavailable')) }
    const verdict = await verifyCommitment(router as any, 'qwen2.5:0.5b', 'x', 'y')
    expect(verdict).toEqual({ satisfied: false, note: 'verification unavailable' })
  })
})

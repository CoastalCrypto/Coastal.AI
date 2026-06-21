import { describe, it, expect } from 'vitest'
import { assembleRoster } from '../roster.js'

const t = (o: Partial<Record<string, unknown>>) => ({
  nodeId: 'n', role: 'coder', pubkey: 'PK', deviceId: 'DEV', address: '10.0.0.1:4747', ...o,
})

describe('assembleRoster', () => {
  it('folds tuples, sorts by nodeId, stamps generatedAt', () => {
    const r = assembleRoster([t({ nodeId: 'z', role: 'coder' }), t({ nodeId: 'a', role: 'curator' })], 42)
    expect(r.nodes.map(n => n.nodeId)).toEqual(['a', 'z'])
    expect(r.generatedAt).toBe(42)
  })
  it('rejects two curators with a clear message', () => {
    expect(() => assembleRoster([t({ nodeId: 'a', role: 'curator' }), t({ nodeId: 'b', role: 'curator' })], 1))
      .toThrow(/exactly one curator/)
  })
  it('rejects a malformed tuple (missing deviceId)', () => {
    expect(() => assembleRoster([{ nodeId: 'a', role: 'curator', pubkey: 'PK', address: 'x' }], 1)).toThrow()
  })
})

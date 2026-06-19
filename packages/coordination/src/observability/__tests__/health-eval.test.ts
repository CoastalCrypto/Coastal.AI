import { describe, it, expect } from 'vitest'
import { evaluateHealth } from '../health-eval.js'

const now = 1_000_000
describe('evaluateHealth', () => {
  it('no alert for a fresh ok heartbeat', () => {
    const a = evaluateHealth([{ nodeId: 'n1', role: 'coder', ts: now - 1000, ok: true }], ['n1'], now, 30_000)
    expect(a).toEqual([])
  })
  it('critical for a stale heartbeat', () => {
    const a = evaluateHealth([{ nodeId: 'n1', role: 'coder', ts: now - 60_000, ok: true }], ['n1'], now, 30_000)
    expect(a).toEqual([{ nodeId: 'n1', role: 'coder', severity: 'critical', reason: 'stale (no heartbeat in 30s)' }])
  })
  it('warn for ok=false', () => {
    const a = evaluateHealth([{ nodeId: 'n1', role: 'coder', ts: now, ok: false }], ['n1'], now, 30_000)
    expect(a[0]).toMatchObject({ nodeId: 'n1', severity: 'warn' })
  })
  it('critical for an expected node that never reported', () => {
    const a = evaluateHealth([], ['n9'], now, 30_000)
    expect(a).toEqual([{ nodeId: 'n9', role: 'unknown', severity: 'critical', reason: 'no heartbeat ever seen' }])
  })
})

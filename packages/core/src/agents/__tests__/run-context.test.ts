import { describe, it, expect } from 'vitest'
import { canHandoff, availableHandoffTargets, type RunContext } from '../run-context.js'

function freshCtx(overrides: Partial<RunContext> = {}): RunContext {
  return { visited: new Set(), turnBudget: 6, trace: [], ...overrides }
}

describe('canHandoff', () => {
  it('allows a valid, unvisited, active target', () => {
    const ctx = freshCtx()
    expect(canHandoff(ctx, 'cfo', 'cto', new Set(['cto', 'cfo']))).toBe(true)
  })

  it('rejects handoff to self', () => {
    const ctx = freshCtx()
    expect(canHandoff(ctx, 'cto', 'cto', new Set(['cto', 'cfo']))).toBe(false)
  })

  it('rejects a target that is already visited', () => {
    const ctx = freshCtx({ visited: new Set(['cfo']) })
    expect(canHandoff(ctx, 'cfo', 'cto', new Set(['cto', 'cfo']))).toBe(false)
  })

  it('rejects when turnBudget is exhausted', () => {
    const ctx = freshCtx({ turnBudget: 0 })
    expect(canHandoff(ctx, 'cfo', 'cto', new Set(['cto', 'cfo']))).toBe(false)
  })

  it('rejects a target that is not in the active agent set', () => {
    const ctx = freshCtx()
    expect(canHandoff(ctx, 'ghost', 'cto', new Set(['cto', 'cfo']))).toBe(false)
  })
})

describe('availableHandoffTargets', () => {
  it('excludes self and visited, includes everyone else active', () => {
    const ctx = freshCtx({ visited: new Set(['coo']) })
    const targets = availableHandoffTargets(ctx, 'cto', new Set(['cto', 'cfo', 'coo', 'general']))
    expect(targets.sort()).toEqual(['cfo', 'general'])
  })

  it('returns empty when turnBudget is 0', () => {
    const ctx = freshCtx({ turnBudget: 0 })
    const targets = availableHandoffTargets(ctx, 'cto', new Set(['cto', 'cfo']))
    expect(targets).toEqual([])
  })
})

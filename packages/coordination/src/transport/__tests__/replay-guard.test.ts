import { describe, it, expect } from 'vitest'
import { createReplayGuard } from '../replay-guard.js'

describe('createReplayGuard', () => {
  it('accepts a messageId the first time and rejects it thereafter', () => {
    const guard = createReplayGuard()
    expect(guard.check('msg-1', 0)).toBe(true)
    expect(guard.check('msg-1', 1)).toBe(false)
    expect(guard.check('msg-1', 2)).toBe(false)
  })

  it('tracks distinct messageIds independently', () => {
    const guard = createReplayGuard()
    expect(guard.check('msg-1', 0)).toBe(true)
    expect(guard.check('msg-2', 0)).toBe(true)
    expect(guard.check('msg-1', 1)).toBe(false)
    expect(guard.check('msg-2', 1)).toBe(false)
  })

  it('forgets a messageId once its TTL has elapsed, allowing it again', () => {
    const guard = createReplayGuard(1000)
    expect(guard.check('msg-1', 0)).toBe(true)
    expect(guard.check('msg-1', 500)).toBe(false) // still within TTL
    expect(guard.check('msg-1', 1500)).toBe(true) // TTL elapsed — pruned, accepted again
  })
})

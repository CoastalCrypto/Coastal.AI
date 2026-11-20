import { describe, it, expect } from 'vitest'
import { createAuthRateLimiter } from '../auth-rate-limit.js'

describe('createAuthRateLimiter', () => {
  it('is not limited before any failures', () => {
    const limiter = createAuthRateLimiter()
    expect(limiter.isLimited('1.2.3.4')).toBe(false)
  })

  it('limits a key once it exceeds the failure budget within the window', () => {
    const limiter = createAuthRateLimiter(60_000, 3)
    limiter.recordFailure('1.2.3.4')
    limiter.recordFailure('1.2.3.4')
    expect(limiter.isLimited('1.2.3.4')).toBe(false)
    limiter.recordFailure('1.2.3.4')
    expect(limiter.isLimited('1.2.3.4')).toBe(true)
  })

  it('tracks each key independently — one IP\'s failures never limit another', () => {
    const limiter = createAuthRateLimiter(60_000, 2)
    limiter.recordFailure('1.2.3.4')
    limiter.recordFailure('1.2.3.4')
    expect(limiter.isLimited('1.2.3.4')).toBe(true)
    expect(limiter.isLimited('5.6.7.8')).toBe(false)
  })

  it('does not limit a key that has never failed, no matter how many other keys are limited', () => {
    const limiter = createAuthRateLimiter(60_000, 1)
    for (let i = 0; i < 50; i++) limiter.recordFailure(`10.0.0.${i}`)
    expect(limiter.isLimited('clean-key')).toBe(false)
  })

  it('forgets a key\'s failures once the window elapses, allowing it again', () => {
    const limiter = createAuthRateLimiter(1000, 2)
    limiter.recordFailure('1.2.3.4', 0)
    limiter.recordFailure('1.2.3.4', 0)
    expect(limiter.isLimited('1.2.3.4', 500)).toBe(true) // still within window
    expect(limiter.isLimited('1.2.3.4', 1500)).toBe(false) // window elapsed
  })

  it('a fresh failure after the window elapses starts a new window rather than compounding the old count', () => {
    const limiter = createAuthRateLimiter(1000, 2)
    limiter.recordFailure('1.2.3.4', 0)
    limiter.recordFailure('1.2.3.4', 0)
    // Window elapsed — one more failure should start fresh, not become a
    // 3rd strike against the expired window.
    limiter.recordFailure('1.2.3.4', 1500)
    expect(limiter.isLimited('1.2.3.4', 1500)).toBe(false)
  })
})

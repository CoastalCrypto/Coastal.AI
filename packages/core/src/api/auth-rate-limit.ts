// packages/core/src/api/auth-rate-limit.ts
//
// Rate-limits repeated FAILED credential attempts against the global
// onRequest auth hook in server.ts. That hook does a timingSafeEqual
// comparison against the raw admin token and a session-token/HMAC
// verification on every request to every non-public route — CodeQL
// flagged it (correctly) as an authorization check with no rate limiting,
// meaning nothing stopped unlimited admin-token or session-token guesses.
//
// @fastify/rate-limit (already a dependency, used elsewhere in this file
// via `config: { rateLimit: {...} }`) only attaches to a specific route's
// handler chain — the onRequest hook runs before Fastify has matched a
// route, so there's no per-route config to attach to. This is a small,
// purpose-built limiter instead: only FAILED attempts count against the
// window, so a legitimate client making many successful authenticated
// calls per second (SSE polling, a busy dashboard) is never throttled —
// only an IP that keeps presenting invalid credentials is.

const WINDOW_MS = 5 * 60_000
const MAX_FAILURES_PER_WINDOW = 20

export interface AuthRateLimiter {
  /** True if this key has exceeded the failure budget for the current window. */
  isLimited(key: string, now?: number): boolean
  /** Record one failed auth attempt for this key. */
  recordFailure(key: string, now?: number): void
}

export function createAuthRateLimiter(
  windowMs = WINDOW_MS,
  maxFailures = MAX_FAILURES_PER_WINDOW,
): AuthRateLimiter {
  const failures = new Map<string, { count: number; windowStart: number }>()

  function prune(now: number): void {
    for (const [key, entry] of failures) {
      if (now - entry.windowStart > windowMs) failures.delete(key)
    }
  }

  return {
    isLimited(key: string, now: number = Date.now()): boolean {
      prune(now)
      const entry = failures.get(key)
      if (!entry) return false
      return entry.count >= maxFailures
    },
    recordFailure(key: string, now: number = Date.now()): void {
      const entry = failures.get(key)
      if (!entry || now - entry.windowStart > windowMs) {
        failures.set(key, { count: 1, windowStart: now })
      } else {
        entry.count++
      }
    },
  }
}

// packages/coordination/src/transport/replay-guard.ts
//
// Bounded, TTL-pruned cache of seen A2A message IDs, used by verifyMessage
// to reject a captured envelope replayed after the fact. A valid signature
// proves authenticity and integrity — it says nothing about freshness, so
// without this a captured claim_task or handoff envelope with a valid
// signature could be replayed indefinitely.

export interface ReplayGuard {
  /**
   * Returns true the first time a given messageId is seen (and records
   * it); false on every subsequent call with the same ID, i.e. a replay.
   */
  check(messageId: string, now: number): boolean
}

// Well above the clock-skew window a2a-envelope.ts enforces (so a message
// can never outlive its own freshness check while still being tracked for
// replay), small enough to bound memory on a long-running node.
const DEFAULT_TTL_MS = 5 * 60_000

export function createReplayGuard(ttlMs = DEFAULT_TTL_MS): ReplayGuard {
  const seen = new Map<string, number>() // messageId -> expiresAt

  function prune(now: number): void {
    for (const [id, expiresAt] of seen) {
      if (expiresAt <= now) seen.delete(id)
    }
  }

  return {
    check(messageId: string, now: number): boolean {
      prune(now)
      if (seen.has(messageId)) return false
      seen.set(messageId, now + ttlMs)
      return true
    },
  }
}

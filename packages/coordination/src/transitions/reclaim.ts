// packages/coordination/src/transitions/reclaim.ts
//
// Zombie reclaim sweep. An agent that crashed, lost its network, or
// otherwise stopped heartbeating gets its claim released — its work
// goes back into the queue for someone else to pick up.
//
// Retry semantics: every reclaim bumps the task's retry_count. If
// retry_count >= max_retries, the task transitions to 'failed' instead
// of 'queued' (no more pickups). Hermes Tenacity calls this the
// "exhaust threshold."
//
// Heartbeat timing — open tunable:
//   - Default threshold: 90s (Hermes default).
//   - Too tight → flapping reclaims during GC pauses.
//   - Too loose → dead agents hold tasks for minutes.
//   We tune empirically once Phase 1 daemon runs.

import type Database from 'better-sqlite3'
import type { Task } from '../types.js'
import type { TaskStore } from '../store/task-store.js'
import type { ClaimStore } from '../store/claim-store.js'

export interface ReclaimDeps {
  db: Database.Database
  tasks: TaskStore
  claims: ClaimStore
}

export interface ReclaimOpts {
  /** Heartbeat staleness threshold in ms. Default: 90_000 (90s). */
  thresholdMs?: number
  /** Override for tests (default: Date.now()). */
  now?: number
}

export interface ReclaimResult {
  /** Tasks that went back to 'queued' for another agent to claim. */
  requeued: Task[]
  /** Tasks that exhausted their retry budget and moved to 'failed'. */
  failed: Task[]
}

/**
 * Sweep for zombie claims and release them. Each reclaim transitions
 * the task back to 'queued' OR to 'failed' (if retries exhausted).
 *
 * Returns the two lists of affected tasks. Empty lists if nothing was
 * stale.
 */
export function reclaimZombies(
  deps: ReclaimDeps,
  opts: ReclaimOpts = {},
): ReclaimResult {
  const thresholdMs = opts.thresholdMs ?? 90_000
  const now = opts.now ?? Date.now()
  const cutoff = now - thresholdMs

  const requeued: Task[] = []
  const failed: Task[] = []

  const runInTx = deps.db.transaction(() => {
    const stale = deps.claims.activeStaleSince(cutoff)
    for (const claim of stale) {
      const task = deps.tasks.get(claim.taskId)
      if (!task) continue // task was deleted out from under the claim — skip
      if (task.state !== 'claimed') continue // already transitioned by someone else

      deps.claims.release(claim.taskId, claim.agentId, { releaseReason: 'reclaimed' })

      const nextRetry = task.retryCount + 1
      if (nextRetry > task.maxRetries) {
        const f = deps.tasks.update(claim.taskId, {
          state: 'failed',
          ownerAgentId: null,
          retryCount: nextRetry,
          failureReason: `retries exhausted (${nextRetry} > ${task.maxRetries}) after heartbeat zombie reclaim`,
        })!
        failed.push(f)
      } else {
        const q = deps.tasks.update(claim.taskId, {
          state: 'queued',
          ownerAgentId: null,
          retryCount: nextRetry,
        })!
        requeued.push(q)
      }
    }
  })
  runInTx()

  return { requeued, failed }
}

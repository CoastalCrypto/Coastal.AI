// packages/coordination/src/transitions/state-machine.ts
//
// The state machine. Single source of truth for which transitions are
// valid. Both the task-store's update method and the higher-level
// handoff / reclaim / cascade operations validate against this table
// before writing.

import type { TaskState } from '../types.js'

/**
 * Adjacency list — for each state, the set of states it can transition
 * to. Derived from the table in docs/handoff/2026-05-26-multi-agent-os-plan.md.
 *
 * Notable transitions:
 *   - claimed → queued is BOTH heartbeat-reclaim AND handoff. The
 *     distinction lives in the claim row's release_reason, not in the
 *     task's state.
 *   - failed → queued is the manual-revive path (user/main agent).
 *   - 'done' and 'cancelled' are terminal — no outgoing transitions.
 */
export const VALID_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  queued:    ['claimed', 'blocked', 'cancelled'],
  claimed:   ['done', 'failed', 'queued', 'cancelled'],
  blocked:   ['queued', 'cancelled'],
  failed:    ['queued'],
  done:      [],
  cancelled: [],
} as const

/** True iff `from → to` is in the transition table. */
export function isValidTransition(from: TaskState, to: TaskState): boolean {
  return VALID_TRANSITIONS[from].includes(to)
}

/**
 * Throw a descriptive error if `from → to` is not a valid transition.
 * Callers use this to short-circuit malformed updates before they hit
 * the DB.
 */
export function assertTransition(from: TaskState, to: TaskState): void {
  if (from === to) return // no-op transitions are silently allowed
  if (!isValidTransition(from, to)) {
    throw new Error(
      `Invalid task state transition: ${from} → ${to}. ` +
      `Valid targets from "${from}": [${VALID_TRANSITIONS[from].join(', ') || '(terminal)'}]`,
    )
  }
}

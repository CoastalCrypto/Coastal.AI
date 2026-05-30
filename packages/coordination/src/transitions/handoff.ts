// packages/coordination/src/transitions/handoff.ts
//
// Atomic ownership transfer. The super-option's killer property:
// handoff doesn't churn the task's state, it just records the
// ownership change in the claims log.
//
// Three writes, one transaction:
//   1. Release the outgoing agent's active claim (release_reason='handoff',
//      handoff_to_agent_id=<receiver>)
//   2. Insert a new active claim for the receiving agent
//   3. Update the task's denormalized owner_agent_id (state stays
//      'claimed' throughout — no other agent can race-claim during the
//      swap)

import type Database from 'better-sqlite3'
import type { Task } from '../types.js'
import type { TaskStore } from '../store/task-store.js'
import type { ClaimStore } from '../store/claim-store.js'

export interface HandoffDeps {
  db: Database.Database
  tasks: TaskStore
  claims: ClaimStore
}

/**
 * Transfer ownership of `taskId` from `fromAgentId` to `toAgentId`.
 *
 * Throws if:
 *   - the task doesn't exist
 *   - the task isn't currently 'claimed'
 *   - the active claim isn't held by `fromAgentId`
 *   - fromAgentId === toAgentId (no-op handoffs are surfaced as errors)
 *
 * On success, returns the updated task (with `ownerAgentId` flipped).
 */
export function handoff(
  deps: HandoffDeps,
  taskId: string,
  fromAgentId: string,
  toAgentId: string,
): Task {
  if (fromAgentId === toAgentId) {
    throw new Error(`handoff: fromAgentId and toAgentId are the same (${fromAgentId})`)
  }
  const runInTx = deps.db.transaction(() => {
    const task = deps.tasks.get(taskId)
    if (!task) throw new Error(`handoff: task ${taskId} not found`)
    if (task.state !== 'claimed') {
      throw new Error(`handoff: task ${taskId} is in state '${task.state}', expected 'claimed'`)
    }
    const active = deps.claims.getActive(taskId)
    if (!active || active.agentId !== fromAgentId) {
      throw new Error(
        `handoff: task ${taskId} is not currently held by ${fromAgentId} ` +
        `(active claim holder: ${active?.agentId ?? '<none>'})`,
      )
    }
    deps.claims.release(taskId, fromAgentId, {
      releaseReason: 'handoff',
      handoffToAgentId: toAgentId,
    })
    deps.claims.insert({ taskId, agentId: toAgentId })
    // State unchanged; only owner_agent_id flips. updatedAt bumps so
    // observers see the change.
    return deps.tasks.update(taskId, { ownerAgentId: toAgentId })!
  })
  return runInTx()
}

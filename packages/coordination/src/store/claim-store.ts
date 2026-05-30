// packages/coordination/src/store/claim-store.ts
//
// Append-only audit log of task ownership. Two write operations only:
//
//   insert()  — record a new claim. Active by default (released_at null).
//   release() — mark an active claim as released, with a reason.
//
// There is no `update` of an active claim's agentId — handoff is two
// rows (release old + insert new), not a mutation. That's the whole
// point of the super-option's split.
//
// Heartbeats are a special case: they bump `last_heartbeat` on the
// active claim row. That IS a mutation, but it's the only one allowed.

import type Database from 'better-sqlite3'
import { ulid } from '@coastal-ai/core/architect/ulid'
import type {
  TaskClaim, TaskClaimInput, ClaimReleaseReason,
} from '../types.js'

interface ClaimRow {
  id: string
  task_id: string
  agent_id: string
  claimed_at: number
  last_heartbeat: number
  released_at: number | null
  release_reason: ClaimReleaseReason | null
  handoff_to_agent_id: string | null
}

function rowToClaim(row: ClaimRow): TaskClaim {
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    claimedAt: row.claimed_at,
    lastHeartbeat: row.last_heartbeat,
    releasedAt: row.released_at,
    releaseReason: row.release_reason,
    handoffToAgentId: row.handoff_to_agent_id,
  }
}

export interface ReleaseOpts {
  releaseReason: ClaimReleaseReason
  /** Required iff releaseReason === 'handoff'. */
  handoffToAgentId?: string | null
}

export class ClaimStore {
  constructor(private db: Database.Database) {}

  /**
   * Record a new active claim. Caller is responsible for ensuring no
   * other active claim exists for the same task — the higher-level
   * transitions layer does this inside a transaction.
   */
  insert(input: TaskClaimInput): TaskClaim {
    const id = input.id ?? ulid()
    const now = Date.now()
    const claim: TaskClaim = {
      id,
      taskId: input.taskId,
      agentId: input.agentId,
      claimedAt: now,
      lastHeartbeat: now,
      releasedAt: null,
      releaseReason: null,
      handoffToAgentId: null,
    }
    this.db.prepare(`
      INSERT INTO task_claims (
        id, task_id, agent_id, claimed_at, last_heartbeat,
        released_at, release_reason, handoff_to_agent_id
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
    `).run(claim.id, claim.taskId, claim.agentId, claim.claimedAt, claim.lastHeartbeat)
    return claim
  }

  /**
   * Mark the active claim for (taskId, agentId) as released. Returns
   * the updated claim, or null if no matching active claim existed.
   *
   * If releaseReason === 'handoff', handoffToAgentId is required.
   */
  release(taskId: string, agentId: string, opts: ReleaseOpts): TaskClaim | null {
    if (opts.releaseReason === 'handoff' && !opts.handoffToAgentId) {
      throw new Error('release: handoffToAgentId required when releaseReason === "handoff"')
    }
    const active = this.getActive(taskId)
    if (!active || active.agentId !== agentId) return null
    const now = Date.now()
    this.db.prepare(`
      UPDATE task_claims
      SET released_at = ?, release_reason = ?, handoff_to_agent_id = ?
      WHERE id = ?
    `).run(now, opts.releaseReason, opts.handoffToAgentId ?? null, active.id)
    return {
      ...active,
      releasedAt: now,
      releaseReason: opts.releaseReason,
      handoffToAgentId: opts.handoffToAgentId ?? null,
    }
  }

  /**
   * Bump last_heartbeat on the active claim for (taskId, agentId).
   * Returns true if a heartbeat was recorded; false if no active claim
   * for that pair existed (caller should treat as "claim was reclaimed
   * underneath me" and back off).
   */
  heartbeat(taskId: string, agentId: string): boolean {
    const now = Date.now()
    const info = this.db.prepare(`
      UPDATE task_claims
      SET last_heartbeat = ?
      WHERE task_id = ? AND agent_id = ? AND released_at IS NULL
    `).run(now, taskId, agentId)
    return info.changes > 0
  }

  /** The active claim for a task, or null if none. */
  getActive(taskId: string): TaskClaim | null {
    const row = this.db.prepare(`
      SELECT * FROM task_claims WHERE task_id = ? AND released_at IS NULL
    `).get(taskId) as ClaimRow | undefined
    return row ? rowToClaim(row) : null
  }

  /** All claims for a task, oldest first. The audit log. */
  history(taskId: string): TaskClaim[] {
    const rows = this.db.prepare(`
      SELECT * FROM task_claims WHERE task_id = ? ORDER BY claimed_at ASC
    `).all(taskId) as ClaimRow[]
    return rows.map(rowToClaim)
  }

  /**
   * Active claims whose last_heartbeat is older than `cutoff`. The
   * reclaim sweeper queries this with `cutoff = Date.now() - threshold`
   * to find zombies.
   */
  activeStaleSince(cutoff: number): TaskClaim[] {
    const rows = this.db.prepare(`
      SELECT * FROM task_claims
      WHERE released_at IS NULL AND last_heartbeat < ?
    `).all(cutoff) as ClaimRow[]
    return rows.map(rowToClaim)
  }
}

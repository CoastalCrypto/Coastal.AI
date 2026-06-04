// packages/coordination/src/replication/replicator.ts
//
// Master-replica replication via A2A broadcast events.
//
// The CoordinationDaemon broadcasts a state-change message whenever
// the local board mutates (task.available, task.claim, task.complete,
// task.handoff, task.requeued). Each broadcast carries the FULL
// resulting Task + TaskClaim objects — not just IDs — so any peer
// can apply the change to its own local SQLite without an RPC
// roundtrip.
//
// In Phase 1+2 (shared SQLite) the Replicator is a no-op: every
// upsert sees the row already at the desired state. In Phase 4
// (per-node SQLite) the Replicator is the sync mechanism — workers
// follow main's broadcasts to maintain a local read replica.
//
// Idempotent by construction: all writes use INSERT OR REPLACE so
// duplicate broadcasts (retransmits, multi-path delivery) reduce to
// no-ops.

import type Database from 'better-sqlite3'
import type { A2AMessage, Task, TaskClaim } from '../types.js'
import type { A2ATransport } from '../transport/types.js'
import type { TaskStore } from '../store/task-store.js'
import type { ClaimStore } from '../store/claim-store.js'

export interface ReplicatorConfig {
  transport: A2ATransport
  db: Database.Database
  tasks: TaskStore
  claims: ClaimStore
  /**
   * If supplied, broadcasts whose from.agentId matches are ignored.
   * Use when the same process publishes AND replicates (avoids
   * applying your own writes a second time). Defaults to "apply
   * everything" — useful when the daemon and replicator run on
   * separate machines.
   */
  selfAgentId?: string
  /**
   * Optional callback fired after every successful apply. Useful for
   * tests + observability. Receives the message kind.
   */
  onApplied?: (kind: string, msg: A2AMessage) => void
}

export interface Replicator {
  stop(): void
  /** Count of messages applied so far. Test-only. */
  appliedCount(): number
}

export function createReplicator(config: ReplicatorConfig): Replicator {
  let applied = 0

  const unsubscribe = config.transport.subscribe((msg) => {
    if (config.selfAgentId && msg.from.agentId === config.selfAgentId) return
    if (!applyToLocal(msg, config.db, config.tasks, config.claims)) return
    applied += 1
    config.onApplied?.(msg.kind, msg)
  })

  return {
    stop() { unsubscribe() },
    appliedCount() { return applied },
  }
}

// ─── Application ───────────────────────────────────────────────────

function applyToLocal(
  msg: A2AMessage,
  db: Database.Database,
  tasks: TaskStore,
  claims: ClaimStore,
): boolean {
  switch (msg.kind) {
    case 'task.available': {
      const { task } = msg.payload as { task: Task }
      upsertTask(db, task)
      return true
    }
    case 'task.claim': {
      const { task, claim } = msg.payload as { task: Task; claim: TaskClaim }
      db.transaction(() => {
        upsertTask(db, task)
        upsertClaim(db, claim)
      })()
      return true
    }
    case 'task.complete': {
      const { task, claim } = msg.payload as { task: Task; claim: TaskClaim }
      db.transaction(() => {
        upsertTask(db, task)
        upsertClaim(db, claim)
      })()
      return true
    }
    case 'task.requeued': {
      const { task, claim } = msg.payload as { task: Task; claim: TaskClaim }
      db.transaction(() => {
        upsertTask(db, task)
        upsertClaim(db, claim)
      })()
      return true
    }
    case 'task.handoff': {
      const { task, oldClaim, newClaim } = msg.payload as {
        task: Task; oldClaim: TaskClaim; newClaim: TaskClaim
      }
      db.transaction(() => {
        upsertTask(db, task)
        upsertClaim(db, oldClaim)
        upsertClaim(db, newClaim)
      })()
      return true
    }
    default:
      // Heartbeats, observes, agent lifecycle aren't replicated as
      // state mutations — they're transient. Future versions may
      // log them somewhere.
      return false
  }
}

// ─── Idempotent low-level upserts (also used by CoordinationDaemon's
//     onMessage handler to ensure local state is current before any
//     role-specific logic runs).
//
//     Critical correctness property: these upserts must NEVER regress
//     state. Broadcasts can arrive out of order — a task.available
//     (state=queued) can arrive AFTER a task.claim (state=claimed) was
//     already applied locally. We guard with logical-clock checks
//     (updated_at for tasks, released_at NULL→NOT NULL for claims) so
//     stale broadcasts become no-ops. ──────────────────────────────────

export function upsertTask(db: Database.Database, task: Task): void {
  db.prepare(`
    INSERT INTO tasks (
      id, state, kind, payload, result, failure_reason, owner_agent_id,
      retry_count, max_retries, created_at, updated_at, parent_task_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      state          = excluded.state,
      kind           = excluded.kind,
      payload        = excluded.payload,
      result         = excluded.result,
      failure_reason = excluded.failure_reason,
      owner_agent_id = excluded.owner_agent_id,
      retry_count    = excluded.retry_count,
      max_retries    = excluded.max_retries,
      updated_at     = excluded.updated_at,
      parent_task_id = excluded.parent_task_id
    WHERE excluded.updated_at >= tasks.updated_at
  `).run(
    task.id,
    task.state,
    task.kind,
    JSON.stringify(task.payload),
    task.result === null ? null : JSON.stringify(task.result),
    task.failureReason,
    task.ownerAgentId,
    task.retryCount,
    task.maxRetries,
    task.createdAt,
    task.updatedAt,
    task.parentTaskId,
  )
}

export function upsertClaim(db: Database.Database, claim: TaskClaim): void {
  // The guard: only update an existing claim row if we're transitioning
  // from active (released_at NULL) to released (released_at NOT NULL),
  // OR if both sides are active and the heartbeat is newer. Once
  // released, the row is final and ignores re-inserts.
  db.prepare(`
    INSERT INTO task_claims (
      id, task_id, agent_id, claimed_at, last_heartbeat,
      released_at, release_reason, handoff_to_agent_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_heartbeat      = MAX(excluded.last_heartbeat, task_claims.last_heartbeat),
      released_at         = excluded.released_at,
      release_reason      = excluded.release_reason,
      handoff_to_agent_id = excluded.handoff_to_agent_id
    WHERE
      (task_claims.released_at IS NULL AND excluded.released_at IS NOT NULL)
      OR (task_claims.released_at IS NULL AND excluded.released_at IS NULL
          AND excluded.last_heartbeat > task_claims.last_heartbeat)
  `).run(
    claim.id,
    claim.taskId,
    claim.agentId,
    claim.claimedAt,
    claim.lastHeartbeat,
    claim.releasedAt,
    claim.releaseReason,
    claim.handoffToAgentId,
  )
}

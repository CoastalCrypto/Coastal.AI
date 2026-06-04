// packages/coordination/src/daemon.ts
//
// The CoordinationDaemon — minimum viable agent loop. Pulls together
// identity + transport + stores + state-machine into one object that
// behaves like a peer in the swarm:
//
//   - Submits tasks to the shared board and broadcasts availability.
//   - Receives task.available broadcasts and auto-claims via policy.
//   - Heartbeats active claims on a timer.
//   - On worker success: releases claim, marks task done, broadcasts
//     task.complete.
//   - On worker throw: releases claim with reclaimed reason, lets the
//     retry / reclaim machinery deal with the task.
//   - Hands off tasks via the atomic handoff() and broadcasts the
//     handoff event so observers can re-target.
//
// In Phase 1 all daemons share the same SQLite DB (single source of
// truth for the board). In Phase 2 each node has its own DB and the
// A2A messages carry state across the wire; the daemon API is
// unchanged.

import type {
  AgentIdentity, A2AMessage, A2AMessageKind, Task, TaskClaim, TaskInput,
  TaskDependencyInput,
} from './types.js'
import type { A2ATransport } from './transport/types.js'
import type { TaskStore } from './store/task-store.js'
import type { ClaimStore } from './store/claim-store.js'
import type { DependencyStore } from './store/dependency-store.js'
import { signMessage } from './transport/a2a-envelope.js'
import { handoff as handoffTransition } from './transitions/handoff.js'
import { upsertTask, upsertClaim } from './replication/replicator.js'
import type Database from 'better-sqlite3'

/**
 * Capabilities exposed to a worker function when it runs. Workers that
 * just transform a task into a result (e.g. coder, reviewer) can ignore
 * `ctx` entirely. Workers that submit subtasks (e.g. planner) use
 * `ctx.submit` and `ctx.addDependency` — these route through the
 * daemon so subtasks broadcast properly.
 *
 * Replaces the pre-2026-05-29 late-bound submit pattern where the
 * planner-agent's createPlannerWorker took submit/addDependency at
 * construction time, requiring a forward-reference workaround in demos.
 */
export interface WorkerContext {
  /** Submit a child task. Broadcasts task.available — peers can auto-claim. */
  submit: (input: TaskInput) => Promise<Task>
  /**
   * Add a dependency edge. Requires the daemon to have been constructed
   * with `deps` (else this throws — fail loud rather than silently swallow).
   */
  addDependency: (dep: TaskDependencyInput) => void
  /** Send a custom A2A broadcast. Signed by the daemon's identity. */
  broadcast: (kind: A2AMessageKind, payload: unknown) => Promise<void>
}

export interface DaemonConfig {
  identity: AgentIdentity
  transport: A2ATransport
  db: Database.Database
  tasks: TaskStore
  claims: ClaimStore
  /**
   * Optional dependency store. Required if any worker calls
   * ctx.addDependency (e.g. the planner agent). Omit for daemons that
   * only run leaf workers (coder, reviewer, curator).
   */
  deps?: DependencyStore
  /**
   * Executor for tasks this daemon has claimed. Return value populates
   * task.result. Throwing transitions the claim to reclaimed (retry
   * machinery will decide whether to requeue or fail).
   *
   * `ctx` provides submit/addDependency/broadcast capabilities. Workers
   * that don't need them (most do not) can simply ignore the second
   * parameter — TypeScript permits this via variance.
   */
  worker: (task: Task, ctx: WorkerContext) => Promise<unknown> | unknown
  /**
   * Optional auto-claim policy. When task.available arrives, the
   * daemon checks the task against this predicate and claims if true.
   * Without it, the daemon only claims tasks via the explicit
   * claimAndRun() method (useful for orchestrated tests).
   */
  shouldClaim?: (task: Task) => boolean
  /**
   * Heartbeat interval for active claims. Default 5000ms. Set to 0 to
   * disable (tests).
   */
  heartbeatIntervalMs?: number
}

export class CoordinationDaemon {
  private readonly ownedTaskIds = new Set<string>()
  private heartbeatTimer: NodeJS.Timeout | null = null
  private unsubscribe: (() => void) | null = null

  constructor(private readonly config: DaemonConfig) {
    this.unsubscribe = this.config.transport.subscribe(msg => this.onMessage(msg))
    const interval = this.config.heartbeatIntervalMs ?? 5000
    if (interval > 0) {
      this.heartbeatTimer = setInterval(() => this.heartbeatAll(), interval)
      // setInterval keeps Node.js alive; we don't want that for tests
      // that forget to call stop(). unref() makes the timer "background."
      this.heartbeatTimer.unref()
    }
  }

  get agentId(): string {
    return this.config.identity.agentId
  }

  /**
   * Add a task to the shared board and broadcast availability so peer
   * daemons can auto-claim. Returns the created task.
   *
   * Broadcast payload carries the full Task — Replicators on
   * separate-DB peers (Phase 4 cluster) apply it directly.
   */
  async submit(input: TaskInput): Promise<Task> {
    const task = this.config.tasks.create(input)
    await this.broadcast('task.available', { task })
    return task
  }

  /**
   * Claim a specific task by id and run it through the configured
   * worker. The full happy-path lifecycle in one call.
   *
   * Returns the final task state. Throws if the task can't be claimed
   * (already owned, terminal state, etc.); the caller decides how to
   * react.
   */
  async claimAndRun(taskId: string): Promise<Task> {
    const task = this.config.tasks.get(taskId)
    if (!task) throw new Error(`claimAndRun: task ${taskId} not found`)
    if (task.state !== 'queued') {
      throw new Error(`claimAndRun: task ${taskId} is in state '${task.state}', expected 'queued'`)
    }
    // 1. Insert claim + flip task to claimed atomically
    let insertedClaim: TaskClaim | null = null
    this.config.db.transaction(() => {
      insertedClaim = this.config.claims.insert({ taskId, agentId: this.agentId })
      this.config.tasks.update(taskId, { state: 'claimed', ownerAgentId: this.agentId })
    })()
    this.ownedTaskIds.add(taskId)
    await this.broadcast('task.claim', {
      task: this.config.tasks.get(taskId)!,
      claim: insertedClaim!,
    })

    // 2. Run the worker
    try {
      const result = await this.config.worker(task, this.workerContext())
      // 3a. Success — release claim, mark task done, broadcast
      let releasedClaim: TaskClaim | null = null
      this.config.db.transaction(() => {
        releasedClaim = this.config.claims.release(taskId, this.agentId, { releaseReason: 'completed' })
        this.config.tasks.update(taskId, {
          state: 'done',
          result,
          ownerAgentId: null,
        })
      })()
      this.ownedTaskIds.delete(taskId)
      await this.broadcast('task.complete', {
        task: this.config.tasks.get(taskId)!,
        claim: releasedClaim!,
      })
      return this.config.tasks.get(taskId)!
    } catch (err) {
      // 3b. Failure — release claim with reclaimed, requeue, bump retry.
      let requeuedClaim: TaskClaim | null = null
      this.config.db.transaction(() => {
        requeuedClaim = this.config.claims.release(taskId, this.agentId, { releaseReason: 'reclaimed' })
        this.config.tasks.update(taskId, {
          state: 'queued',
          ownerAgentId: null,
          retryCount: (this.config.tasks.get(taskId)?.retryCount ?? 0) + 1,
        })
      })()
      this.ownedTaskIds.delete(taskId)
      // Broadcast so peer daemons + replicators see the failure + requeue.
      await this.broadcast('task.requeued', {
        task: this.config.tasks.get(taskId)!,
        claim: requeuedClaim!,
      })
      throw err
    }
  }

  /**
   * Hand off one of this daemon's owned tasks to another agent.
   * Atomic per the super-option handoff transaction; broadcasts the
   * handoff event so observers can re-target.
   */
  async handoffTo(taskId: string, toAgentId: string): Promise<Task> {
    if (!this.ownedTaskIds.has(taskId)) {
      throw new Error(`handoffTo: ${this.agentId} does not own task ${taskId}`)
    }
    const result = handoffTransition(
      { db: this.config.db, tasks: this.config.tasks, claims: this.config.claims },
      taskId, this.agentId, toAgentId,
    )
    this.ownedTaskIds.delete(taskId)
    // Pull the resulting claim rows so replicators can apply them.
    // The handoff transaction released the outgoing claim and inserted
    // the incoming one — both are needed downstream.
    const history = this.config.claims.history(taskId)
    const oldClaim = history.find(c =>
      c.agentId === this.agentId && c.releaseReason === 'handoff' && c.handoffToAgentId === toAgentId
    )!
    const newClaim = history.find(c => c.agentId === toAgentId && c.releasedAt === null)!
    await this.broadcast('task.handoff', {
      task: result,
      oldClaim,
      newClaim,
    })
    return result
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    await this.config.transport.close()
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private onMessage(msg: A2AMessage): void {
    // Ensure the daemon's local state reflects the broadcast before
    // role-specific logic (auto-claim) runs. This is idempotent with
    // the external Replicator, but matters when no Replicator is
    // wired OR when subscriber order delivers this handler first.
    this.applyBroadcastState(msg)

    switch (msg.kind) {
      case 'task.available':
      case 'task.requeued': {
        if (!this.config.shouldClaim) return
        const { task } = msg.payload as { task: Task }
        const local = this.config.tasks.get(task.id) ?? task
        if (local.state !== 'queued') return
        if (!this.config.shouldClaim(local)) return
        // Fire-and-forget; claim races are expected and benign.
        void this.claimAndRun(local.id).catch(() => {
          // Swallow: claim races, late broadcasts, and concurrent
          // peer claims are all expected. The task's audit log
          // remains authoritative.
        })
        return
      }
      // Other kinds are pure state updates — applyBroadcastState
      // already handled them.
      default:
        return
    }
  }

  /**
   * Apply a broadcast state-change message to the local DB. Idempotent
   * — all writes use INSERT OR REPLACE so duplicate apply (from
   * external Replicator + internal handler both running) reduces to
   * no-ops.
   *
   * Skips broadcasts originating from this daemon (own writes are
   * already reflected locally).
   */
  private applyBroadcastState(msg: A2AMessage): void {
    if (msg.from.agentId === this.agentId) return
    switch (msg.kind) {
      case 'task.available': {
        const { task } = msg.payload as { task: Task }
        upsertTask(this.config.db, task)
        return
      }
      case 'task.claim':
      case 'task.complete':
      case 'task.requeued': {
        const { task, claim } = msg.payload as { task: Task; claim: TaskClaim }
        this.config.db.transaction(() => {
          upsertTask(this.config.db, task)
          upsertClaim(this.config.db, claim)
        })()
        return
      }
      case 'task.handoff': {
        const { task, oldClaim, newClaim } = msg.payload as {
          task: Task; oldClaim: TaskClaim; newClaim: TaskClaim
        }
        this.config.db.transaction(() => {
          upsertTask(this.config.db, task)
          upsertClaim(this.config.db, oldClaim)
          upsertClaim(this.config.db, newClaim)
        })()
        return
      }
      default:
        return
    }
  }

  private async broadcast(kind: A2AMessage['kind'], payload: unknown): Promise<void> {
    const msg = signMessage({ to: '*', kind, payload }, this.config.identity)
    await this.config.transport.send(msg)
  }

  /** Construct the WorkerContext passed to each invocation. */
  private workerContext(): WorkerContext {
    return {
      submit: (input) => this.submit(input),
      addDependency: (dep) => {
        if (!this.config.deps) {
          throw new Error(
            `worker called ctx.addDependency but the daemon was constructed without a deps store. ` +
            `Pass DependencyStore in DaemonConfig.deps to enable this.`,
          )
        }
        this.config.deps.add(dep)
      },
      broadcast: (kind, payload) => this.broadcast(kind, payload),
    }
  }

  private heartbeatAll(): void {
    for (const taskId of this.ownedTaskIds) {
      const ok = this.config.claims.heartbeat(taskId, this.agentId)
      if (!ok) {
        // Claim was reclaimed underneath us — drop from owned set.
        this.ownedTaskIds.delete(taskId)
      }
    }
  }
}

/** Convenience factory mirroring the trading-architect's runTradeTick style. */
export function runCoordinationDaemon(config: DaemonConfig): CoordinationDaemon {
  return new CoordinationDaemon(config)
}

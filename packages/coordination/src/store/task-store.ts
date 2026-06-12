// packages/coordination/src/store/task-store.ts
//
// CRUD + state-validated updates for the `tasks` table.
//
// The store does NOT implement handoff, reclaim, or cascade — those live
// in transitions/ because they orchestrate multiple stores in a single
// transaction. This store is the primitive layer they build on.

import type Database from 'better-sqlite3'
import { ulid } from '@coastal-ai/core/architect/ulid'
import type { Task, TaskInput, TaskPatch, TaskState } from '../types.js'
import { assertTransition } from '../transitions/state-machine.js'

interface TaskRow {
  id: string
  state: TaskState
  kind: string
  payload: string
  result: string | null
  failure_reason: string | null
  owner_agent_id: string | null
  retry_count: number
  max_retries: number
  created_at: number
  updated_at: number
  parent_task_id: string | null
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    state: row.state,
    kind: row.kind,
    payload: JSON.parse(row.payload),
    result: row.result === null ? null : JSON.parse(row.result),
    failureReason: row.failure_reason,
    ownerAgentId: row.owner_agent_id,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    parentTaskId: row.parent_task_id,
  }
}

export class TaskStore {
  constructor(private db: Database.Database) {}

  /** Create a new task in 'queued' state. ID auto-generated if not supplied. */
  create(input: TaskInput): Task {
    const id = input.id ?? ulid()
    const now = Date.now()
    const task: Task = {
      id,
      state: 'queued',
      kind: input.kind,
      payload: input.payload,
      result: null,
      failureReason: null,
      ownerAgentId: null,
      retryCount: 0,
      maxRetries: input.maxRetries ?? 3,
      createdAt: now,
      updatedAt: now,
      parentTaskId: input.parentTaskId ?? null,
    }
    this.db.prepare(`
      INSERT INTO tasks (
        id, state, kind, payload, result, failure_reason, owner_agent_id,
        retry_count, max_retries, created_at, updated_at, parent_task_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.state, task.kind, JSON.stringify(task.payload),
      null, null, null,
      task.retryCount, task.maxRetries, task.createdAt, task.updatedAt,
      task.parentTaskId,
    )
    return task
  }

  get(id: string): Task | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined
    return row ? rowToTask(row) : null
  }

  /**
   * Apply a partial update. If `patch.state` is supplied, validates the
   * transition against the state machine first. All updates bump
   * `updated_at`. Returns the resulting task, or null if the id didn't
   * exist.
   */
  update(id: string, patch: TaskPatch): Task | null {
    const existing = this.get(id)
    if (!existing) return null
    if (patch.state !== undefined) {
      assertTransition(existing.state, patch.state)
    }
    const next: Task = {
      ...existing,
      ...(patch.state !== undefined && { state: patch.state }),
      ...(patch.result !== undefined && { result: patch.result }),
      ...(patch.failureReason !== undefined && { failureReason: patch.failureReason }),
      ...(patch.ownerAgentId !== undefined && { ownerAgentId: patch.ownerAgentId }),
      ...(patch.retryCount !== undefined && { retryCount: patch.retryCount }),
      updatedAt: Date.now(),
    }
    this.db.prepare(`
      UPDATE tasks
      SET state = ?, result = ?, failure_reason = ?, owner_agent_id = ?,
          retry_count = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.state,
      next.result === null ? null : JSON.stringify(next.result),
      next.failureReason,
      next.ownerAgentId,
      next.retryCount,
      next.updatedAt,
      next.id,
    )
    return next
  }

  /**
   * Tasks ready to be claimed. Sorted oldest-first so agents pick up
   * work in FIFO order (modulo priority, which v0.0.x doesn't model).
   */
  listQueued(limit = 50): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks WHERE state = 'queued' ORDER BY created_at ASC LIMIT ?
    `).all(limit) as TaskRow[]
    return rows.map(rowToTask)
  }

  /** Tasks currently held by an agent (any agent). */
  listClaimed(limit = 100): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks WHERE state = 'claimed' ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as TaskRow[]
    return rows.map(rowToTask)
  }

  /** Tasks currently waiting on dependencies. */
  listBlocked(limit = 100): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks WHERE state = 'blocked' ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as TaskRow[]
    return rows.map(rowToTask)
  }

  /** Tasks currently held by a specific agent. */
  listByOwner(agentId: string): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks WHERE owner_agent_id = ? ORDER BY updated_at DESC
    `).all(agentId) as TaskRow[]
    return rows.map(rowToTask)
  }

  /** Subtasks of a parent. */
  listChildren(parentTaskId: string): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC
    `).all(parentTaskId) as TaskRow[]
    return rows.map(rowToTask)
  }

  /**
   * Every task in the board regardless of state — including terminal
   * (done / failed / cancelled) rows. Oldest-first. Intended for
   * observability surfaces (mission control, demo summaries) that want a
   * full snapshot; callers that only care about live work should prefer
   * the state-scoped list* methods above.
   */
  listAll(limit = 1000): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks ORDER BY created_at ASC LIMIT ?
    `).all(limit) as TaskRow[]
    return rows.map(rowToTask)
  }

  /**
   * Hard delete. Use sparingly — the audit value of keeping done/failed
   * rows is high. ON DELETE CASCADE cleans up claims and dependencies.
   */
  delete(id: string): boolean {
    const info = this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id)
    return info.changes > 0
  }
}

// packages/coordination/src/store/dependency-store.ts
//
// CRUD for the directed dependency graph. The resolver (in transitions/
// or resolver/, lands separately) reads from here to decide when to
// unblock or cascade-cancel.

import type Database from 'better-sqlite3'
import type {
  TaskDependency, TaskDependencyInput, DependencyKind,
} from '../types.js'

interface DepRow {
  task_id: string
  depends_on_task_id: string
  kind: DependencyKind
}

function rowToDep(row: DepRow): TaskDependency {
  return {
    taskId: row.task_id,
    dependsOnTaskId: row.depends_on_task_id,
    kind: row.kind,
  }
}

export class DependencyStore {
  constructor(private db: Database.Database) {}

  /**
   * Add a directed edge: `taskId` depends on `dependsOnTaskId`. The
   * PRIMARY KEY (task_id, depends_on_task_id) means re-adding the same
   * pair is a no-op (we use INSERT OR REPLACE to upgrade the kind).
   */
  add(input: TaskDependencyInput): TaskDependency {
    this.db.prepare(`
      INSERT OR REPLACE INTO task_dependencies (task_id, depends_on_task_id, kind)
      VALUES (?, ?, ?)
    `).run(input.taskId, input.dependsOnTaskId, input.kind)
    return {
      taskId: input.taskId,
      dependsOnTaskId: input.dependsOnTaskId,
      kind: input.kind,
    }
  }

  remove(taskId: string, dependsOnTaskId: string): boolean {
    const info = this.db.prepare(`
      DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?
    `).run(taskId, dependsOnTaskId)
    return info.changes > 0
  }

  /** Things `taskId` depends on. */
  depsOf(taskId: string): TaskDependency[] {
    const rows = this.db.prepare(`
      SELECT * FROM task_dependencies WHERE task_id = ?
    `).all(taskId) as DepRow[]
    return rows.map(rowToDep)
  }

  /** Things that depend on `taskId`. Used by the resolver when a task transitions. */
  dependentsOf(taskId: string): TaskDependency[] {
    const rows = this.db.prepare(`
      SELECT * FROM task_dependencies WHERE depends_on_task_id = ?
    `).all(taskId) as DepRow[]
    return rows.map(rowToDep)
  }

  /** Bulk read for resolver sweeps. */
  all(): TaskDependency[] {
    const rows = this.db.prepare(`SELECT * FROM task_dependencies`).all() as DepRow[]
    return rows.map(rowToDep)
  }
}

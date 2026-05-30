// packages/coordination/src/resolver/dependency-resolver.ts
//
// The dependency resolver — the piece that makes `must_complete` and
// `must_not_fail` actually mean something. Runs as a sweep on a timer
// (the daemon owns the timer; this file just exposes the sweep
// function).
//
// Three transitions, evaluated in priority order per sweep:
//
//   1. CASCADE  — any 'blocked' task with a must_not_fail dep in
//                 {failed, cancelled} → transition to 'cancelled'
//                 with failureReason='cascaded from <depId>'.
//   2. UNBLOCK  — any 'blocked' task whose must_complete deps are all
//                 'done' AND no must_not_fail dep has failed → back
//                 to 'queued'.
//   3. BLOCK    — any 'queued' task with at least one unsatisfied dep
//                 (any must_complete dep not 'done', OR any
//                 must_not_fail dep already cancelled/failed) →
//                 transition to 'blocked'.
//
// Cascade is evaluated before unblock so a cascade always wins over a
// spurious unblock (which shouldn't happen given "all done" excludes
// "any failed", but the explicit ordering is defensive).

import type Database from 'better-sqlite3'
import type { Task, TaskDependency, DependencyKind } from '../types.js'
import type { TaskStore } from '../store/task-store.js'
import type { DependencyStore } from '../store/dependency-store.js'

export interface ResolverDeps {
  db: Database.Database
  tasks: TaskStore
  deps: DependencyStore
}

export interface ResolverResult {
  /** Tasks transitioned blocked → queued. */
  unblocked: Task[]
  /** Tasks transitioned blocked → cancelled via must_not_fail cascade. */
  cascaded: Task[]
  /** Tasks transitioned queued → blocked because deps weren't satisfied. */
  blocked: Task[]
}

/** Empty result, used as the default accumulator. */
const EMPTY: ResolverResult = { unblocked: [], cascaded: [], blocked: [] }

/**
 * One full sweep across queued + blocked tasks. The whole sweep runs
 * inside a single SQLite transaction so observers see a coherent view.
 */
export function resolveDependencies(rd: ResolverDeps): ResolverResult {
  const result: ResolverResult = { unblocked: [], cascaded: [], blocked: [] }

  const runInTx = rd.db.transaction(() => {
    // ── 1+2: sweep currently-blocked tasks ──
    for (const task of rd.tasks.listBlocked()) {
      const deps = rd.deps.depsOf(task.id)
      if (deps.length === 0) {
        // Task is blocked but has no recorded deps — unblock it.
        const next = rd.tasks.update(task.id, { state: 'queued' })!
        result.unblocked.push(next)
        continue
      }
      const verdict = evaluateDeps(rd, deps)
      if (verdict.cascadeFromId) {
        const next = rd.tasks.update(task.id, {
          state: 'cancelled',
          failureReason: `cascaded from must_not_fail dep ${verdict.cascadeFromId}`,
        })!
        result.cascaded.push(next)
      } else if (verdict.allSatisfied) {
        const next = rd.tasks.update(task.id, { state: 'queued' })!
        result.unblocked.push(next)
      }
      // else: stay blocked, no change
    }

    // ── 3: sweep currently-queued tasks for new blockers ──
    for (const task of rd.tasks.listQueued()) {
      const deps = rd.deps.depsOf(task.id)
      if (deps.length === 0) continue
      const verdict = evaluateDeps(rd, deps)
      if (verdict.cascadeFromId) {
        // Edge case: a queued task already has a failed must_not_fail
        // dep at the moment of evaluation. Cascade directly to
        // 'cancelled' without going through 'blocked'.
        const next = rd.tasks.update(task.id, {
          state: 'cancelled',
          failureReason: `cascaded from must_not_fail dep ${verdict.cascadeFromId}`,
        })!
        result.cascaded.push(next)
      } else if (!verdict.allSatisfied) {
        const next = rd.tasks.update(task.id, { state: 'blocked' })!
        result.blocked.push(next)
      }
    }
  })
  runInTx()

  return result
}

interface DepsVerdict {
  /** True iff all must_complete deps are 'done'. */
  allSatisfied: boolean
  /**
   * The id of a must_not_fail dep that is in {failed, cancelled},
   * triggering cascade. Null if no cascade applies.
   */
  cascadeFromId: string | null
}

function evaluateDeps(rd: ResolverDeps, deps: readonly TaskDependency[]): DepsVerdict {
  let allSatisfied = true
  let cascadeFromId: string | null = null
  for (const dep of deps) {
    const depTask = rd.tasks.get(dep.dependsOnTaskId)
    if (!depTask) {
      // Dangling dep — treat as unsatisfied (the dep was deleted out
      // from under us). Won't cascade; just stays blocked.
      allSatisfied = false
      continue
    }
    if (dep.kind === 'must_not_fail' &&
        (depTask.state === 'failed' || depTask.state === 'cancelled')) {
      cascadeFromId = dep.dependsOnTaskId
      // Don't short-circuit — keep walking so we report a consistent
      // verdict (and in case multiple cascades apply, the first wins).
      break
    }
    if (depTask.state !== 'done') {
      allSatisfied = false
    }
  }
  return { allSatisfied, cascadeFromId }
}

/**
 * Single-task evaluation — useful when the caller has just modified
 * deps for a specific task and wants immediate re-evaluation without
 * waiting for the next sweep. The daemon's `addDependency` flow
 * typically calls this right after dep.add().
 */
export function evaluateBlockedState(rd: ResolverDeps, taskId: string): Task | null {
  const task = rd.tasks.get(taskId)
  if (!task) return null
  if (task.state !== 'queued' && task.state !== 'blocked') return task

  const deps = rd.deps.depsOf(taskId)
  if (deps.length === 0) {
    if (task.state === 'blocked') {
      return rd.tasks.update(taskId, { state: 'queued' })
    }
    return task
  }
  const verdict = evaluateDeps(rd, deps)
  if (verdict.cascadeFromId) {
    return rd.tasks.update(taskId, {
      state: 'cancelled',
      failureReason: `cascaded from must_not_fail dep ${verdict.cascadeFromId}`,
    })
  }
  if (task.state === 'queued' && !verdict.allSatisfied) {
    return rd.tasks.update(taskId, { state: 'blocked' })
  }
  if (task.state === 'blocked' && verdict.allSatisfied) {
    return rd.tasks.update(taskId, { state: 'queued' })
  }
  return task
}

export type { DependencyKind }

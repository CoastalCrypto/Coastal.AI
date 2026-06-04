// packages/planner-agent/src/worker.ts
//
// The planner's worker function. When the daemon claims a plan_task,
// this function:
//
//   1. Calls the decomposer (deterministic or LLM-backed) to produce a Plan
//   2. Submits each step as a new task via the injected submit() function
//   3. Wires up the dependency graph via task_dependencies edges
//   4. Returns a PlanTaskResult describing what was submitted
//
// The planner does NOT wait for the subtasks to finish. It returns
// once they're queued. Downstream observers (mission control,
// curator) track aggregate progress.

import type { Task, TaskInput, TaskDependencyInput } from '@coastal-ai/coordination'
import type { Plan, PlanTaskPayload, PlanTaskResult } from './types.js'

export interface PlannerWorkerConfig {
  /**
   * Decompose a goal into a Plan. Sync or async. The deterministic
   * implementation is in ./deterministic.ts; the LLM-backed one is
   * in ./llm-decompose.ts.
   */
  decompose: (input: PlanTaskPayload) => Plan | Promise<Plan>
  /**
   * Submit a task to the daemon's local board. Returns the created
   * Task (with the assigned id).
   */
  submit: (input: TaskInput) => Promise<Task>
  /**
   * Add a dependency edge. Wired to coordination's DependencyStore.
   */
  addDependency: (dep: TaskDependencyInput) => void
  /**
   * Strategy tag for the result; mostly for observability. Set to 'llm'
   * when wiring the LLM decomposer; default 'deterministic'.
   */
  strategy?: 'deterministic' | 'llm'
}

export function createPlannerWorker(config: PlannerWorkerConfig) {
  const {
    decompose, submit, addDependency,
    strategy = 'deterministic',
  } = config

  return async function plannerWorker(task: { id: string; payload: unknown }): Promise<PlanTaskResult> {
    const payload = task.payload as PlanTaskPayload
    if (!payload || typeof payload.goal !== 'string') {
      throw new Error('planner worker: task.payload.goal must be a string')
    }
    const plan = await decompose(payload)

    // First pass — submit each step with parent_task_id pointing at
    // the plan_task itself, capturing the ref → id mapping.
    const refToId = new Map<string, string>()
    for (const step of plan.steps) {
      const submitted = await submit({
        kind: step.kind,
        payload: step.payload,
        parentTaskId: task.id,
      })
      refToId.set(step.ref, submitted.id)
    }

    // Second pass — wire dependency edges now that all task ids exist.
    for (const step of plan.steps) {
      const fromId = refToId.get(step.ref)!
      if (step.dependsOn) {
        for (const depRef of step.dependsOn) {
          const toId = refToId.get(depRef)
          if (!toId) continue // dangling — should be unreachable after decomposer validation
          addDependency({
            taskId: fromId,
            dependsOnTaskId: toId,
            kind: 'must_complete',
          })
        }
      }
      if (step.cascadesFrom) {
        for (const depRef of step.cascadesFrom) {
          const toId = refToId.get(depRef)
          if (!toId) continue
          addDependency({
            taskId: fromId,
            dependsOnTaskId: toId,
            kind: 'must_not_fail',
          })
        }
      }
    }

    return {
      goal: payload.goal,
      submittedTaskIds: plan.steps.map(s => refToId.get(s.ref)!),
      strategy,
    }
  }
}

/**
 * Claim policy companion to plannerWorker. Matches Task.kind === 'plan_task'.
 */
export function plannerShouldClaim(task: { kind: string }): boolean {
  return task.kind === 'plan_task'
}

// packages/planner-agent/src/types.ts

/** A single step in a decomposition plan. */
export interface PlanStep {
  /** Unique within a plan — used for cross-referencing dependencies. */
  ref: string
  /** Task kind to submit (e.g. 'code_task', 'review_task'). */
  kind: string
  /** Payload for the task. Shape is kind-specific. */
  payload: unknown
  /**
   * Other step refs this step must wait for. Translated to
   * task_dependencies edges with kind='must_complete' on submission.
   */
  dependsOn?: string[]
  /**
   * Refs this step depends on with cascading-failure semantics
   * (must_not_fail). Failure of these cancels this step.
   */
  cascadesFrom?: string[]
}

export interface Plan {
  /** Free-form short label for the plan as a whole. */
  goal: string
  steps: PlanStep[]
}

/** Input payload for a plan_task — what the planner is asked to do. */
export interface PlanTaskPayload {
  /** Natural-language goal. */
  goal: string
  /** Optional language hint, forwarded into code_task payloads. */
  language?: string
}

/** Result emitted by the planner after submitting subtasks. */
export interface PlanTaskResult {
  goal: string
  /** ULIDs of the tasks the planner submitted. */
  submittedTaskIds: string[]
  /** Strategy used: 'deterministic' or 'llm'. */
  strategy: 'deterministic' | 'llm'
}

export const PLAN_TASK_KIND = 'plan_task' as const
export type PlanTaskKind = typeof PLAN_TASK_KIND

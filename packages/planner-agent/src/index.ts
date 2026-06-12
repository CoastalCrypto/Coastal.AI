// packages/planner-agent/src/index.ts

import { registerKind } from '@coastal-ai/core/memory/kinds-registry'
import { PLAN_TASK_KIND } from './types.js'

registerKind(PLAN_TASK_KIND)

export type {
  Plan, PlanStep, PlanTaskPayload, PlanTaskResult, PlanTaskKind,
} from './types.js'

export { PLAN_TASK_KIND } from './types.js'

export { deterministicDecompose } from './deterministic.js'

export {
  createLlmDecomposer,
  type LlmDecomposerConfig,
} from './llm-decompose.js'

export {
  createPlannerWorker,
  plannerShouldClaim,
  type PlannerWorkerConfig,
  type PlannerContext,
} from './worker.js'

// packages/coding-agent/src/index.ts
//
// Public entry point. Side-effect: registers the 'code-task' kind
// with core's kinds-registry — mirrors trading-architect/curator-agent.

import { registerKind } from '@coastal-ai/core/memory/kinds-registry'
import { CODE_TASK_KIND } from './types.js'

registerKind(CODE_TASK_KIND)

export type {
  CodeTaskPayload, CodeTaskResult, CodeTaskKind,
} from './types.js'

export { CODE_TASK_KIND } from './types.js'

export {
  createCoderWorker, coderShouldClaim,
  type CoderWorkerConfig,
} from './worker.js'

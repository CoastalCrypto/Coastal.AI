// packages/reviewing-agent/src/index.ts

import { registerKind } from '@coastal-ai/core/memory/kinds-registry'
import { REVIEW_TASK_KIND } from './types.js'

registerKind(REVIEW_TASK_KIND)

export type {
  ReviewTaskPayload, ReviewTaskResult, ReviewVerdict, ReviewTaskKind,
} from './types.js'

export { REVIEW_TASK_KIND } from './types.js'

export {
  createReviewerWorker, reviewerShouldClaim, parseReviewResponse,
  type ReviewerWorkerConfig,
} from './worker.js'

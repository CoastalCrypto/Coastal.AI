// packages/core/src/architect/types.ts
export const WORK_ITEM_STATUSES = [
  'pending', 'active', 'awaiting_human',
  'merged', 'cancelled', 'error', 'paused',
] as const
export type WorkItemStatus = typeof WORK_ITEM_STATUSES[number]

export const CYCLE_STAGES = [
  'planning', 'plan_review', 'building', 'pr_review', 'done', 'cancelled',
] as const
export type CycleStage = typeof CYCLE_STAGES[number]

// 'built' is the Plan-1 terminal outcome (green build on a branch, no PR yet).
// Plan 2 transitions cycles from 'built' to 'merged' once the PR is created and merged.
export const CYCLE_OUTCOMES = [
  'merged', 'built', 'failed', 'vetoed', 'error', 'revised',
] as const
export type CycleOutcome = typeof CYCLE_OUTCOMES[number]

export const CYCLE_KINDS = ['normal', 'curriculum_scan'] as const
export type CycleKind = typeof CYCLE_KINDS[number]

export const APPROVAL_POLICIES = ['full', 'plan-only', 'pr-only', 'none'] as const
export type ApprovalPolicy = typeof APPROVAL_POLICIES[number]

export const PRIORITIES = ['high', 'normal', 'low'] as const
export type Priority = typeof PRIORITIES[number]

export const SOURCES = [
  'ui', 'markdown', 'skill_md', 'github', 'skill_gap', 'curriculum',
] as const
export type Source = typeof SOURCES[number]

export const FAILURE_KINDS = [
  'parse', 'apply', 'locked', 'budget',
  'lint', 'type', 'build', 'test', 'eval',
  'env_branch', 'env_gh', 'env_push', 'env_perm', 'env_db', 'env_llm',
] as const
export type FailureKind = typeof FAILURE_KINDS[number]

export interface WorkItem {
  id: string
  source: Source
  sourceRef: string | null
  title: string
  body: string
  targetHints: string[] | null
  acceptance: string | null
  budgetLoc: number
  budgetIters: number
  approvalPolicy: ApprovalPolicy
  reviewTimeoutMin: number
  onTimeout: 'revise' | 'reject' | 'auto_approve'
  priority: Priority
  status: WorkItemStatus
  pausedReason: string | null
  pausedAt: number | null
  resumable: boolean
  recurrenceCount: number
  escalatedAt: number | null
  allowSelfModify: boolean
  createdByUserId: string | null
  dedupSignature: string | null
  createdAt: number
  updatedAt: number
}

export interface Cycle {
  id: string
  workItemId: string | null
  kind: CycleKind
  iteration: number
  stage: CycleStage
  planText: string | null
  diffText: string | null
  branchName: string | null
  prUrl: string | null
  testSummary: string | null
  modelUsed: string | null
  failureKind: FailureKind | null
  reviseContext: Record<string, unknown> | null
  durationMs: number | null
  outcome: CycleOutcome | null
  errorMessage: string | null
  createdAt: number
  updatedAt: number
}

export interface Approval {
  id: string
  cycleId: string
  gate: 'plan' | 'diff' | 'merge'
  decision: 'approved' | 'rejected' | 'revised' | 'timeout' | 'auto'
  decisionRevise: boolean
  decidedBy: string | null
  comment: string | null
  createdAt: number
}

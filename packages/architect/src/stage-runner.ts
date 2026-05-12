import type { WorkItem, Cycle, FailureKind } from '@coastal-ai/core/architect/types'
import type { WorkItemStore } from '@coastal-ai/core/architect/store'
import type { CycleStore } from '@coastal-ai/core/architect/cycle-store'
import type { PRCreationResult } from './stages/pr-creation.js'

export interface PlanResult {
  kind: 'ok' | 'soft_fail' | 'hard_fail'
  failureKind?: FailureKind
  message?: string
  plan?: string
  diff?: string
  modelUsed?: string
}

export interface BuildResult {
  kind: 'ok' | 'soft_fail' | 'hard_fail'
  failureKind?: FailureKind
  message?: string
  testSummary?: string
}

export interface ReviseContext {
  reason: string
  failureKind?: FailureKind
  message?: string
  testOutput?: string
}

export interface RunCycleDeps {
  workItem: WorkItem
  workStore: WorkItemStore
  cycleStore: CycleStore
  runPlan: (input: { workItem: WorkItem; reviseContext: ReviseContext | null }) => Promise<PlanResult>
  runBuild: (input: { branchName: string; diff: string }) => Promise<BuildResult>
  isApprovalRequired: (gate: 'plan' | 'pr') => boolean
  runPR?: (input: {
    workItem: WorkItem
    cycle: Cycle
    branchName: string
    planText: string
    diffText: string
    testSummary: string
    modelUsed: string
  }) => Promise<PRCreationResult>
  captureSnapshot?: (opts: { cycleId: string; workItemId: string; capturedBy: string }) => void
  emitEvent?: (type: string, opts: Record<string, unknown>) => void
  autoMerge?: (prUrl: string) => Promise<{ kind: string; message?: string }>
}

export type RunCycleOutcome =
  | { outcome: 'built' }
  | { outcome: 'pr_review' }
  | { outcome: 'cancelled' }
  | { outcome: 'error' }
  | { outcome: 'awaiting_human' }

const COOLDOWN_MS = (iteration: number) => Math.min(2 ** iteration * 1000, 60_000)

export async function runWorkItemCycle(deps: RunCycleDeps): Promise<RunCycleOutcome> {
  const { workItem, workStore, cycleStore } = deps

  workStore.updateStatus(workItem.id, 'active')

  let priorCycleId: string | null = null
  let priorReviseContext: ReviseContext | null = null
  let iteration = 1

  while (iteration <= workItem.budgetIters) {
    if (iteration > 1) {
      await new Promise(r => setTimeout(r, COOLDOWN_MS(iteration - 1)))
    }

    // Loop invariant: priorReviseContext is set together with priorCycleId
    // at the soft_fail branches below. When priorCycleId is truthy here,
    // priorReviseContext is non-null. The ! reflects that invariant.
    const cycle: Cycle = priorCycleId
      ? cycleStore.startRevise(workItem.id, priorCycleId, priorReviseContext!)
      : cycleStore.start(workItem.id)

    iteration = cycle.iteration

    // PLAN
    const plan = await deps.runPlan({ workItem, reviseContext: priorReviseContext })

    if (plan.kind === 'hard_fail') {
      cycleStore.terminate(cycle.id, {
        outcome: 'error',
        failureKind: plan.failureKind,
        errorMessage: plan.message,
      })
      workStore.updateStatus(workItem.id, 'error', { pausedReason: plan.message })
      return { outcome: 'error' }
    }

    if (plan.kind === 'soft_fail') {
      cycleStore.terminate(cycle.id, {
        outcome: 'revised',
        failureKind: plan.failureKind,
        errorMessage: plan.message,
      })
      priorCycleId = cycle.id
      priorReviseContext = { reason: 'plan_failed', failureKind: plan.failureKind, message: plan.message }
      iteration++
      continue
    }

    // PLAN OK — check if approval gate required
    if (deps.isApprovalRequired('plan')) {
      cycleStore.setStage(cycle.id, 'plan_review')
      workStore.updateStatus(workItem.id, 'awaiting_human')
      return { outcome: 'awaiting_human' }
    }

    cycleStore.setStage(cycle.id, 'building')

    // BUILD
    const branchName = `feature/architect/${workItem.id.slice(-8)}-${slug(workItem.title)}`
    const build = await deps.runBuild({ branchName, diff: plan.diff! })

    if (build.kind === 'hard_fail') {
      cycleStore.terminate(cycle.id, {
        outcome: 'error',
        failureKind: build.failureKind,
        errorMessage: build.message,
        planText: plan.plan,
        diffText: plan.diff,
        modelUsed: plan.modelUsed,
        branchName,
      })
      workStore.updateStatus(workItem.id, 'error', { pausedReason: build.message })
      return { outcome: 'error' }
    }

    if (build.kind === 'soft_fail') {
      cycleStore.terminate(cycle.id, {
        outcome: 'revised',
        failureKind: build.failureKind,
        errorMessage: build.message,
        planText: plan.plan,
        diffText: plan.diff,
        modelUsed: plan.modelUsed,
        branchName,
      })
      priorCycleId = cycle.id
      priorReviseContext = {
        reason: 'build_failed',
        failureKind: build.failureKind,
        testOutput: build.message,
      }
      iteration++
      continue
    }

    // BUILD OK — capture snapshot, then create PR if wired
    deps.captureSnapshot?.({ cycleId: cycle.id, workItemId: workItem.id, capturedBy: 'auto:building' })
    deps.emitEvent?.('build_ok', { cycleId: cycle.id, workItemId: workItem.id })

    if (deps.runPR) {
      const pr = await deps.runPR({
        workItem, cycle, branchName,
        planText: plan.plan!, diffText: plan.diff!,
        testSummary: build.testSummary!, modelUsed: plan.modelUsed!,
      })

      if (pr.kind === 'hard_fail') {
        cycleStore.terminate(cycle.id, {
          outcome: 'error',
          failureKind: pr.failureKind,
          errorMessage: pr.message,
          planText: plan.plan,
          diffText: plan.diff,
          modelUsed: plan.modelUsed,
          branchName,
          testSummary: build.testSummary,
        })
        workStore.updateStatus(workItem.id, 'error', { pausedReason: pr.message })
        deps.emitEvent?.('pr_failed', { cycleId: cycle.id, workItemId: workItem.id, failureKind: pr.failureKind })
        return { outcome: 'error' }
      }

      // PR created successfully
      cycleStore.terminate(cycle.id, {
        outcome: 'built',
        planText: plan.plan,
        diffText: plan.diff,
        modelUsed: plan.modelUsed,
        branchName,
        testSummary: build.testSummary,
        prUrl: pr.prUrl,
      })
      cycleStore.setStage(cycle.id, 'pr_review')
      deps.emitEvent?.('pr_created', { cycleId: cycle.id, workItemId: workItem.id, prUrl: pr.prUrl })

      // Auto-merge for 'none' approval policy
      if (workItem.approvalPolicy === 'none' && deps.autoMerge) {
        await deps.autoMerge(pr.prUrl)
      }

      workStore.updateStatus(workItem.id, 'awaiting_human')
      return { outcome: 'pr_review' }
    }

    // No PR stage wired (Plan 1 fallback)
    cycleStore.terminate(cycle.id, {
      outcome: 'built',
      planText: plan.plan,
      diffText: plan.diff,
      modelUsed: plan.modelUsed,
      branchName,
      testSummary: build.testSummary,
    })
    workStore.updateStatus(workItem.id, 'awaiting_human')
    return { outcome: 'built' }
  }

  // Budget exhausted
  workStore.updateStatus(workItem.id, 'cancelled')
  return { outcome: 'cancelled' }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
}

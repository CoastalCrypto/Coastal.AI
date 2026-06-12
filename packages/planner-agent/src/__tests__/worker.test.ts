// packages/planner-agent/src/__tests__/worker.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import {
  openCoordinationDb, TaskStore, ClaimStore, DependencyStore,
  resolveDependencies, type Task, type TaskInput, type TaskDependencyInput,
} from '@coastal-ai/coordination'
import {
  createPlannerWorker, plannerShouldClaim,
  deterministicDecompose, PLAN_TASK_KIND,
  type PlannerContext,
} from '../index.js'
import type { PlanTaskPayload } from '../types.js'

describe('plannerShouldClaim', () => {
  it('matches plan_task', () => {
    expect(plannerShouldClaim({ kind: PLAN_TASK_KIND })).toBe(true)
    expect(plannerShouldClaim({ kind: 'plan_task' })).toBe(true)
  })
  it('rejects other kinds', () => {
    expect(plannerShouldClaim({ kind: 'code_task' })).toBe(false)
    expect(plannerShouldClaim({ kind: 'review_task' })).toBe(false)
  })
})

describe('deterministicDecompose', () => {
  it('produces a code → review plan with dependency', () => {
    const plan = deterministicDecompose({ goal: 'build hello world' })
    expect(plan.steps).toHaveLength(2)
    expect(plan.steps[0].kind).toBe('code_task')
    expect(plan.steps[1].kind).toBe('review_task')
    expect(plan.steps[1].dependsOn).toEqual(['code'])
  })

  it('forwards the language hint', () => {
    const plan = deterministicDecompose({ goal: 'x', language: 'rust' })
    const codePayload = plan.steps[0].payload as { language?: string }
    expect(codePayload.language).toBe('rust')
  })
})

describe('createPlannerWorker (integration with real coordination stores)', () => {
  let tasks: TaskStore
  let claims: ClaimStore
  let deps: DependencyStore
  let plannerTaskId: string
  let ctx: PlannerContext

  beforeEach(() => {
    const db = openCoordinationDb()
    tasks = new TaskStore(db)
    claims = new ClaimStore(db)
    deps = new DependencyStore(db)
    // submit/addDependency now arrive via the daemon's WorkerContext at
    // call time. The test synthesises the same two capabilities over the
    // real stores — exactly what CoordinationDaemon.workerContext() does.
    ctx = {
      submit: async (input: TaskInput): Promise<Task> => tasks.create(input),
      addDependency: (dep: TaskDependencyInput) => { deps.add(dep) },
    }
    // The plan_task itself must exist before the worker runs (the
    // daemon would have created it via submit).
    const planTask = tasks.create({
      kind: 'plan_task',
      payload: { goal: 'placeholder' } satisfies PlanTaskPayload,
    })
    plannerTaskId = planTask.id
  })

  function makeWorker(strategy: 'deterministic' | 'llm' = 'deterministic') {
    return createPlannerWorker({
      decompose: deterministicDecompose,
      strategy,
    })
  }

  it('submits a code + review pair with parent linkage and dep edge', async () => {
    const worker = makeWorker()
    const result = await worker({
      id: plannerTaskId,
      payload: { goal: 'create a Rust HTTP server' } satisfies PlanTaskPayload,
    }, ctx)

    expect(result.submittedTaskIds).toHaveLength(2)

    const [codeTaskId, reviewTaskId] = result.submittedTaskIds
    const codeTask = tasks.get(codeTaskId)!
    const reviewTask = tasks.get(reviewTaskId)!
    expect(codeTask.kind).toBe('code_task')
    expect(reviewTask.kind).toBe('review_task')
    expect(codeTask.parentTaskId).toBe(plannerTaskId)
    expect(reviewTask.parentTaskId).toBe(plannerTaskId)

    // Dependency edge exists
    const reviewDeps = deps.depsOf(reviewTaskId)
    expect(reviewDeps).toHaveLength(1)
    expect(reviewDeps[0].dependsOnTaskId).toBe(codeTaskId)
    expect(reviewDeps[0].kind).toBe('must_complete')
  })

  it('the dependency resolver moves review → blocked while code is queued', async () => {
    const worker = makeWorker()
    const result = await worker({
      id: plannerTaskId,
      payload: { goal: 'x' } satisfies PlanTaskPayload,
    }, ctx)
    const [codeTaskId, reviewTaskId] = result.submittedTaskIds

    // Run the resolver — code is still queued, so review should be blocked
    const sweep = resolveDependencies({
      db: (tasks as unknown as { db: import('better-sqlite3').Database }).db,
      tasks, deps,
    })
    expect(sweep.blocked.map(t => t.id)).toContain(reviewTaskId)
    expect(tasks.get(reviewTaskId)?.state).toBe('blocked')
    expect(tasks.get(codeTaskId)?.state).toBe('queued')
  })

  it('the dependency resolver unblocks review when code is done', async () => {
    const worker = makeWorker()
    const result = await worker({
      id: plannerTaskId,
      payload: { goal: 'x' } satisfies PlanTaskPayload,
    }, ctx)
    const [codeTaskId, reviewTaskId] = result.submittedTaskIds

    // First sweep — review goes blocked
    const db = (tasks as unknown as { db: import('better-sqlite3').Database }).db
    resolveDependencies({ db, tasks, deps })
    expect(tasks.get(reviewTaskId)?.state).toBe('blocked')

    // Complete the code task
    tasks.update(codeTaskId, { state: 'claimed', ownerAgentId: 'coder' })
    tasks.update(codeTaskId, { state: 'done', result: { output: '...' }, ownerAgentId: null })

    // Second sweep — review should unblock
    const sweep = resolveDependencies({ db, tasks, deps })
    expect(sweep.unblocked.map(t => t.id)).toContain(reviewTaskId)
    expect(tasks.get(reviewTaskId)?.state).toBe('queued')
  })

  it('cascade-cancels review when code fails (must_not_fail variant)', async () => {
    const worker = createPlannerWorker({
      decompose: () => ({
        goal: 'x',
        steps: [
          { ref: 'a', kind: 'code_task', payload: { request: 'a' } },
          { ref: 'b', kind: 'review_task', payload: { request: 'b' }, cascadesFrom: ['a'] },
        ],
      }),
    })
    const result = await worker({
      id: plannerTaskId,
      payload: { goal: 'x' } satisfies PlanTaskPayload,
    }, ctx)
    const [aId, bId] = result.submittedTaskIds

    const db = (tasks as unknown as { db: import('better-sqlite3').Database }).db
    resolveDependencies({ db, tasks, deps })
    expect(tasks.get(bId)?.state).toBe('blocked')

    // Fail the code task
    tasks.update(aId, { state: 'claimed', ownerAgentId: 'coder' })
    tasks.update(aId, { state: 'failed', failureReason: 'oops', ownerAgentId: null })

    // Resolver should cascade-cancel b
    const sweep = resolveDependencies({ db, tasks, deps })
    expect(sweep.cascaded.map(t => t.id)).toContain(bId)
    expect(tasks.get(bId)?.state).toBe('cancelled')
    expect(tasks.get(bId)?.failureReason).toMatch(/cascaded/)
  })

  it('rejects payload without a goal string', async () => {
    const worker = makeWorker()
    await expect(
      worker({ id: plannerTaskId, payload: {} as unknown }, ctx),
    ).rejects.toThrow(/goal/)
  })

  it('tags the result strategy', async () => {
    const worker = makeWorker('llm')
    const result = await worker({
      id: plannerTaskId,
      payload: { goal: 'x' } satisfies PlanTaskPayload,
    }, ctx)
    expect(result.strategy).toBe('llm')
  })
})

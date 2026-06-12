// packages/swarm-demos/examples/full-stack-demo.ts
//
// The whole stack in one process:
//
//   main      — submits a plan_task and waits
//   planner   — claims plan_task, decomposes goal into code+review subtasks
//                with a must_complete dependency edge
//   coder     — claims code_task, runs stub LLM, returns code
//   reviewer  — claims review_task (gated on code being 'done' by the
//                dependency resolver), runs stub LLM, returns review
//
// All four daemons run on separate SQLite DBs synced only via A2A
// broadcasts. A 100ms-interval timer drives the dependency resolver
// on each DB so 'blocked' tasks transition to 'queued' once their
// dependencies clear.
//
// Run with:
//   pnpm --filter @coastal-ai/swarm-demos demo:full

import {
  openCoordinationDb, TaskStore, ClaimStore, DependencyStore,
  generateIdentity,
  LocalhostBus, createLocalhostTransport,
  CoordinationDaemon,
  createReplicator,
  resolveDependencies,
} from '@coastal-ai/coordination'

import type { LlmClient, ChatRequest, ChatResponse, ChatStreamChunk } from '@coastal-ai/llm-client'

import { createCoderWorker, coderShouldClaim } from '@coastal-ai/coding-agent'
import { createReviewerWorker, reviewerShouldClaim } from '@coastal-ai/reviewing-agent'
import {
  createPlannerWorker, plannerShouldClaim, deterministicDecompose,
} from '@coastal-ai/planner-agent'

// ─── stub LLM that returns canned responses based on system prompt ────

function stubLlmClient(): LlmClient {
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const sys = req.messages.find(m => m.role === 'system')?.content ?? ''
      let content: string
      if (sys.includes('senior code reviewer')) {
        content = [
          'VERDICT: approve',
          'SUMMARY: Looks clean and idiomatic, ships error handling at boundaries.',
          'ISSUES:',
          '- none',
        ].join('\n')
      } else if (sys.includes('senior software engineer')) {
        content = [
          'fn main() {',
          '    println!("Hello, Coastal.AI!");',
          '}',
        ].join('\n')
      } else {
        content = 'ok'
      }
      return {
        message: { role: 'assistant', content },
        finishReason: 'stop',
        modelUsed: req.model,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }
    },
    chatStream(_req: ChatRequest): AsyncIterable<ChatStreamChunk> {
      throw new Error('stub does not stream')
    },
  }
}

function header(label: string): void {
  console.log(`\n${'═'.repeat(64)}`)
  console.log(`  ${label}`)
  console.log('═'.repeat(64))
}

async function main(): Promise<void> {
  header('Coastal.AI full-stack swarm demo')
  console.log('main → planner → (coder, reviewer w/ dep) — all on separate DBs.')

  // ── identities ──────────────────────────────────────────────────────

  const bus = new LocalhostBus()
  const mainId = generateIdentity('main')
  const plannerId = generateIdentity('planner')
  const coderId = generateIdentity('coder')
  const reviewerId = generateIdentity('reviewer')

  // ── per-daemon stores ──────────────────────────────────────────────

  function makeNode(name: string) {
    const db = openCoordinationDb()
    return {
      name,
      db,
      tasks: new TaskStore(db),
      claims: new ClaimStore(db),
      deps: new DependencyStore(db),
    }
  }
  const mainNode = makeNode('main')
  const plannerNode = makeNode('planner')
  const coderNode = makeNode('coder')
  const reviewerNode = makeNode('reviewer')

  // ── transports ──────────────────────────────────────────────────────

  const tMain = createLocalhostTransport({ bus, identity: mainId })
  const tPlanner = createLocalhostTransport({ bus, identity: plannerId })
  const tCoder = createLocalhostTransport({ bus, identity: coderId })
  const tReviewer = createLocalhostTransport({ bus, identity: reviewerId })

  // ── daemons ─────────────────────────────────────────────────────────

  const client = stubLlmClient()

  const main_ = new CoordinationDaemon({
    identity: mainId,
    transport: tMain,
    db: mainNode.db, tasks: mainNode.tasks, claims: mainNode.claims,
    worker: async () => { throw new Error('main does not run tasks') },
    heartbeatIntervalMs: 0,
  })

  // The planner submits its subtasks through the daemon's WorkerContext:
  // ctx.submit() broadcasts them (so peers can auto-claim), and
  // ctx.addDependency() writes dep edges (which needs the deps store
  // wired below). That lets it run as an ordinary worker — no
  // forward-reference back to its own daemon.
  const planner = new CoordinationDaemon({
    identity: plannerId,
    transport: tPlanner,
    db: plannerNode.db, tasks: plannerNode.tasks, claims: plannerNode.claims,
    deps: plannerNode.deps,
    worker: createPlannerWorker({ decompose: deterministicDecompose }),
    shouldClaim: plannerShouldClaim,
    heartbeatIntervalMs: 0,
  })

  const coder = new CoordinationDaemon({
    identity: coderId,
    transport: tCoder,
    db: coderNode.db, tasks: coderNode.tasks, claims: coderNode.claims,
    worker: createCoderWorker({ client, defaultModel: 'qwen2.5-coder-7b' }),
    shouldClaim: coderShouldClaim,
    heartbeatIntervalMs: 0,
  })

  const reviewer = new CoordinationDaemon({
    identity: reviewerId,
    transport: tReviewer,
    db: reviewerNode.db, tasks: reviewerNode.tasks, claims: reviewerNode.claims,
    worker: createReviewerWorker({ client, defaultModel: 'deepseek-coder-v2-lite' }),
    shouldClaim: reviewerShouldClaim,
    heartbeatIntervalMs: 0,
  })

  // ── replicators (broadcasts → local DBs on each node) ──────────────

  const reps = [
    createReplicator({ transport: tMain, db: mainNode.db, tasks: mainNode.tasks, claims: mainNode.claims, selfAgentId: 'main' }),
    createReplicator({ transport: tPlanner, db: plannerNode.db, tasks: plannerNode.tasks, claims: plannerNode.claims, selfAgentId: 'planner' }),
    createReplicator({ transport: tCoder, db: coderNode.db, tasks: coderNode.tasks, claims: coderNode.claims, selfAgentId: 'coder' }),
    createReplicator({ transport: tReviewer, db: reviewerNode.db, tasks: reviewerNode.tasks, claims: reviewerNode.claims, selfAgentId: 'reviewer' }),
  ]

  // ── dependency resolver ticks ──────────────────────────────────────
  //
  // Each node's resolver only operates on its own DB. The reviewer's
  // DB is the one where 'blocked → queued' transitions matter because
  // reviewer is the one that auto-claims review_task. We tick all four
  // anyway for simplicity / observability.

  const nodes = [mainNode, plannerNode, coderNode, reviewerNode]
  const resolverTimer = setInterval(() => {
    for (const node of nodes) {
      try {
        resolveDependencies({ db: node.db, tasks: node.tasks, deps: node.deps })
      } catch { /* swallow — concurrent writes may collide briefly */ }
    }
  }, 50)

  // ── kick it off ────────────────────────────────────────────────────

  header('Submitting plan_task: "Build a hello world Rust program"')
  const planTask = await main_.submit({
    kind: 'plan_task',
    payload: { goal: 'Build a hello world Rust program', language: 'rust' },
  })
  console.log(`  + plan_task ${planTask.id}`)

  // ── wait for the swarm to drain ────────────────────────────────────

  console.log('\nWaiting for the swarm to drain...')
  await new Promise(r => setTimeout(r, 800))

  clearInterval(resolverTimer)

  // ── summary ────────────────────────────────────────────────────────

  for (const node of nodes) {
    header(`Final state — ${node.name} DB`)
    const allTasks = node.tasks.listAll()
    if (allTasks.length === 0) {
      console.log('  (empty)')
      continue
    }
    for (const t of allTasks) {
      const history = node.claims.history(t.id)
      const chain = history.length > 0
        ? history.map(c => `${c.agentId}:${c.releaseReason ?? 'active'}`).join(' → ')
        : '(unclaimed)'
      console.log(
        `  ${t.id}  state=${t.state.padEnd(9)} kind=${t.kind.padEnd(11)} ` +
        `${chain}`,
      )
    }
  }

  // ── convergence check ─────────────────────────────────────────────

  header('Convergence')
  // Find the plan_task + its subtasks. Use planner's DB as source of truth.
  const plannerView = plannerNode.tasks.listChildren(planTask.id)
  const allDone = plannerView.every(t => t.state === 'done')
  console.log(`  Plan: ${planTask.id}`)
  console.log(`  Subtasks: ${plannerView.length} (${plannerView.map(t => t.kind).join(', ')})`)
  console.log(`  All subtasks done: ${allDone ? '✓' : '✗'}`)

  // ── cleanup ────────────────────────────────────────────────────────

  for (const r of reps) r.stop()
  await main_.stop()
  await planner.stop()
  await coder.stop()
  await reviewer.stop()

  process.exit(allDone ? 0 : 1)
}

main().catch((err) => {
  console.error('full-stack demo failed:', err)
  process.exit(1)
})

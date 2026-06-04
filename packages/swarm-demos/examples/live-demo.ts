// packages/swarm-demos/examples/live-demo.ts
//
// Run forever. Open http://localhost:<port> in a browser. Watch the
// swarm work in real time.
//
//   pnpm --filter @coastal-ai/swarm-demos demo:live
//
// Every 5 seconds the demo submits a new plan_task. The planner
// decomposes it into a code + review pair with a must_complete
// dependency. The coder claims the code task, runs a stub LLM,
// completes. The dependency resolver unblocks the review task.
// The reviewer claims it, runs a stub LLM, completes.
//
// Mission control's HTTP server exposes the live view at
// http://localhost:<port>/ — the dashboard auto-refreshes via SSE
// every time a state-change broadcast happens.
//
// Ctrl-C to exit. The shutdown handler closes everything cleanly.

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

import { createMissionControl } from '@coastal-ai/mission-control'

// ─── stub LLM that returns canned responses based on system prompt ────

function stubLlmClient(): LlmClient {
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const sys = req.messages.find(m => m.role === 'system')?.content ?? ''
      // Add some artificial latency so the dashboard has time to render
      // intermediate states (claimed → done).
      await new Promise(r => setTimeout(r, 800 + Math.random() * 700))
      let content: string
      if (sys.includes('senior code reviewer')) {
        content = [
          'VERDICT: approve',
          'SUMMARY: Looks clean, idiomatic error handling.',
          'ISSUES:',
          '- none',
        ].join('\n')
      } else if (sys.includes('senior software engineer')) {
        content = `fn main() {\n    println!("Hello, world!");\n}`
      } else {
        content = 'ok'
      }
      return {
        message: { role: 'assistant', content },
        finishReason: 'stop',
        modelUsed: req.model,
        usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
      }
    },
    chatStream(_req: ChatRequest): AsyncIterable<ChatStreamChunk> {
      throw new Error('stub does not stream')
    },
  }
}

const SUBMIT_INTERVAL_MS = 5000
const GOALS = [
  'Build a hello world Rust program',
  'Write a fizzbuzz function in Go',
  'Implement a binary search in TypeScript',
  'Create a tiny HTTP server in Python',
  'Build a queue data structure in C',
]

async function main(): Promise<void> {
  // ── topology setup ─────────────────────────────────────────────────

  const bus = new LocalhostBus()
  const mainId = generateIdentity('main')
  const plannerId = generateIdentity('planner')
  const coderId = generateIdentity('coder')
  const reviewerId = generateIdentity('reviewer')

  function makeNode(name: string) {
    const db = openCoordinationDb()
    return {
      name, db,
      tasks: new TaskStore(db),
      claims: new ClaimStore(db),
      deps: new DependencyStore(db),
    }
  }
  const mainNode = makeNode('main')
  const plannerNode = makeNode('planner')
  const coderNode = makeNode('coder')
  const reviewerNode = makeNode('reviewer')

  const tMain = createLocalhostTransport({ bus, identity: mainId })
  const tPlanner = createLocalhostTransport({ bus, identity: plannerId })
  const tCoder = createLocalhostTransport({ bus, identity: coderId })
  const tReviewer = createLocalhostTransport({ bus, identity: reviewerId })

  const llmClient = stubLlmClient()

  const mainDaemon = new CoordinationDaemon({
    identity: mainId, transport: tMain,
    db: mainNode.db, tasks: mainNode.tasks, claims: mainNode.claims,
    worker: async () => { throw new Error('main does not run tasks') },
    heartbeatIntervalMs: 0,
  })

  const planner = new CoordinationDaemon({
    identity: plannerId, transport: tPlanner,
    db: plannerNode.db, tasks: plannerNode.tasks, claims: plannerNode.claims,
    deps: plannerNode.deps,
    worker: createPlannerWorker({ decompose: deterministicDecompose }),
    shouldClaim: plannerShouldClaim,
    heartbeatIntervalMs: 0,
  })

  const coder = new CoordinationDaemon({
    identity: coderId, transport: tCoder,
    db: coderNode.db, tasks: coderNode.tasks, claims: coderNode.claims,
    worker: createCoderWorker({ client: llmClient, defaultModel: 'qwen2.5-coder-7b' }),
    shouldClaim: coderShouldClaim,
    heartbeatIntervalMs: 0,
  })

  const reviewer = new CoordinationDaemon({
    identity: reviewerId, transport: tReviewer,
    db: reviewerNode.db, tasks: reviewerNode.tasks, claims: reviewerNode.claims,
    worker: createReviewerWorker({ client: llmClient, defaultModel: 'deepseek-coder-v2-lite' }),
    shouldClaim: reviewerShouldClaim,
    heartbeatIntervalMs: 0,
  })

  const reps = [
    createReplicator({ transport: tMain, db: mainNode.db, tasks: mainNode.tasks, claims: mainNode.claims, selfAgentId: 'main' }),
    createReplicator({ transport: tPlanner, db: plannerNode.db, tasks: plannerNode.tasks, claims: plannerNode.claims, selfAgentId: 'planner' }),
    createReplicator({ transport: tCoder, db: coderNode.db, tasks: coderNode.tasks, claims: coderNode.claims, selfAgentId: 'coder' }),
    createReplicator({ transport: tReviewer, db: reviewerNode.db, tasks: reviewerNode.tasks, claims: reviewerNode.claims, selfAgentId: 'reviewer' }),
  ]

  const nodes = [mainNode, plannerNode, coderNode, reviewerNode]
  const resolverTimer = setInterval(() => {
    for (const node of nodes) {
      try { resolveDependencies({ db: node.db, tasks: node.tasks, deps: node.deps }) } catch { /* swallow */ }
    }
  }, 100)

  // ── mission control HTTP server ────────────────────────────────────

  const mc = await createMissionControl({
    db: mainNode.db,
    port: 0, // OS picks an ephemeral port
    bindAddress: '127.0.0.1',
    subscribe: (h) => tMain.subscribe(h),
    submit: async (input) => mainDaemon.submit(input),
    corsOrigins: ['*'], // permissive for browser access
  })

  const port = mc.port()
  const dashboardUrl = `http://localhost:${port}/`

  console.log('')
  console.log('  ╔══════════════════════════════════════════════════════════╗')
  console.log('  ║                                                          ║')
  console.log('  ║          Coastal.AI Mission Control is live              ║')
  console.log('  ║                                                          ║')
  console.log('  ║   Open in your browser:                                  ║')
  console.log(`  ║     ${dashboardUrl.padEnd(53)}║`)
  console.log('  ║                                                          ║')
  console.log('  ║   Submitting a new plan_task every 5 seconds.            ║')
  console.log('  ║   Ctrl-C to stop.                                        ║')
  console.log('  ║                                                          ║')
  console.log('  ╚══════════════════════════════════════════════════════════╝')
  console.log('')

  // ── submitter loop ─────────────────────────────────────────────────

  let goalIndex = 0
  const submitterTimer = setInterval(async () => {
    const goal = GOALS[goalIndex % GOALS.length]
    goalIndex += 1
    try {
      const task = await mainDaemon.submit({
        kind: 'plan_task',
        payload: { goal, language: 'rust' },
      })
      console.log(`[${new Date().toISOString().slice(11, 19)}] submitted plan_task ${task.id} "${goal}"`)
    } catch (err) {
      console.error('submit failed:', (err as Error).message)
    }
  }, SUBMIT_INTERVAL_MS)

  // First task immediately
  void mainDaemon.submit({
    kind: 'plan_task',
    payload: { goal: GOALS[0], language: 'rust' },
  }).then(t => console.log(`[${new Date().toISOString().slice(11, 19)}] submitted plan_task ${t.id} "${GOALS[0]}"`))

  // ── cleanup on Ctrl-C ──────────────────────────────────────────────

  let shuttingDown = false
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n[${signal}] shutting down...`)
    clearInterval(submitterTimer)
    clearInterval(resolverTimer)
    for (const r of reps) r.stop()
    await mc.stop()
    await mainDaemon.stop()
    await planner.stop()
    await coder.stop()
    await reviewer.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch(err => {
  console.error('live demo failed:', err)
  process.exit(1)
})

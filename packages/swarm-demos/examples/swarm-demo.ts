// packages/swarm-demos/examples/swarm-demo.ts
//
// Runnable end-to-end demo of the Coastal.AI multi-agent stack.
//
// Spins up three CoordinationDaemons in one process — main + coder
// + reviewer — each with its own SQLite database and its own A2A
// transport. State sync between them is via the broadcast-based
// Replicator only; no shared filesystem, no RPC. This is the same
// shape that Phase 4 ships across 12 BC-250 nodes — the only
// difference is the LocalhostBus stands in for the real TCP+mDNS
// network.
//
// Run with:
//   pnpm --filter @coastal-ai/swarm-demos demo
//
// Expected outcome (typical, depends on scheduler luck):
//   - main submits 6 tasks: 3 of kind 'code', 3 of kind 'review'
//   - coder auto-claims the 3 code tasks, runs its stub worker, completes
//   - reviewer auto-claims the 3 review tasks, runs its stub worker, completes
//   - all three nodes converge to identical state (6 done tasks each)
//   - the final summary lists every claim with its lifecycle

import {
  openCoordinationDb, TaskStore, ClaimStore,
  generateIdentity,
  LocalhostBus, createLocalhostTransport,
  CoordinationDaemon,
  createReplicator,
  type Task,
} from '@coastal-ai/coordination'

function flush(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function header(label: string): void {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ${label}`)
  console.log('═'.repeat(60))
}

async function main(): Promise<void> {
  header('Coastal.AI swarm demo')
  console.log('Three nodes, three SQLite DBs, broadcast-based replication.')

  // ── 1. shared bus + three identities ──────────────────────────────

  const bus = new LocalhostBus()
  const mainId = generateIdentity('main')
  const coderId = generateIdentity('coder')
  const reviewerId = generateIdentity('reviewer')

  // ── 2. three separate DBs (the Phase 4 shape, single-process) ─────

  const mainDb = openCoordinationDb()
  const coderDb = openCoordinationDb()
  const reviewerDb = openCoordinationDb()

  const mainTasks = new TaskStore(mainDb)
  const mainClaims = new ClaimStore(mainDb)
  const coderTasks = new TaskStore(coderDb)
  const coderClaims = new ClaimStore(coderDb)
  const reviewerTasks = new TaskStore(reviewerDb)
  const reviewerClaims = new ClaimStore(reviewerDb)

  // ── 3. transports (echo:true on main so its own replicator can apply
  //                     events too if we wired one — we don't here) ──

  const mainTransport = createLocalhostTransport({ bus, identity: mainId })
  const coderTransport = createLocalhostTransport({ bus, identity: coderId })
  const reviewerTransport = createLocalhostTransport({ bus, identity: reviewerId })

  // ── 4. daemons ────────────────────────────────────────────────────

  const main = new CoordinationDaemon({
    identity: mainId,
    transport: mainTransport,
    db: mainDb, tasks: mainTasks, claims: mainClaims,
    worker: async () => { throw new Error('Main does not run tasks') },
    heartbeatIntervalMs: 0,
  })

  const coder = new CoordinationDaemon({
    identity: coderId,
    transport: coderTransport,
    db: coderDb, tasks: coderTasks, claims: coderClaims,
    worker: async (task: Task) => ({
      role: 'coder',
      generated: `// stub code for task ${task.id}\nfunction handle() { return ${JSON.stringify(task.payload)} }`,
    }),
    shouldClaim: (t) => t.kind === 'code',
    heartbeatIntervalMs: 0,
  })

  const reviewer = new CoordinationDaemon({
    identity: reviewerId,
    transport: reviewerTransport,
    db: reviewerDb, tasks: reviewerTasks, claims: reviewerClaims,
    worker: async (task: Task) => ({
      role: 'reviewer',
      verdict: 'looks good',
      summary: `reviewed task ${task.id}`,
    }),
    shouldClaim: (t) => t.kind === 'review',
    heartbeatIntervalMs: 0,
  })

  // ── 5. replication: workers follow main + each other ──────────────

  const coderReplicator = createReplicator({
    transport: coderTransport,
    db: coderDb, tasks: coderTasks, claims: coderClaims,
    selfAgentId: 'coder',
  })
  const reviewerReplicator = createReplicator({
    transport: reviewerTransport,
    db: reviewerDb, tasks: reviewerTasks, claims: reviewerClaims,
    selfAgentId: 'reviewer',
  })
  // Main also follows worker broadcasts (task.claim, task.complete) so
  // main's local DB stays in sync with what workers are doing.
  const mainReplicator = createReplicator({
    transport: mainTransport,
    db: mainDb, tasks: mainTasks, claims: mainClaims,
    selfAgentId: 'main',
  })

  header('Submitting 6 tasks (3 code + 3 review)')

  const submitted: Task[] = []
  for (let i = 0; i < 3; i++) {
    submitted.push(await main.submit({
      kind: 'code',
      payload: { feature: `auth-${i}`, priority: i },
    }))
  }
  for (let i = 0; i < 3; i++) {
    submitted.push(await main.submit({
      kind: 'review',
      payload: { module: `auth-${i}`, depth: 'deep' },
    }))
  }
  for (const t of submitted) {
    console.log(`  + ${t.id}  (kind=${t.kind})`)
  }

  console.log('\nWaiting for the swarm to drain...')
  await flush(400)

  // ── 6. summary ────────────────────────────────────────────────────

  header('Final state — main DB')
  printDb(mainTasks, mainClaims, submitted)

  header('Final state — coder DB (replicated)')
  printDb(coderTasks, coderClaims, submitted)

  header('Final state — reviewer DB (replicated)')
  printDb(reviewerTasks, reviewerClaims, submitted)

  header('Convergence check')
  const allConverged = submitted.every(t => {
    const a = mainTasks.get(t.id)
    const b = coderTasks.get(t.id)
    const c = reviewerTasks.get(t.id)
    return a?.state === 'done' && b?.state === 'done' && c?.state === 'done'
  })
  console.log(allConverged
    ? '  ✓ All 6 tasks reached "done" on every node — swarm converged.'
    : '  ✗ Not all tasks converged — replication or claim timing issue.')

  // ── 7. cleanup ────────────────────────────────────────────────────

  coderReplicator.stop()
  reviewerReplicator.stop()
  mainReplicator.stop()
  await main.stop()
  await coder.stop()
  await reviewer.stop()

  process.exit(allConverged ? 0 : 1)
}

function printDb(tasks: TaskStore, claims: ClaimStore, originals: Task[]): void {
  for (const orig of originals) {
    const live = tasks.get(orig.id)
    if (!live) {
      console.log(`  ${orig.id}  ✗ MISSING`)
      continue
    }
    const claimHistory = claims.history(live.id)
    const ownerNote = claimHistory.length > 0
      ? claimHistory.map(c => `${c.agentId}:${c.releaseReason ?? 'active'}`).join(' → ')
      : '(unclaimed)'
    console.log(
      `  ${live.id}  state=${live.state.padEnd(8)} kind=${live.kind.padEnd(8)} ` +
      `claims: ${ownerNote}`,
    )
  }
}

main().catch((err) => {
  console.error('demo failed:', err)
  process.exit(1)
})

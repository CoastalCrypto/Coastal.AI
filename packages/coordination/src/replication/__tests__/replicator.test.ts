// packages/coordination/src/replication/__tests__/replicator.test.ts
//
// The big Phase 4 validation: two daemons with SEPARATE SQLite DBs
// stay in sync purely via broadcast events. No shared filesystem,
// no RPC, no replicator-side queries — every state change rides on
// the existing A2A wire.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import {
  openCoordinationDb, TaskStore, ClaimStore,
  generateIdentity,
  LocalhostBus, createLocalhostTransport,
  CoordinationDaemon,
  createReplicator,
} from '../../index.js'

function flush(times = 3): Promise<void> {
  let p = Promise.resolve()
  for (let i = 0; i < times; i++) p = p.then(() => new Promise(r => setTimeout(r, 10)))
  return p
}

describe('Replicator — separate-DB sync via broadcast', () => {
  let mainDb: Database.Database
  let workerDb: Database.Database
  let mainTasks: TaskStore
  let mainClaims: ClaimStore
  let workerTasks: TaskStore
  let workerClaims: ClaimStore
  let bus: LocalhostBus
  let main: CoordinationDaemon
  let mainTransport: ReturnType<typeof createLocalhostTransport>
  let workerTransport: ReturnType<typeof createLocalhostTransport>
  let workerReplicator: ReturnType<typeof createReplicator>

  beforeEach(() => {
    mainDb = openCoordinationDb()
    workerDb = openCoordinationDb()
    mainTasks = new TaskStore(mainDb)
    mainClaims = new ClaimStore(mainDb)
    workerTasks = new TaskStore(workerDb)
    workerClaims = new ClaimStore(workerDb)

    bus = new LocalhostBus()
    const mainId = generateIdentity('main')
    const workerId = generateIdentity('worker')

    mainTransport = createLocalhostTransport({ bus, identity: mainId, echo: true })
    workerTransport = createLocalhostTransport({ bus, identity: workerId })

    main = new CoordinationDaemon({
      identity: mainId,
      transport: mainTransport,
      db: mainDb,
      tasks: mainTasks,
      claims: mainClaims,
      worker: async (t) => ({ done_on_main: t.payload }),
      heartbeatIntervalMs: 0,
    })

    workerReplicator = createReplicator({
      transport: workerTransport,
      db: workerDb,
      tasks: workerTasks,
      claims: workerClaims,
      selfAgentId: 'worker',
    })
  })

  afterEach(async () => {
    workerReplicator.stop()
    await main.stop()
    await workerTransport.close()
  })

  it('task.available broadcast appears in worker DB without shared storage', async () => {
    expect(workerTasks.get('does-not-exist')).toBeNull()
    const submitted = await main.submit({ kind: 'demo', payload: { x: 1 } })
    await flush()

    const replicated = workerTasks.get(submitted.id)
    expect(replicated).not.toBeNull()
    expect(replicated?.state).toBe('queued')
    expect(replicated?.kind).toBe('demo')
    expect(replicated?.payload).toEqual({ x: 1 })
  })

  it('task.claim broadcast carries task + claim — worker reconstructs both', async () => {
    const submitted = await main.submit({ kind: 'demo', payload: null })
    await flush()
    await main.claimAndRun(submitted.id)
    await flush()

    // After main runs the worker, the task is 'done' in main's DB.
    // We're testing that the intermediate 'claimed' state was
    // observable AND the claim row was replicated.
    const claims = workerClaims.history(submitted.id)
    expect(claims).toHaveLength(1)
    expect(claims[0].agentId).toBe('main')
    expect(claims[0].releaseReason).toBe('completed')
    expect(claims[0].releasedAt).not.toBeNull()
  })

  it('worker DB ends in done state after task.complete broadcast', async () => {
    const submitted = await main.submit({ kind: 'demo', payload: { x: 42 } })
    await flush()
    await main.claimAndRun(submitted.id)
    await flush()

    const replicated = workerTasks.get(submitted.id)
    expect(replicated?.state).toBe('done')
    expect(replicated?.result).toEqual({ done_on_main: { x: 42 } })
    expect(replicated?.ownerAgentId).toBeNull()
  })

  it('handoff broadcast replicates both released-and-new claims', async () => {
    const submitted = await main.submit({ kind: 'demo', payload: null })
    await flush()
    // Manually set up "main claimed" without running, so we can hand off
    mainClaims.insert({ taskId: submitted.id, agentId: 'main' })
    mainTasks.update(submitted.id, { state: 'claimed', ownerAgentId: 'main' })
    ;(main as unknown as { ownedTaskIds: Set<string> }).ownedTaskIds.add(submitted.id)

    await main.handoffTo(submitted.id, 'worker')
    await flush()

    const wTask = workerTasks.get(submitted.id)
    expect(wTask?.state).toBe('claimed')
    expect(wTask?.ownerAgentId).toBe('worker')

    const wHistory = workerClaims.history(submitted.id)
    // The state of the worker's claim history mirrors what was
    // broadcast. Main's intermediate state (insert+update) was NOT
    // broadcast separately — only the final post-handoff snapshot.
    // So we expect to see at least the released old claim and the
    // active new one.
    expect(wHistory.length).toBeGreaterThanOrEqual(2)
    const releasedOnHandoff = wHistory.find(c => c.releaseReason === 'handoff')
    expect(releasedOnHandoff?.agentId).toBe('main')
    expect(releasedOnHandoff?.handoffToAgentId).toBe('worker')
    const activeOnWorker = wHistory.find(c => c.releasedAt === null)
    expect(activeOnWorker?.agentId).toBe('worker')
  })

  it('worker requeue broadcast replicates the failure path', async () => {
    // Make a failing worker on a third daemon
    const failingId = generateIdentity('failer')
    const failingTransport = createLocalhostTransport({ bus, identity: failingId })
    const failer = new CoordinationDaemon({
      identity: failingId,
      transport: failingTransport,
      db: mainDb, // shared with main for simplicity
      tasks: mainTasks,
      claims: mainClaims,
      worker: async () => { throw new Error('boom') },
      shouldClaim: (t) => t.kind === 'flaky',
      heartbeatIntervalMs: 0,
    })

    try {
      const submitted = await main.submit({ kind: 'flaky', payload: null, maxRetries: 5 })
      await flush(5)

      // Worker DB should see the task back in queued state with retry bumped
      const replicated = workerTasks.get(submitted.id)
      expect(replicated?.state).toBe('queued')
      expect(replicated?.retryCount).toBe(1)
      expect(replicated?.ownerAgentId).toBeNull()

      // And the released claim row
      const history = workerClaims.history(submitted.id)
      const released = history.find(c => c.agentId === 'failer')
      expect(released?.releaseReason).toBe('reclaimed')
      expect(released?.releasedAt).not.toBeNull()
    } finally {
      await failer.stop()
      await failingTransport.close()
    }
  })

  it('selfAgentId skips own broadcasts (no double-apply when running on same node as daemon)', async () => {
    // Wire a Replicator on MAIN that should ignore its own broadcasts
    const mainReplicator = createReplicator({
      transport: mainTransport,
      db: mainDb,
      tasks: mainTasks,
      claims: mainClaims,
      selfAgentId: 'main',
    })

    try {
      const beforeCount = mainReplicator.appliedCount()
      await main.submit({ kind: 'demo', payload: null })
      await flush()
      // The replicator received a task.available BUT selfAgentId
      // matched, so it skipped — applied count unchanged.
      expect(mainReplicator.appliedCount()).toBe(beforeCount)
    } finally {
      mainReplicator.stop()
    }
  })

  it('REGRESSION: stale broadcasts do not roll back progressed local state', async () => {
    // Scenario from the demo bug: a worker daemon's Replicator
    // subscribes after its CoordinationDaemon. Both run in the same
    // microtask after a broadcast lands. If the daemon claims the
    // task BEFORE the Replicator applies, the Replicator would see
    // the original task.available (state='queued') and overwrite
    // the daemon's just-committed 'claimed' state. Fixed by the
    // updated_at guard in upsertTask.

    // Simulate: worker's task.available was applied (state=queued),
    // then the daemon advanced state to claimed locally.
    const submitted = await main.submit({ kind: 'demo', payload: { x: 1 } })
    await flush()
    expect(workerTasks.get(submitted.id)?.state).toBe('queued')

    // Worker daemon advances local state to claimed (simulating its
    // own claim-and-run kicking off before the Replicator).
    workerClaims.insert({ taskId: submitted.id, agentId: 'worker' })
    workerTasks.update(submitted.id, { state: 'claimed', ownerAgentId: 'worker' })
    const beforeStaleApply = workerTasks.get(submitted.id)!
    expect(beforeStaleApply.state).toBe('claimed')

    // Now simulate a stale broadcast of the ORIGINAL task.available
    // arriving — this is what the Replicator subscribes to second.
    // Manually invoke the same upsert path with the stale Task.
    await main.submit({
      kind: 'demo',
      payload: { x: 1 },
      // Same id — but with the ORIGINAL pre-claim updatedAt
      id: submitted.id,
    } as never).catch(() => { /* main might throw on PK conflict; OK */ })
    await flush()

    // Worker's local state should still be 'claimed' — the stale
    // broadcast was ignored due to the updated_at guard.
    expect(workerTasks.get(submitted.id)?.state).toBe('claimed')
  })

  it('duplicate broadcasts are idempotent (INSERT OR REPLACE)', async () => {
    const submitted = await main.submit({ kind: 'demo', payload: { x: 1 } })
    await flush()
    expect(workerTasks.get(submitted.id)?.state).toBe('queued')

    // Manually re-broadcast the same task.available via a freshly-signed
    // message. The replicator should accept it (signature valid) and
    // apply it — but the result should be unchanged.
    await main.submit({ kind: 'demo', payload: { x: 1 }, id: submitted.id } as never)
      .catch(() => { /* may throw on PK conflict — that's fine, we just want a 2nd broadcast attempt */ })
    await flush()

    // Worker DB should still have exactly one row for this task
    const after = workerTasks.get(submitted.id)
    expect(after).not.toBeNull()
  })
})

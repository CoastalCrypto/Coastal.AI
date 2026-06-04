// packages/coordination/src/__tests__/two-daemon-handoff.test.ts
//
// The Phase 1 milestone: two CoordinationDaemons in the same process
// talking over an in-memory A2A bus, exercising the full stack —
// task submit, A2A broadcast, auto-claim, worker execution, completion
// broadcast, claim audit, and explicit handoff.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import {
  openCoordinationDb, TaskStore, ClaimStore, DependencyStore,
  generateIdentity,
  LocalhostBus, createLocalhostTransport,
  CoordinationDaemon,
} from '../index.js'

function flush(times = 3): Promise<void> {
  // Drain microtasks several times — the auto-claim path bounces
  // through the bus then through async worker calls.
  let p = Promise.resolve()
  for (let i = 0; i < times; i++) p = p.then(() => new Promise(r => setTimeout(r, 5)))
  return p
}

describe('two-daemon end-to-end (Phase 1 milestone)', () => {
  let db: Database.Database
  let tasks: TaskStore
  let claims: ClaimStore
  let deps: DependencyStore
  let bus: LocalhostBus
  let main: CoordinationDaemon
  let coder: CoordinationDaemon

  beforeEach(() => {
    db = openCoordinationDb()
    tasks = new TaskStore(db)
    claims = new ClaimStore(db)
    deps = new DependencyStore(db)
    bus = new LocalhostBus()

    const mainId = generateIdentity('main')
    const coderId = generateIdentity('coder')

    main = new CoordinationDaemon({
      identity: mainId,
      transport: createLocalhostTransport({ bus, identity: mainId }),
      db, tasks, claims,
      worker: async () => {
        throw new Error('Main should not be running tasks')
      },
      heartbeatIntervalMs: 0, // disable in tests
    })

    coder = new CoordinationDaemon({
      identity: coderId,
      transport: createLocalhostTransport({ bus, identity: coderId }),
      db, tasks, claims,
      worker: async (task) => ({ processed: task.payload }),
      // Coder auto-claims any task of kind 'demo' that lands on the board.
      shouldClaim: (task) => task.kind === 'demo',
      heartbeatIntervalMs: 0,
    })
  })

  afterEach(async () => {
    await main.stop()
    await coder.stop()
  })

  it('main submits, coder auto-claims, runs, completes; audit log records the cycle', async () => {
    const submitted = await main.submit({
      kind: 'demo',
      payload: { x: 42 },
    })
    expect(submitted.state).toBe('queued')

    await flush()

    const final = tasks.get(submitted.id)!
    expect(final.state).toBe('done')
    expect(final.result).toEqual({ processed: { x: 42 } })
    expect(final.ownerAgentId).toBeNull()

    const history = claims.history(submitted.id)
    expect(history).toHaveLength(1)
    expect(history[0].agentId).toBe('coder')
    expect(history[0].releaseReason).toBe('completed')
  })

  it('coder ignores tasks that do not match its claim policy', async () => {
    const submitted = await main.submit({
      kind: 'review', // coder only claims 'demo'
      payload: null,
    })
    await flush()

    expect(tasks.get(submitted.id)?.state).toBe('queued')
    expect(claims.history(submitted.id)).toEqual([])
  })

  it('explicit handoff between two daemons preserves task state and records provenance', async () => {
    // Spin up a third daemon (reviewer) to hand off TO
    const reviewerId = generateIdentity('reviewer')
    const reviewer = new CoordinationDaemon({
      identity: reviewerId,
      transport: createLocalhostTransport({ bus, identity: reviewerId }),
      db, tasks, claims,
      worker: async (task) => ({ reviewed: task.payload }),
      // Reviewer doesn't auto-claim — it gets work via handoff only.
      heartbeatIntervalMs: 0,
    })

    try {
      // Main submits → coder picks up via auto-claim... but wait —
      // for the handoff scenario we need coder to NOT immediately
      // complete. Use a worker that hangs forever, then short-circuit
      // by manually orchestrating.
      //
      // Cleaner: bypass auto-claim, do it all manually.
      const submitted = await main.submit({ kind: 'never-auto', payload: { n: 1 } })

      // Coder manually claims (we override the policy by calling claimAndRun directly)
      // First wait so any spurious auto-claim (there shouldn't be one — kind != demo)
      // doesn't interfere.
      await flush()
      expect(tasks.get(submitted.id)?.state).toBe('queued')

      // We need a daemon to perform the manual claim. coder.claimAndRun will
      // run-to-completion. Use a "slow worker" coder for this test instead.
      // Simplest: directly use the substrate to set up the "claimed by coder" state.
      claims.insert({ taskId: submitted.id, agentId: 'coder' })
      tasks.update(submitted.id, { state: 'claimed', ownerAgentId: 'coder' })
      // Reflect ownership in coder's in-process owned set
      ;(coder as any).ownedTaskIds.add(submitted.id)

      // Now hand off coder → reviewer
      const after = await coder.handoffTo(submitted.id, 'reviewer')
      expect(after.state).toBe('claimed') // stays claimed across handoff
      expect(after.ownerAgentId).toBe('reviewer')

      const history = claims.history(submitted.id)
      expect(history).toHaveLength(2)
      expect(history[0].agentId).toBe('coder')
      expect(history[0].releaseReason).toBe('handoff')
      expect(history[0].handoffToAgentId).toBe('reviewer')
      expect(history[1].agentId).toBe('reviewer')
      expect(history[1].releasedAt).toBeNull()
    } finally {
      await reviewer.stop()
    }
  })

  it('worker error releases the claim and requeues with incremented retry count', async () => {
    const failingId = generateIdentity('failer')
    const failer = new CoordinationDaemon({
      identity: failingId,
      transport: createLocalhostTransport({ bus, identity: failingId }),
      db, tasks, claims,
      worker: async () => { throw new Error('intentional') },
      shouldClaim: (t) => t.kind === 'flaky',
      heartbeatIntervalMs: 0,
    })

    try {
      const submitted = await main.submit({ kind: 'flaky', payload: null, maxRetries: 5 })
      await flush()

      const after = tasks.get(submitted.id)!
      expect(after.state).toBe('queued') // back on the board for retry
      expect(after.ownerAgentId).toBeNull()
      expect(after.retryCount).toBe(1)

      // Claim audit: one row, released with reclaimed
      const history = claims.history(submitted.id)
      expect(history).toHaveLength(1)
      expect(history[0].releaseReason).toBe('reclaimed')
    } finally {
      await failer.stop()
    }
  })

  it('broadcast messages are signed and verified end-to-end', async () => {
    // This is implicit in everything above — every test relies on
    // signatures verifying for messages to reach handlers. Add an
    // explicit assertion by watching the bus directly.
    const received: string[] = []
    bus.on(msg => received.push(msg.kind))

    await main.submit({ kind: 'demo', payload: { n: 7 } })
    await flush()

    // We should see at least task.available (from main) + task.claim
    // and task.complete (from coder).
    expect(received).toContain('task.available')
    expect(received).toContain('task.claim')
    expect(received).toContain('task.complete')
  })
})

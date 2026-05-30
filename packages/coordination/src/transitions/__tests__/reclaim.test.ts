// packages/coordination/src/transitions/__tests__/reclaim.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { openCoordinationDb, TaskStore, ClaimStore } from '../../index.js'
import { reclaimZombies } from '../reclaim.js'

describe('reclaimZombies', () => {
  let db: Database.Database
  let tasks: TaskStore
  let claims: ClaimStore

  beforeEach(() => {
    db = openCoordinationDb()
    tasks = new TaskStore(db)
    claims = new ClaimStore(db)
  })

  function setupClaimed(agentId: string, maxRetries = 3) {
    const t = tasks.create({ kind: 'x', payload: null, maxRetries })
    claims.insert({ taskId: t.id, agentId })
    tasks.update(t.id, { state: 'claimed', ownerAgentId: agentId })
    return t
  }

  it('returns empty lists when nothing is stale', () => {
    setupClaimed('agent-A')
    const result = reclaimZombies({ db, tasks, claims }, { thresholdMs: 90_000 })
    expect(result.requeued).toEqual([])
    expect(result.failed).toEqual([])
  })

  it('requeues a zombie back to "queued" with incremented retry_count', () => {
    const t = setupClaimed('agent-A')
    // Simulate "now" is far in the future so the claim looks stale
    const future = Date.now() + 1_000_000
    const result = reclaimZombies({ db, tasks, claims }, { thresholdMs: 90_000, now: future })
    expect(result.requeued).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
    const refreshed = tasks.get(t.id)!
    expect(refreshed.state).toBe('queued')
    expect(refreshed.ownerAgentId).toBeNull()
    expect(refreshed.retryCount).toBe(1)
  })

  it('marks the released claim with reason "reclaimed"', () => {
    const t = setupClaimed('agent-A')
    reclaimZombies({ db, tasks, claims }, { thresholdMs: 0, now: Date.now() + 1000 })
    const history = claims.history(t.id)
    expect(history).toHaveLength(1)
    expect(history[0].releaseReason).toBe('reclaimed')
    expect(history[0].handoffToAgentId).toBeNull()
  })

  it('transitions to "failed" when retries are exhausted', () => {
    const t = setupClaimed('agent-A', /* maxRetries */ 1)
    // First reclaim — retry 1 of 1, requeued
    tasks.update(t.id, { retryCount: 1 }) // simulate already-tried-once state
    // Re-set up: task is again claimed
    claims.insert({ taskId: t.id, agentId: 'agent-A' })
    tasks.update(t.id, { state: 'claimed', ownerAgentId: 'agent-A' })

    const result = reclaimZombies({ db, tasks, claims }, { thresholdMs: 0, now: Date.now() + 1000 })
    expect(result.failed).toHaveLength(1)
    expect(result.requeued).toHaveLength(0)
    const refreshed = tasks.get(t.id)!
    expect(refreshed.state).toBe('failed')
    expect(refreshed.failureReason).toMatch(/retries exhausted/)
    expect(refreshed.ownerAgentId).toBeNull()
    expect(refreshed.retryCount).toBe(2)
  })

  it('only sweeps active claims (released claims are immune)', () => {
    const t = setupClaimed('agent-A')
    claims.release(t.id, 'agent-A', { releaseReason: 'completed' })
    tasks.update(t.id, { state: 'done', ownerAgentId: null })
    const result = reclaimZombies({ db, tasks, claims }, { thresholdMs: 0, now: Date.now() + 1000 })
    expect(result.requeued).toEqual([])
    expect(result.failed).toEqual([])
  })

  it('skips claims whose task is no longer in "claimed" state', () => {
    const t = setupClaimed('agent-A')
    // Race: someone else cancelled the task while the claim is still active
    tasks.update(t.id, { state: 'cancelled', ownerAgentId: null })
    const result = reclaimZombies({ db, tasks, claims }, { thresholdMs: 0, now: Date.now() + 1000 })
    // The reclaim sweep should not transition cancelled → queued
    expect(result.requeued).toEqual([])
    expect(result.failed).toEqual([])
  })

  it('sweeps multiple zombies in one pass', () => {
    const a = setupClaimed('agent-A')
    const b = setupClaimed('agent-B')
    const c = setupClaimed('agent-C')
    const result = reclaimZombies({ db, tasks, claims }, { thresholdMs: 0, now: Date.now() + 1000 })
    expect(result.requeued).toHaveLength(3)
    expect(result.requeued.map(t => t.id).sort()).toEqual([a.id, b.id, c.id].sort())
  })
})

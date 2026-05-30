// packages/coordination/src/resolver/__tests__/dependency-resolver.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import {
  openCoordinationDb, TaskStore, ClaimStore, DependencyStore,
} from '../../index.js'
import { resolveDependencies, evaluateBlockedState } from '../dependency-resolver.js'

describe('resolveDependencies — sweep', () => {
  let db: Database.Database
  let tasks: TaskStore
  let deps: DependencyStore
  let claims: ClaimStore

  beforeEach(() => {
    db = openCoordinationDb()
    tasks = new TaskStore(db)
    deps = new DependencyStore(db)
    claims = new ClaimStore(db)
  })

  // ── BLOCK transition: queued → blocked ──

  it('blocks a queued task with an unsatisfied must_complete dep', () => {
    const a = tasks.create({ kind: 'x', payload: null })
    const b = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_complete' })
    const result = resolveDependencies({ db, tasks, deps })
    expect(result.blocked.map(t => t.id)).toEqual([b.id])
    expect(tasks.get(b.id)?.state).toBe('blocked')
  })

  it('leaves a queued task alone when it has no deps', () => {
    const a = tasks.create({ kind: 'x', payload: null })
    const result = resolveDependencies({ db, tasks, deps })
    expect(result.blocked).toEqual([])
    expect(result.unblocked).toEqual([])
    expect(tasks.get(a.id)?.state).toBe('queued')
  })

  // ── UNBLOCK transition: blocked → queued ──

  it('unblocks a blocked task when all must_complete deps are done', () => {
    const a = tasks.create({ kind: 'x', payload: null })
    const b = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_complete' })
    resolveDependencies({ db, tasks, deps }) // b → blocked
    // Now complete a
    tasks.update(a.id, { state: 'claimed', ownerAgentId: 'agent-A' })
    tasks.update(a.id, { state: 'done', result: { x: 1 }, ownerAgentId: null })
    const result = resolveDependencies({ db, tasks, deps })
    expect(result.unblocked.map(t => t.id)).toEqual([b.id])
    expect(tasks.get(b.id)?.state).toBe('queued')
  })

  it('keeps a task blocked if any must_complete dep is still pending', () => {
    const a = tasks.create({ kind: 'x', payload: null })
    const b = tasks.create({ kind: 'x', payload: null })
    const c = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: c.id, dependsOnTaskId: a.id, kind: 'must_complete' })
    deps.add({ taskId: c.id, dependsOnTaskId: b.id, kind: 'must_complete' })
    resolveDependencies({ db, tasks, deps })
    // Complete only a
    tasks.update(a.id, { state: 'claimed', ownerAgentId: 'A' })
    tasks.update(a.id, { state: 'done', ownerAgentId: null })
    const result = resolveDependencies({ db, tasks, deps })
    expect(result.unblocked).toEqual([])
    expect(tasks.get(c.id)?.state).toBe('blocked')
  })

  // ── CASCADE transition: blocked → cancelled ──

  it('cascades cancellation through a must_not_fail dep when the dep fails', () => {
    const a = tasks.create({ kind: 'x', payload: null, maxRetries: 0 })
    const b = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_not_fail' })
    resolveDependencies({ db, tasks, deps }) // b → blocked
    // Fail a
    tasks.update(a.id, { state: 'claimed', ownerAgentId: 'A' })
    tasks.update(a.id, {
      state: 'failed', failureReason: 'simulated', ownerAgentId: null,
    })
    const result = resolveDependencies({ db, tasks, deps })
    expect(result.cascaded.map(t => t.id)).toEqual([b.id])
    const cancelled = tasks.get(b.id)
    expect(cancelled?.state).toBe('cancelled')
    expect(cancelled?.failureReason).toMatch(/cascaded from must_not_fail dep/)
  })

  it('cascades when the must_not_fail dep was cancelled', () => {
    const a = tasks.create({ kind: 'x', payload: null })
    const b = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_not_fail' })
    resolveDependencies({ db, tasks, deps })
    tasks.update(a.id, { state: 'cancelled', failureReason: 'user cancel' })
    const result = resolveDependencies({ db, tasks, deps })
    expect(result.cascaded).toHaveLength(1)
    expect(tasks.get(b.id)?.state).toBe('cancelled')
  })

  it('cascades a queued task directly to cancelled (no intermediate blocked state)', () => {
    const a = tasks.create({ kind: 'x', payload: null })
    tasks.update(a.id, { state: 'cancelled' })
    const b = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_not_fail' })
    // b is still queued at this point; resolver should cascade it.
    const result = resolveDependencies({ db, tasks, deps })
    expect(result.cascaded.map(t => t.id)).toEqual([b.id])
    expect(tasks.get(b.id)?.state).toBe('cancelled')
  })

  it('does NOT cascade a must_complete dep that failed (must_complete failure ⇒ stays blocked)', () => {
    const a = tasks.create({ kind: 'x', payload: null })
    const b = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_complete' })
    resolveDependencies({ db, tasks, deps }) // b → blocked
    tasks.update(a.id, { state: 'claimed', ownerAgentId: 'A' })
    tasks.update(a.id, { state: 'failed', failureReason: 'oops' })
    const result = resolveDependencies({ db, tasks, deps })
    expect(result.cascaded).toEqual([])
    expect(result.unblocked).toEqual([])
    expect(tasks.get(b.id)?.state).toBe('blocked') // human revives via failed→queued
  })

  // ── Dangling deps and edge cases ──

  it('treats a deleted dep as unsatisfied (stays blocked, no cascade)', () => {
    const a = tasks.create({ kind: 'x', payload: null })
    const b = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_complete' })
    resolveDependencies({ db, tasks, deps })
    // Hard-delete the dep task — CASCADE removes the dep edge too,
    // so b becomes a blocked-with-no-deps. Resolver unblocks it.
    tasks.delete(a.id)
    const result = resolveDependencies({ db, tasks, deps })
    expect(result.unblocked.map(t => t.id)).toEqual([b.id])
  })

  it('multi-task sweep handles independent chains', () => {
    // chain 1: a1 → b1 (must_complete)
    const a1 = tasks.create({ kind: 'x', payload: null })
    const b1 = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: b1.id, dependsOnTaskId: a1.id, kind: 'must_complete' })
    // chain 2: a2 → b2 (must_not_fail), then a2 fails
    const a2 = tasks.create({ kind: 'x', payload: null })
    const b2 = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: b2.id, dependsOnTaskId: a2.id, kind: 'must_not_fail' })
    tasks.update(a2.id, { state: 'claimed', ownerAgentId: 'A' })
    tasks.update(a2.id, { state: 'failed', failureReason: 'x' })
    // standalone: c (no deps)
    const c = tasks.create({ kind: 'x', payload: null })

    const result = resolveDependencies({ db, tasks, deps })
    expect(result.blocked.map(t => t.id).sort()).toEqual([b1.id])
    expect(result.cascaded.map(t => t.id).sort()).toEqual([b2.id])
    expect(tasks.get(c.id)?.state).toBe('queued')
  })
})

describe('evaluateBlockedState — single-task', () => {
  let db: Database.Database
  let tasks: TaskStore
  let deps: DependencyStore

  beforeEach(() => {
    db = openCoordinationDb()
    tasks = new TaskStore(db)
    deps = new DependencyStore(db)
  })

  it('blocks a queued task immediately after adding an unsatisfied dep', () => {
    const a = tasks.create({ kind: 'x', payload: null })
    const b = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_complete' })
    const updated = evaluateBlockedState({ db, tasks, deps }, b.id)
    expect(updated?.state).toBe('blocked')
  })

  it('unblocks a single blocked task without a full sweep', () => {
    const a = tasks.create({ kind: 'x', payload: null })
    const b = tasks.create({ kind: 'x', payload: null })
    deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_complete' })
    evaluateBlockedState({ db, tasks, deps }, b.id)
    tasks.update(a.id, { state: 'claimed', ownerAgentId: 'A' })
    tasks.update(a.id, { state: 'done', ownerAgentId: null })
    const updated = evaluateBlockedState({ db, tasks, deps }, b.id)
    expect(updated?.state).toBe('queued')
  })

  it('returns null for a non-existent task', () => {
    expect(evaluateBlockedState({ db, tasks, deps }, 'nope')).toBeNull()
  })

  it('leaves terminal-state tasks alone', () => {
    const a = tasks.create({ kind: 'x', payload: null })
    tasks.update(a.id, { state: 'claimed', ownerAgentId: 'A' })
    tasks.update(a.id, { state: 'done', ownerAgentId: null })
    const result = evaluateBlockedState({ db, tasks, deps }, a.id)
    expect(result?.state).toBe('done')
  })
})

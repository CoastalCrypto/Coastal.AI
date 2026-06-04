// packages/coordination/src/__tests__/foundation.test.ts
//
// End-to-end smoke test for the Phase 1 primitive layer (Task #3):
// stores + state-machine. Exercises the full happy path plus a few
// negative cases so the next layer (transitions/handoff,
// transitions/reclaim) has a verified foundation to build on.

import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import {
  openCoordinationDb,
  TaskStore,
  ClaimStore,
  DependencyStore,
  isValidTransition,
  VALID_TRANSITIONS,
  TASK_STATES,
} from '../index.js'

describe('coordination foundation', () => {
  let db: Database.Database
  let tasks: TaskStore
  let claims: ClaimStore
  let deps: DependencyStore

  beforeEach(() => {
    db = openCoordinationDb() // in-memory
    tasks = new TaskStore(db)
    claims = new ClaimStore(db)
    deps = new DependencyStore(db)
  })

  describe('state machine', () => {
    it('exposes a transition entry for every state', () => {
      for (const state of TASK_STATES) {
        expect(VALID_TRANSITIONS[state]).toBeDefined()
      }
    })

    it('treats done and cancelled as terminal', () => {
      expect(VALID_TRANSITIONS.done).toEqual([])
      expect(VALID_TRANSITIONS.cancelled).toEqual([])
    })

    it('allows claimed → queued (handoff and reclaim both ride this edge)', () => {
      expect(isValidTransition('claimed', 'queued')).toBe(true)
    })

    it('rejects done → anything', () => {
      for (const target of TASK_STATES) {
        if (target === 'done') continue
        expect(isValidTransition('done', target)).toBe(false)
      }
    })
  })

  describe('TaskStore', () => {
    it('creates a task in queued state with sensible defaults', () => {
      const t = tasks.create({ kind: 'code', payload: { foo: 'bar' } })
      expect(t.state).toBe('queued')
      expect(t.kind).toBe('code')
      expect(t.payload).toEqual({ foo: 'bar' })
      expect(t.ownerAgentId).toBeNull()
      expect(t.retryCount).toBe(0)
      expect(t.maxRetries).toBe(3)
      expect(t.parentTaskId).toBeNull()
    })

    it('round-trips JSON payloads through get()', () => {
      const created = tasks.create({
        kind: 'review',
        payload: { files: ['a.ts', 'b.ts'], depth: 3 },
      })
      const fetched = tasks.get(created.id)
      expect(fetched?.payload).toEqual({ files: ['a.ts', 'b.ts'], depth: 3 })
    })

    it('validates state transitions on update', () => {
      const t = tasks.create({ kind: 'x', payload: null })
      // queued → done is not a valid transition
      expect(() => tasks.update(t.id, { state: 'done' })).toThrow(/Invalid task state transition/)
    })

    it('allows valid transitions and bumps updatedAt', async () => {
      const t = tasks.create({ kind: 'x', payload: null })
      await new Promise(r => setTimeout(r, 2)) // ensure clock advance
      const claimed = tasks.update(t.id, { state: 'claimed', ownerAgentId: 'agent-A' })
      expect(claimed?.state).toBe('claimed')
      expect(claimed?.ownerAgentId).toBe('agent-A')
      expect(claimed!.updatedAt).toBeGreaterThan(t.updatedAt)
    })

    it('listQueued returns FIFO', () => {
      const a = tasks.create({ kind: 'x', payload: 1 })
      const b = tasks.create({ kind: 'x', payload: 2 })
      const c = tasks.create({ kind: 'x', payload: 3 })
      const queued = tasks.listQueued()
      expect(queued.map(t => t.id)).toEqual([a.id, b.id, c.id])
    })

    it('listByOwner filters correctly', () => {
      const a = tasks.create({ kind: 'x', payload: 1 })
      const b = tasks.create({ kind: 'x', payload: 2 })
      tasks.update(a.id, { state: 'claimed', ownerAgentId: 'agent-A' })
      tasks.update(b.id, { state: 'claimed', ownerAgentId: 'agent-B' })
      expect(tasks.listByOwner('agent-A').map(t => t.id)).toEqual([a.id])
      expect(tasks.listByOwner('agent-B').map(t => t.id)).toEqual([b.id])
    })
  })

  describe('ClaimStore', () => {
    it('inserts an active claim with null release fields', () => {
      const t = tasks.create({ kind: 'x', payload: null })
      const c = claims.insert({ taskId: t.id, agentId: 'agent-A' })
      expect(c.taskId).toBe(t.id)
      expect(c.agentId).toBe('agent-A')
      expect(c.releasedAt).toBeNull()
      expect(c.releaseReason).toBeNull()
      expect(c.handoffToAgentId).toBeNull()
    })

    it('release() flips an active claim to released with reason', () => {
      const t = tasks.create({ kind: 'x', payload: null })
      claims.insert({ taskId: t.id, agentId: 'agent-A' })
      const released = claims.release(t.id, 'agent-A', { releaseReason: 'completed' })
      expect(released?.releasedAt).toBeGreaterThan(0)
      expect(released?.releaseReason).toBe('completed')
    })

    it('release() returns null when no matching active claim exists', () => {
      const t = tasks.create({ kind: 'x', payload: null })
      const result = claims.release(t.id, 'agent-A', { releaseReason: 'completed' })
      expect(result).toBeNull()
    })

    it('release() requires handoffToAgentId when reason is handoff', () => {
      const t = tasks.create({ kind: 'x', payload: null })
      claims.insert({ taskId: t.id, agentId: 'agent-A' })
      expect(() => claims.release(t.id, 'agent-A', { releaseReason: 'handoff' })).toThrow(/handoffToAgentId required/)
    })

    it('heartbeat() bumps last_heartbeat on the active claim', async () => {
      const t = tasks.create({ kind: 'x', payload: null })
      const initial = claims.insert({ taskId: t.id, agentId: 'agent-A' })
      await new Promise(r => setTimeout(r, 5))
      const ok = claims.heartbeat(t.id, 'agent-A')
      expect(ok).toBe(true)
      const after = claims.getActive(t.id)
      expect(after!.lastHeartbeat).toBeGreaterThan(initial.lastHeartbeat)
    })

    it('heartbeat() returns false when the claim was already released', () => {
      const t = tasks.create({ kind: 'x', payload: null })
      claims.insert({ taskId: t.id, agentId: 'agent-A' })
      claims.release(t.id, 'agent-A', { releaseReason: 'reclaimed' })
      expect(claims.heartbeat(t.id, 'agent-A')).toBe(false)
    })

    it('history() returns claims in chronological order', () => {
      const t = tasks.create({ kind: 'x', payload: null })
      claims.insert({ taskId: t.id, agentId: 'agent-A' })
      claims.release(t.id, 'agent-A', { releaseReason: 'handoff', handoffToAgentId: 'agent-B' })
      claims.insert({ taskId: t.id, agentId: 'agent-B' })
      const h = claims.history(t.id)
      expect(h).toHaveLength(2)
      expect(h[0].agentId).toBe('agent-A')
      expect(h[0].releaseReason).toBe('handoff')
      expect(h[1].agentId).toBe('agent-B')
      expect(h[1].releasedAt).toBeNull()
    })

    it('activeStaleSince() finds zombie claims', () => {
      const t = tasks.create({ kind: 'x', payload: null })
      claims.insert({ taskId: t.id, agentId: 'agent-A' })
      const future = Date.now() + 10_000 // pretend "now" is 10s in the future
      const stale = claims.activeStaleSince(future)
      expect(stale).toHaveLength(1)
      expect(stale[0].agentId).toBe('agent-A')
    })
  })

  describe('DependencyStore', () => {
    it('add() + depsOf() round-trip', () => {
      const a = tasks.create({ kind: 'x', payload: null })
      const b = tasks.create({ kind: 'x', payload: null })
      deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_complete' })
      const bDeps = deps.depsOf(b.id)
      expect(bDeps).toHaveLength(1)
      expect(bDeps[0].dependsOnTaskId).toBe(a.id)
      expect(bDeps[0].kind).toBe('must_complete')
    })

    it('dependentsOf() reverses the edge', () => {
      const a = tasks.create({ kind: 'x', payload: null })
      const b = tasks.create({ kind: 'x', payload: null })
      const c = tasks.create({ kind: 'x', payload: null })
      deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_complete' })
      deps.add({ taskId: c.id, dependsOnTaskId: a.id, kind: 'must_not_fail' })
      const dependents = deps.dependentsOf(a.id)
      expect(dependents).toHaveLength(2)
      expect(dependents.map(d => d.taskId).sort()).toEqual([b.id, c.id].sort())
    })

    it('CASCADE deletes deps when a task is removed', () => {
      const a = tasks.create({ kind: 'x', payload: null })
      const b = tasks.create({ kind: 'x', payload: null })
      deps.add({ taskId: b.id, dependsOnTaskId: a.id, kind: 'must_complete' })
      tasks.delete(a.id)
      expect(deps.depsOf(b.id)).toHaveLength(0)
    })
  })

  describe('end-to-end happy path', () => {
    it('create → claim → heartbeat → release → done', () => {
      // 1. Create
      const t = tasks.create({ kind: 'code', payload: { file: 'foo.ts' } })

      // 2. Agent claims
      const c = claims.insert({ taskId: t.id, agentId: 'coder-1' })
      tasks.update(t.id, { state: 'claimed', ownerAgentId: 'coder-1' })

      // 3. Heartbeat while working
      expect(claims.heartbeat(t.id, 'coder-1')).toBe(true)

      // 4. Complete: release claim, transition task to done
      claims.release(t.id, 'coder-1', { releaseReason: 'completed' })
      const done = tasks.update(t.id, {
        state: 'done',
        result: { output: 'success' },
        ownerAgentId: null,
      })

      // 5. Verify final state
      expect(done?.state).toBe('done')
      expect(done?.result).toEqual({ output: 'success' })
      expect(done?.ownerAgentId).toBeNull()

      // 6. Audit log shows the full history
      const history = claims.history(t.id)
      expect(history).toHaveLength(1)
      expect(history[0].agentId).toBe('coder-1')
      expect(history[0].releaseReason).toBe('completed')
      expect(history[0].releasedAt).toBeGreaterThan(history[0].claimedAt - 1)
    })
  })
})

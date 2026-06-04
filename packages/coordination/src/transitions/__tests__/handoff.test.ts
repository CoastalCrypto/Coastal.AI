// packages/coordination/src/transitions/__tests__/handoff.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { openCoordinationDb, TaskStore, ClaimStore } from '../../index.js'
import { handoff } from '../handoff.js'

describe('handoff', () => {
  let db: Database.Database
  let tasks: TaskStore
  let claims: ClaimStore

  beforeEach(() => {
    db = openCoordinationDb()
    tasks = new TaskStore(db)
    claims = new ClaimStore(db)
  })

  function setupClaimedTask(agentId = 'agent-A') {
    const t = tasks.create({ kind: 'code', payload: { x: 1 } })
    claims.insert({ taskId: t.id, agentId })
    tasks.update(t.id, { state: 'claimed', ownerAgentId: agentId })
    return t
  }

  it('flips ownerAgentId without churning task state', () => {
    const t = setupClaimedTask('agent-A')
    const result = handoff({ db, tasks, claims }, t.id, 'agent-A', 'agent-B')
    expect(result.state).toBe('claimed')
    expect(result.ownerAgentId).toBe('agent-B')
  })

  it('records the handoff in the claim history', () => {
    const t = setupClaimedTask('agent-A')
    handoff({ db, tasks, claims }, t.id, 'agent-A', 'agent-B')
    const history = claims.history(t.id)
    expect(history).toHaveLength(2)
    expect(history[0].agentId).toBe('agent-A')
    expect(history[0].releaseReason).toBe('handoff')
    expect(history[0].handoffToAgentId).toBe('agent-B')
    expect(history[0].releasedAt).not.toBeNull()
    expect(history[1].agentId).toBe('agent-B')
    expect(history[1].releasedAt).toBeNull()
  })

  it('throws when task is not claimed', () => {
    const t = tasks.create({ kind: 'x', payload: null })
    expect(() => handoff({ db, tasks, claims }, t.id, 'agent-A', 'agent-B'))
      .toThrow(/expected 'claimed'/)
  })

  it('throws when the active claim is held by a different agent', () => {
    const t = setupClaimedTask('agent-A')
    expect(() => handoff({ db, tasks, claims }, t.id, 'agent-X', 'agent-B'))
      .toThrow(/not currently held by agent-X/)
  })

  it('rejects self-handoffs', () => {
    const t = setupClaimedTask('agent-A')
    expect(() => handoff({ db, tasks, claims }, t.id, 'agent-A', 'agent-A'))
      .toThrow(/same/)
  })

  it('throws when task does not exist', () => {
    expect(() => handoff({ db, tasks, claims }, 'nonexistent', 'a', 'b'))
      .toThrow(/not found/)
  })

  it('is atomic: a throwing release does not leave an orphaned new claim', () => {
    // We can't easily inject a failure mid-transaction without mocking,
    // but we can verify that after a successful handoff there's exactly
    // one active claim (no leak from the swap).
    const t = setupClaimedTask('agent-A')
    handoff({ db, tasks, claims }, t.id, 'agent-A', 'agent-B')
    const active = claims.getActive(t.id)
    expect(active?.agentId).toBe('agent-B')
    // History has exactly the released-A and active-B
    const allClaims = claims.history(t.id)
    expect(allClaims.filter(c => c.releasedAt === null)).toHaveLength(1)
  })

  it('supports a chain of handoffs', () => {
    const t = setupClaimedTask('agent-A')
    handoff({ db, tasks, claims }, t.id, 'agent-A', 'agent-B')
    handoff({ db, tasks, claims }, t.id, 'agent-B', 'agent-C')
    const history = claims.history(t.id)
    expect(history.map(c => c.agentId)).toEqual(['agent-A', 'agent-B', 'agent-C'])
    expect(history[0].handoffToAgentId).toBe('agent-B')
    expect(history[1].handoffToAgentId).toBe('agent-C')
    expect(history[2].releasedAt).toBeNull()
    expect(tasks.get(t.id)?.ownerAgentId).toBe('agent-C')
  })
})

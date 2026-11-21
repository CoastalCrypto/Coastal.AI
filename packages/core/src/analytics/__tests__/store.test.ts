import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { AnalyticsStore } from '../store.js'
import { ActionLog } from '../../agents/action-log.js'

let db: Database.Database
let actionLog: ActionLog
let store: AnalyticsStore

beforeEach(() => {
  db = new Database(':memory:')
  actionLog = new ActionLog(db)
  store = new AnalyticsStore(db)
})

afterEach(() => {
  db.close()
})

function record(sessionId: string, createdAt: number): void {
  actionLog.record({
    sessionId,
    agentId: 'general',
    toolName: 'read_file',
    args: {},
    result: 'ok',
    decision: 'approved' as any,
    durationMs: 10,
  })
  // record() always stamps Date.now() — backdate directly for day-bucket tests.
  db.prepare('UPDATE action_log SET created_at = ? WHERE id = (SELECT id FROM action_log ORDER BY created_at DESC LIMIT 1)').run(createdAt)
}

describe('AnalyticsStore.getSnapshot last7Days', () => {
  it('buckets rows into the correct local day and counts distinct sessions per day', () => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const yesterdayStart = new Date(todayStart)
    yesterdayStart.setDate(yesterdayStart.getDate() - 1)

    record('s1', todayStart.getTime() + 1000)
    record('s2', todayStart.getTime() + 2000)
    record('s1', yesterdayStart.getTime() + 1000)

    const snapshot = store.getSnapshot()
    const today = snapshot.last7Days.at(-1)!
    const yesterday = snapshot.last7Days.at(-2)!

    expect(today.calls).toBe(2)
    expect(today.sessions).toBe(2)
    expect(yesterday.calls).toBe(1)
    expect(yesterday.sessions).toBe(1)
    expect(snapshot.last7Days).toHaveLength(7)
  })

  it('excludes rows older than the 7-day window', () => {
    const eightDaysAgo = new Date()
    eightDaysAgo.setHours(0, 0, 0, 0)
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
    record('old', eightDaysAgo.getTime())

    const snapshot = store.getSnapshot()
    const totalBucketed = snapshot.last7Days.reduce((sum, d) => sum + d.calls, 0)
    expect(totalBucketed).toBe(0)
    expect(snapshot.totalToolCalls).toBe(1)
  })
})

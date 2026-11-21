import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { GateDecision } from './types.js'

export interface ActionLogEntry {
  id: string
  sessionId: string
  agentId: string
  toolName: string
  args: Record<string, unknown>
  result: string
  resultFull: string
  decision: GateDecision
  durationMs: number
  createdAt: number
}

export class ActionLog {
  constructor(private db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS action_log (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        agent_id    TEXT NOT NULL,
        tool_name   TEXT NOT NULL,
        args        TEXT,
        result      TEXT,
        result_full TEXT,
        decision    TEXT,
        duration_ms INTEGER,
        created_at  INTEGER
      )
    `)
    // getForSession() filters+orders by (session_id, created_at); analytics'
    // day-bucket and 30-day top-tools queries range-scan created_at; agent-events'
    // readToolEdgeUsage() groups by (agent_id, tool_name) — all were full table
    // scans before these existed.
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_action_log_session_created ON action_log(session_id, created_at)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_action_log_created_at ON action_log(created_at)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_action_log_agent_tool ON action_log(agent_id, tool_name)')
  }

  record(entry: Omit<ActionLogEntry, 'id' | 'createdAt' | 'resultFull'>): void {
    const display = entry.result.slice(0, 2000)
    this.db.prepare(`
      INSERT INTO action_log (id, session_id, agent_id, tool_name, args, result, result_full, decision, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      entry.sessionId,
      entry.agentId,
      entry.toolName,
      JSON.stringify(entry.args),
      display,
      entry.result,
      entry.decision,
      entry.durationMs,
      Date.now(),
    )
  }

  getForSession(sessionId: string): ActionLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM action_log WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as any[]
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      agentId: r.agent_id,
      toolName: r.tool_name,
      args: JSON.parse(r.args ?? '{}'),
      result: r.result,
      resultFull: r.result_full,
      decision: r.decision,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
    }))
  }
}

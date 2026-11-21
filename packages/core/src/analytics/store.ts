import type Database from 'better-sqlite3'

export interface ToolStat {
  toolName: string
  callCount: number
  avgDurationMs: number
  successRate: number
}

export interface DayStat {
  date: string   // YYYY-MM-DD
  calls: number
  sessions: number
}

export interface AnalyticsSnapshot {
  totalToolCalls: number
  totalSessions: number
  avgDurationMs: number
  overallSuccessRate: number
  topTools: ToolStat[]
  last7Days: DayStat[]
  decisionBreakdown: Record<string, number>
}

export class AnalyticsStore {
  constructor(private db: Database.Database) {}

  getSnapshot(): AnalyticsSnapshot {
    // Total tool calls
    const totalRow = this.db
      .prepare('SELECT COUNT(*) as n FROM action_log')
      .get() as { n: number }

    // Total unique sessions
    const sessionsRow = this.db
      .prepare('SELECT COUNT(DISTINCT session_id) as n FROM action_log')
      .get() as { n: number }

    // Avg duration
    const avgRow = this.db
      .prepare('SELECT AVG(duration_ms) as avg FROM action_log')
      .get() as { avg: number | null }

    // Decision breakdown
    const decisionRows = this.db
      .prepare('SELECT decision, COUNT(*) as n FROM action_log GROUP BY decision')
      .all() as Array<{ decision: string; n: number }>
    const decisionBreakdown: Record<string, number> = {}
    for (const r of decisionRows) decisionBreakdown[r.decision ?? 'unknown'] = r.n

    const approved = decisionBreakdown['approved'] ?? 0
    const autonomous = decisionBreakdown['autonomous'] ?? 0
    const total = totalRow.n || 1
    const overallSuccessRate = Math.round(((approved + autonomous) / total) * 100)

    // Top tools (by call count, last 30 days)
    const since30d = Date.now() - 30 * 24 * 3600 * 1000
    const toolRows = this.db.prepare(`
      SELECT
        tool_name,
        COUNT(*) as call_count,
        AVG(duration_ms) as avg_ms,
        SUM(CASE WHEN decision IN ('approved','autonomous') THEN 1 ELSE 0 END) * 100 / COUNT(*) as success_pct
      FROM action_log
      WHERE created_at > ?
      GROUP BY tool_name
      ORDER BY call_count DESC
      LIMIT 10
    `).all(since30d) as Array<{ tool_name: string; call_count: number; avg_ms: number; success_pct: number }>

    const topTools: ToolStat[] = toolRows.map(r => ({
      toolName: r.tool_name,
      callCount: r.call_count,
      avgDurationMs: Math.round(r.avg_ms ?? 0),
      successRate: Math.round(r.success_pct ?? 0),
    }))

    // Last 7 days activity — one range query covering the whole window,
    // bucketed in JS, instead of a separate COUNT(DISTINCT ...) query per day.
    const dayStarts: Date[] = []
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date()
      dayStart.setHours(0, 0, 0, 0)
      dayStart.setDate(dayStart.getDate() - i)
      dayStarts.push(dayStart)
    }
    const recentRows = this.db.prepare(`
      SELECT created_at, session_id FROM action_log WHERE created_at >= ?
    `).all(dayStarts[0].getTime()) as Array<{ created_at: number; session_id: string }>

    const buckets = dayStarts.map(() => ({ calls: 0, sessions: new Set<string>() }))
    for (const row of recentRows) {
      for (let i = dayStarts.length - 1; i >= 0; i--) {
        if (row.created_at >= dayStarts[i].getTime()) {
          buckets[i].calls++
          buckets[i].sessions.add(row.session_id)
          break
        }
      }
    }
    const last7Days: DayStat[] = dayStarts.map((dayStart, i) => ({
      date: dayStart.toISOString().slice(0, 10),
      calls: buckets[i].calls,
      sessions: buckets[i].sessions.size,
    }))

    return {
      totalToolCalls: totalRow.n,
      totalSessions: sessionsRow.n,
      avgDurationMs: Math.round(avgRow.avg ?? 0),
      overallSuccessRate,
      topTools,
      last7Days,
      decisionBreakdown,
    }
  }
}

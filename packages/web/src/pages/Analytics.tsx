import { useState, useEffect } from 'react'
import { coreClient } from '../api/client'
import { EmptyState } from '../components/ui/EmptyState.js'

interface ToolStat { toolName: string; callCount: number; avgDurationMs: number; successRate: number }
interface DayStat  { date: string; calls: number; sessions: number }
interface Snapshot {
  totalToolCalls: number
  totalSessions: number
  avgDurationMs: number
  overallSuccessRate: number
  topTools: ToolStat[]
  last7Days: DayStat[]
  decisionBreakdown: Record<string, number>
}

function MiniBar({ value, max, color = '#00c8b4' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-gray-500 w-8 text-right tabular-nums">{value}</span>
    </div>
  )
}

function SparkBar({ days }: { days: DayStat[] }) {
  const maxCalls = Math.max(...days.map(d => d.calls), 1)
  return (
    <div className="flex items-end gap-1 h-16">
      {days.map((d) => {
        const h = Math.round((d.calls / maxCalls) * 100)
        const label = d.date.slice(5)   // MM-DD
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="relative w-full flex flex-col justify-end" style={{ height: 48 }}>
              <div
                className="w-full rounded-sm transition-all duration-500 group-hover:opacity-80"
                style={{
                  height: `${Math.max(h, 4)}%`,
                  background: d.calls > 0
                    ? 'linear-gradient(to top, #00c8b4, #0080ff)'
                    : 'rgba(255,255,255,0.05)',
                }}
              />
            </div>
            <span className="text-gray-600 text-[9px] font-mono">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/8 p-5 surface-panel card-hover">
      <div className="text-xs font-mono text-gray-500 mb-1 tracking-wider">{label}</div>
      <div className="text-3xl font-semibold tabular-nums" style={{ color: accent ?? '#fff' }}>{value}</div>
      {sub && <div className="text-xs text-gray-600 mt-1">{sub}</div>}
    </div>
  )
}

export function Analytics({ onNav }: { onNav: (page: NavPage) => void }) {
  const [data, setData] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    coreClient.getAnalytics()
      .then(setData)
      .catch(() => setError('Could not load analytics. Is coastal-server running?'))
      .finally(() => setLoading(false))
  }, [])

  const refresh = () => {
    setLoading(true)
    coreClient.getAnalytics()
      .then(setData)
      .catch(() => setError('Failed to refresh'))
      .finally(() => setLoading(false))
  }

  return (
    <div className="min-h-screen text-white" style={{ background: '#050a0f' }}>

      <div className="pt-20 pb-12 px-4 sm:px-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Analytics</h1>
            <p className="text-sm text-gray-500 mt-1">Tool call history · all time</p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-xs font-mono text-gray-600 hover:text-gray-400 transition-colors border border-white/5 rounded-lg px-3 py-1.5 hover:border-white/10 disabled:opacity-40"
          >
            {loading ? 'loading...' : '↻ refresh'}
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400 mb-6">{error}</div>
        )}

        {loading && !data ? (
          <div className="text-cyan-500 font-mono text-sm animate-pulse">Loading analytics...</div>
        ) : (!data || data.totalToolCalls === 0) ? (
          <div className="pt-20">
            <EmptyState
              icon="📊"
              title="No activity yet"
              description="Analytics appear once your agents start running. Start a chat or trigger a pipeline to see metrics here."
              action={{ label: '→ Start a Chat', onClick: () => onNav('chat') }}
            />
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
              <StatCard label="TOTAL TOOL CALLS"  value={data.totalToolCalls.toLocaleString()} accent="#00e5ff" />
              <StatCard label="SESSIONS"           value={data.totalSessions.toLocaleString()} />
              <StatCard label="AVG DURATION"       value={data.avgDurationMs ? `${data.avgDurationMs}ms` : '—'} />
              <StatCard label="SUCCESS RATE"       value={`${data.overallSuccessRate}%`}
                accent={data.overallSuccessRate >= 80 ? '#10b981' : data.overallSuccessRate >= 50 ? '#ffb300' : '#ff5252'} />
            </div>

            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              {/* 7-day spark chart */}
              <div className="rounded-xl border border-white/8 p-5 surface-panel">
                <div className="text-xs font-mono text-gray-500 mb-4 tracking-wider">LAST 7 DAYS — TOOL CALLS</div>
                <SparkBar days={data.last7Days} />
              </div>

              {/* Decision breakdown */}
              <div className="rounded-xl border border-white/8 p-5 surface-panel">
                <div className="text-xs font-mono text-gray-500 mb-4 tracking-wider">DECISION BREAKDOWN</div>
                <div className="space-y-3">
                  {Object.entries(data.decisionBreakdown).map(([decision, count]) => {
                    const total = data.totalToolCalls || 1
                    const pct = Math.round((count / total) * 100)
                    const colors: Record<string, string> = {
                      approved: '#10b981', autonomous: '#00c8b4',
                      block: '#ff5252', denied: '#ff5252', timeout: '#ffb300',
                    }
                    return (
                      <div key={decision}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-mono text-gray-400">{decision}</span>
                          <span className="text-gray-500">{count} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colors[decision] ?? '#555' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Top tools */}
            {data.topTools.length > 0 && (
              <div className="rounded-xl border border-white/8 surface-panel overflow-hidden">
                <div className="px-5 py-4 border-b border-white/5">
                  <span className="text-xs font-mono text-gray-500 tracking-wider">TOP TOOLS — LAST 30 DAYS</span>
                </div>
                <div className="divide-y divide-white/4">
                  {data.topTools.map((t) => (
                    <div key={t.toolName} className="px-5 py-3 flex items-center gap-4 hover:bg-white/2 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono text-gray-200 truncate">{t.toolName}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{t.avgDurationMs}ms avg · {t.successRate}% success</p>
                      </div>
                      <div className="w-32 shrink-0">
                        <MiniBar
                          value={t.callCount}
                          max={data.topTools[0]?.callCount ?? 1}
                          color={t.successRate >= 80 ? '#00c8b4' : '#ffb300'}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { coreClient, type ArchitectInsights } from '../../api/client'
import { failureLabel } from '../../utils/architect-labels'
import { useArchitectSSE } from '../../hooks/useArchitectSSE'

export function InsightsTab() {
  const [data, setData] = useState<ArchitectInsights | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    coreClient.architectInsights(30)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh])
  useArchitectSSE(refresh)

  if (loading) return <div className="animate-pulse font-mono text-xs text-cyan-400/60">loading insights...</div>
  if (!data) return <p className="text-xs" style={{ color: '#4a6a8a' }}>Failed to load insights</p>

  const tiles = [
    { label: 'Success Rate', value: `${(data.successRate * 100).toFixed(0)}%`, color: data.successRate > 0.5 ? '#10b981' : '#f59e0b' },
    { label: 'Avg Iterations', value: data.avgIterations.toFixed(1), color: '#00e5ff' },
    { label: 'Time Saved', value: `${Math.round(data.totalDurationMs / 3600000)}h`, color: '#00e5ff' },
    { label: 'Open Queue', value: String(data.openQueueDepth), color: data.openQueueDepth > 5 ? '#f59e0b' : '#94adc4' },
    { label: 'Errors', value: String(data.errorCount), color: data.errorCount > 0 ? '#ef4444' : '#10b981' },
    { label: 'Top Failure', value: failureLabel(data.topFailureKind), color: '#94adc4' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {tiles.map(t => (
        <div key={t.label} className="p-4 rounded-lg" style={{ background: '#0d1f33', border: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="text-[10px] font-mono mb-1" style={{ color: '#4a6a8a' }}>{t.label}</p>
          <p className="text-xl font-semibold" style={{ color: t.color }}>{t.value}</p>
        </div>
      ))}
    </div>
  )
}

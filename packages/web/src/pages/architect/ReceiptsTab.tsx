import { useState, useEffect, useCallback } from 'react'
import { coreClient, type ArchitectReceipts } from '../../api/client'
import { relativeTime } from '../../utils/relative-time'
import { useArchitectSSE } from '../../hooks/useArchitectSSE'

export function ReceiptsTab() {
  const [data, setData] = useState<ArchitectReceipts | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    coreClient.architectReceipts()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh])
  useArchitectSSE(refresh)

  if (loading) return <div className="animate-pulse font-mono text-xs text-cyan-400/60">loading receipts...</div>
  if (!data || data.prs.length === 0) return (
    <div className="text-center py-12">
      <p className="text-sm mb-1" style={{ color: '#94adc4' }}>No receipts yet</p>
      <p className="text-xs" style={{ color: '#4a6a8a' }}>The architect hasn't merged any PRs yet</p>
    </div>
  )

  return (
    <div>
      <div className="mb-4 p-3 rounded-lg" style={{ background: '#0d1f33', border: '1px solid rgba(0, 229, 255, 0.1)' }}>
        <span className="text-xs font-mono" style={{ color: '#00e5ff' }}>{data.totals.prsMerged} PRs merged</span>
      </div>
      <div className="space-y-2">
        {data.prs.map((pr) => (
          <div key={pr.cycleId} className="p-3 rounded-lg" style={{ background: '#0d1f33', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: '#e2f4ff' }}>{pr.planText?.slice(0, 80) ?? 'Untitled'}</span>
              {pr.prUrl && <a href={pr.prUrl} target="_blank" rel="noopener" className="text-[10px] font-mono text-cyan-400 hover:underline shrink-0 ml-2">View PR</a>}
            </div>
            <div className="flex gap-4 mt-1">
              <span className="text-[10px] font-mono" style={{ color: '#4a6a8a' }}>iter {pr.iteration}</span>
              <span className="text-[10px] font-mono" style={{ color: '#4a6a8a' }}>{pr.modelUsed}</span>
              <span className="text-[10px] font-mono" style={{ color: '#4a6a8a' }}>{relativeTime(pr.mergedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

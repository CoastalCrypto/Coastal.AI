import { useState } from 'react'
import { coreClient } from '../../api/client'

export function ApprovalButtons({ cycleId, gate, onDone }: { cycleId: string; gate: string; onDone: () => void }) {
  const [revising, setRevising] = useState(false)
  const [comment, setComment] = useState('')
  const [acting, setActing] = useState(false)

  const act = async (decision: string, commentText?: string) => {
    setActing(true)
    try {
      await coreClient.architectApproval(cycleId, { gate, decision, comment: commentText })
      onDone()
    } catch (err) {
      console.error('[ApprovalButtons] architectApproval failed', err)
    } finally { setActing(false) }
  }

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <p className="text-[10px] font-mono mb-2 text-orange-400">Waiting for your decision</p>
      <div className="flex gap-2 items-center flex-wrap">
        <button onClick={() => act('approved')} disabled={acting}
          className="text-xs font-mono px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-40">
          Approve
        </button>
        <button onClick={() => setRevising(!revising)} disabled={acting}
          className="text-xs font-mono px-3 py-1.5 rounded bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 disabled:opacity-40">
          Revise
        </button>
        <button onClick={() => act('rejected')} disabled={acting}
          className="text-xs font-mono px-3 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40">
          Reject
        </button>
      </div>
      {revising && (
        <div className="mt-2 flex gap-2 animate-slide-up">
          <input className="flex-1 bg-black/30 border border-white/8 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-yellow-500/40 placeholder:text-gray-600"
            placeholder="What should it change?" value={comment} onChange={e => setComment(e.target.value)} autoFocus />
          <button onClick={() => { act('revised', comment); setRevising(false) }} disabled={acting || !comment.trim()}
            className="text-xs font-mono px-3 py-1.5 rounded bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 disabled:opacity-40">
            Send
          </button>
        </div>
      )}
    </div>
  )
}

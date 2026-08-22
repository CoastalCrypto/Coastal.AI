import { useState } from 'react'
import { coreClient } from '../../api/client'

export function PauseButton({ onPaused }: { onPaused: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [acting, setActing] = useState(false)

  const handlePause = async () => {
    setActing(true)
    try {
      await coreClient.architectSetPower('off')
      onPaused()
    } catch (err) {
      console.error('[PauseButton] architectSetPower failed', err)
    } finally {
      setActing(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: '#94adc4' }}>Stop everything?</span>
        <button onClick={handlePause} disabled={acting}
          className="text-xs font-mono px-3 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40">
          {acting ? '...' : 'Yes, Pause'}
        </button>
        <button onClick={() => setConfirming(false)}
          className="text-xs font-mono px-3 py-1.5 text-gray-500 hover:text-gray-300">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button onClick={() => setConfirming(true)}
      className="text-[10px] font-mono px-3 py-1.5 rounded border transition-colors text-red-400/60 border-red-400/20 hover:text-red-400 hover:border-red-400/40 hover:bg-red-500/10">
      PAUSE ALL
    </button>
  )
}

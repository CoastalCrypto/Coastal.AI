import { useEffect, useState } from 'react'

interface ArchitectToastProps {
  proposalId: string
  summary: string
  vetoDeadline: number
  onVeto: () => void
  onDismiss: () => void
}

export function ArchitectToast({ summary, vetoDeadline, onVeto, onDismiss }: ArchitectToastProps) {
  // Date.now() must not be read during render (impure — the result isn't a
  // function of props/state, so it can't be memoized or safely repeated
  // across renders). It also needs to update every second for a countdown
  // to actually count down, which only an effect-driven interval can do.
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setRemainingSeconds(Math.max(0, Math.round((vetoDeadline - Date.now()) / 1000)))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [vetoDeadline])

  return (
    <div className="fixed bottom-36 left-1/2 -translate-x-1/2 z-30 w-[480px] bg-purple-950/95 border border-purple-700 rounded-xl p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-purple-400 font-mono tracking-widest mb-1">ARCHITECT PROPOSAL</div>
          <p className="text-sm text-white leading-snug">{summary}</p>
          <p className="text-xs text-purple-600 mt-1 font-mono">
            veto window: {remainingSeconds === null ? '…' : `${remainingSeconds}s`} remaining
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onVeto}
            className="px-3 py-1.5 text-xs font-mono bg-red-900/60 border border-red-700 text-red-300 hover:bg-red-800 rounded transition-colors"
          >VETO</button>
          <button onClick={onDismiss} className="px-3 py-1.5 text-xs font-mono text-gray-500 hover:text-gray-300 transition-colors">dismiss</button>
        </div>
      </div>
    </div>
  )
}

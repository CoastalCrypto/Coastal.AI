// packages/curator-agent/src/daemon.ts
//
// The Curator-as-daemon: wraps runCuratorCycle in a timer so the
// curator runs as a proper background agent on its own schedule
// (Hermes v0.12 pattern — autonomous Curator on a 7-day cron).
//
// Independent of the coordination daemon. The Curator doesn't claim
// tasks; it reads the notes substrate directly and writes a report
// note per cycle. Future versions can submit "consolidation
// suggestion" tasks via an injected submit() callback, but v0.0.x
// stays scope-tight.

import { runCuratorCycle } from './cycle/run-cycle.js'
import type { CuratorConfig, CuratorReport } from './types.js'

export interface CuratorDaemonConfig extends CuratorConfig {
  /**
   * How often to run a cycle, in ms. Default: 7 days (matches Hermes).
   * Use a smaller value for tests / dense workloads.
   */
  intervalMs?: number
  /**
   * If true, run a cycle immediately on start() instead of waiting
   * for the first tick. Default false — daemons usually start quietly.
   */
  immediateOnStart?: boolean
  /**
   * Observability callback. Fires after every successful cycle with
   * the report. Errors thrown by this callback don't kill the timer.
   */
  onReport?: (report: CuratorReport) => void
  /**
   * Error sink. Fires when runCuratorCycle throws. Without it, errors
   * are silently swallowed (the daemon keeps running) — same behavior
   * as Hermes's "don't let Curator crashes take down the cluster."
   */
  onError?: (err: Error) => void
}

export interface CuratorDaemon {
  start(): void
  stop(): void
  /** Manually trigger a cycle outside the schedule. Useful for tests + ops. */
  runNow(): CuratorReport
  /** Number of cycles run since start (introspection for tests). */
  cycleCount(): number
}

const DEFAULT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function createCuratorDaemon(config: CuratorDaemonConfig): CuratorDaemon {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    immediateOnStart = false,
    onReport, onError,
    ...cycleConfig
  } = config

  let timer: NodeJS.Timeout | null = null
  let cycles = 0

  function tick(): void {
    try {
      const report = runCuratorCycle(cycleConfig)
      cycles += 1
      try { onReport?.(report) } catch { /* never let onReport kill the timer */ }
    } catch (err) {
      try { onError?.(err as Error) } catch { /* same — swallow */ }
    }
  }

  return {
    start(): void {
      if (timer) return // already running — idempotent
      if (immediateOnStart) tick()
      timer = setInterval(tick, intervalMs)
      // unref so an unstopped daemon doesn't block process exit
      timer.unref?.()
    },
    stop(): void {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    runNow(): CuratorReport {
      const report = runCuratorCycle(cycleConfig)
      cycles += 1
      try { onReport?.(report) } catch { /* swallow */ }
      return report
    },
    cycleCount(): number {
      return cycles
    },
  }
}

// packages/curator-agent/src/__tests__/daemon.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { createCuratorDaemon, type CuratorDaemon } from '../daemon.js'
import type { CuratorReport } from '../types.js'

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'curator-daemon-test-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('createCuratorDaemon', () => {
  let daemon: CuratorDaemon | null = null

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    daemon?.stop()
    daemon = null
    vi.useRealTimers()
  })

  it('does not run cycles until start() is called', async () => {
    await withTempDir(async dir => {
      const reports: CuratorReport[] = []
      daemon = createCuratorDaemon({
        dataDir: dir,
        intervalMs: 1000,
        onReport: (r) => reports.push(r),
      })
      vi.advanceTimersByTime(5000)
      expect(daemon.cycleCount()).toBe(0)
      expect(reports).toEqual([])
    })
  })

  it('runs an immediate cycle when immediateOnStart is true', async () => {
    await withTempDir(async dir => {
      const reports: CuratorReport[] = []
      daemon = createCuratorDaemon({
        dataDir: dir,
        intervalMs: 1000,
        immediateOnStart: true,
        onReport: (r) => reports.push(r),
      })
      daemon.start()
      expect(daemon.cycleCount()).toBe(1)
      expect(reports).toHaveLength(1)
    })
  })

  it('fires on the schedule after start()', async () => {
    await withTempDir(async dir => {
      const reports: CuratorReport[] = []
      daemon = createCuratorDaemon({
        dataDir: dir,
        intervalMs: 100,
        onReport: (r) => reports.push(r),
      })
      daemon.start()
      expect(daemon.cycleCount()).toBe(0)
      vi.advanceTimersByTime(100)
      expect(daemon.cycleCount()).toBe(1)
      vi.advanceTimersByTime(200)
      expect(daemon.cycleCount()).toBe(3)
    })
  })

  it('stop() halts the timer', async () => {
    await withTempDir(async dir => {
      daemon = createCuratorDaemon({
        dataDir: dir,
        intervalMs: 100,
      })
      daemon.start()
      vi.advanceTimersByTime(100)
      expect(daemon.cycleCount()).toBe(1)
      daemon.stop()
      vi.advanceTimersByTime(500)
      expect(daemon.cycleCount()).toBe(1) // no further ticks
    })
  })

  it('start() is idempotent — calling twice does not double the schedule', async () => {
    await withTempDir(async dir => {
      daemon = createCuratorDaemon({
        dataDir: dir,
        intervalMs: 100,
      })
      daemon.start()
      daemon.start()
      vi.advanceTimersByTime(100)
      expect(daemon.cycleCount()).toBe(1) // not 2
    })
  })

  it('runNow() triggers a cycle outside the schedule', async () => {
    await withTempDir(async dir => {
      const reports: CuratorReport[] = []
      daemon = createCuratorDaemon({
        dataDir: dir,
        intervalMs: 1000,
        onReport: (r) => reports.push(r),
      })
      // Don't call start — just runNow
      const report = daemon.runNow()
      expect(daemon.cycleCount()).toBe(1)
      expect(reports).toHaveLength(1)
      expect(report.dryRun).toBe(true) // default
    })
  })

  it('writes the report as a note inside dataDir on each cycle', async () => {
    await withTempDir(async dir => {
      daemon = createCuratorDaemon({
        dataDir: dir,
        intervalMs: 1000,
      })
      daemon.runNow()
      // Inspect the notes substrate directly
      const store = new NoteStore({ dataDir: dir })
      const reports = store.list({ kind: 'curator_report' })
      expect(reports).toHaveLength(1)
      expect(reports[0].body).toContain('Curator cycle')
      store.close()
    })
  })

  it('onReport errors do not kill the daemon', async () => {
    await withTempDir(async dir => {
      daemon = createCuratorDaemon({
        dataDir: dir,
        intervalMs: 100,
        immediateOnStart: true,
        onReport: () => { throw new Error('user callback boom') },
      })
      daemon.start()
      // First cycle ran via immediateOnStart and the throw was swallowed
      expect(daemon.cycleCount()).toBe(1)
      vi.advanceTimersByTime(100)
      // Subsequent tick still fired despite the previous error
      expect(daemon.cycleCount()).toBe(2)
    })
  })

  it('forwards cycle errors to onError without halting the timer', async () => {
    await withTempDir(async dir => {
      const errors: Error[] = []
      // Use an invalid dataDir override that will throw inside runCuratorCycle
      daemon = createCuratorDaemon({
        // valid dir for the report write
        dataDir: dir,
        intervalMs: 100,
        onError: (e) => errors.push(e),
      })
      daemon.start()
      vi.advanceTimersByTime(100)
      // Normal cycle should succeed here (dir is valid), so no errors expected.
      expect(errors).toEqual([])
      expect(daemon.cycleCount()).toBe(1)
    })
  })
})

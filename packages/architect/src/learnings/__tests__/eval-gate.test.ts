import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { writeEvalResultAsNote } from '@coastal-ai/core/prompts/eval-notes'
import type { EvalResult } from '@coastal-ai/core/prompts/eval-runner'
import { runEvalGate } from '../eval-gate.js'

let tempDir: string
let store: NoteStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'eval-gate-'))
  store = new NoteStore({ dataDir: tempDir })
})

afterEach(() => {
  store.close()
  rmSync(tempDir, { recursive: true, force: true })
})

function record(opts: { fixtureId: string; ok: boolean; ranAt: number; version?: number }): void {
  const r: EvalResult = {
    promptId: 'planner', promptVersion: opts.version ?? 1, fixtureId: opts.fixtureId,
    fixtureLabel: opts.fixtureId, ok: opts.ok, assertions: [],
    responsePreview: '', responseLength: 0, ranAt: opts.ranAt, durationMs: 1, model: 'mock',
  }
  writeEvalResultAsNote(store, r)
}

describe('runEvalGate', () => {
  it('returns ok=true with a "skipped" message when there is no history', () => {
    const r = runEvalGate(store, 'planner', 1)
    expect(r.ok).toBe(true)
    expect(r.output).toContain('no eval history')
    expect(r.failed).toBe(0)
    expect(r.total).toBe(0)
  })

  it('returns ok=true when every fixture has a passing latest verdict', () => {
    record({ fixtureId: 'a', ok: true, ranAt: 1 })
    record({ fixtureId: 'b', ok: true, ranAt: 2 })
    const r = runEvalGate(store, 'planner', 1)
    expect(r.ok).toBe(true)
    expect(r.total).toBe(2)
  })

  it('returns ok=false when ANY fixture has a failing latest verdict', () => {
    record({ fixtureId: 'a', ok: true, ranAt: 1 })
    record({ fixtureId: 'b', ok: false, ranAt: 2 })
    const r = runEvalGate(store, 'planner', 1)
    expect(r.ok).toBe(false)
    expect(r.failed).toBe(1)
    expect(r.output).toContain('FAILING')
    expect(r.output).toContain('b ')
  })

  it('uses the LATEST verdict per fixture, not the worst-ever', () => {
    record({ fixtureId: 'a', ok: false, ranAt: 1 }) // old failure
    record({ fixtureId: 'a', ok: true, ranAt: 2 })  // newest pass
    expect(runEvalGate(store, 'planner', 1).ok).toBe(true)
  })

  it('only considers the asked-for prompt version', () => {
    record({ fixtureId: 'a', ok: false, ranAt: 1, version: 1 })
    record({ fixtureId: 'a', ok: true, ranAt: 2, version: 2 })
    expect(runEvalGate(store, 'planner', 1).ok).toBe(false)
    expect(runEvalGate(store, 'planner', 2).ok).toBe(true)
  })
})

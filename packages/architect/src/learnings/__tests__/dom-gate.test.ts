import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { writeDomSnapshotAsNote, type DomSnapshot } from '@coastal-ai/core/memory/dom-snapshots'
import { runDomGate } from '../dom-gate.js'

let dir: string
let store: NoteStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dom-gate-'))
  store = new NoteStore({ dataDir: dir })
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

function snap(opts: Partial<DomSnapshot> & { url: string; takenAt: number }): DomSnapshot {
  return {
    url: opts.url,
    status: opts.status ?? 200,
    bodyLength: opts.bodyLength ?? 1000,
    bodyPreview: opts.bodyPreview ?? '<html>ok</html>',
    consoleErrors: opts.consoleErrors ?? [],
    takenAt: opts.takenAt,
    durationMs: opts.durationMs ?? 5,
    ok: opts.ok ?? (opts.status === undefined ? true : opts.status >= 200 && opts.status < 400),
    fetchError: opts.fetchError ?? null,
  }
}

describe('runDomGate baseline behavior', () => {
  it('returns ok=true when no baseline exists for any URL', () => {
    const r = runDomGate(store, [snap({ url: 'http://a', takenAt: 1 })])
    expect(r.ok).toBe(true)
    expect(r.perUrl[0].hadBaseline).toBe(false)
    expect(r.perUrl[0].detail).toContain('baseline initialized')
  })

  it('returns ok=true with summary when no URLs given', () => {
    const r = runDomGate(store, [])
    expect(r.ok).toBe(true)
    expect(r.output).toContain('no URLs configured')
  })
})

describe('runDomGate regression detection', () => {
  it('passes when fresh snapshot is healthy and matches baseline shape', () => {
    writeDomSnapshotAsNote(store, snap({ url: 'http://a', takenAt: 1, bodyLength: 1000 }))
    const r = runDomGate(store, [snap({ url: 'http://a', takenAt: 2, bodyLength: 1000 })])
    expect(r.ok).toBe(true)
    expect(r.perUrl[0].detail).toContain('no new errors')
  })

  it('fails when fresh snapshot itself errored (network / 5xx)', () => {
    writeDomSnapshotAsNote(store, snap({ url: 'http://a', takenAt: 1 }))
    const r = runDomGate(store, [snap({ url: 'http://a', takenAt: 2, status: 500, ok: false })])
    expect(r.ok).toBe(false)
    expect(r.perUrl[0].detail).toContain('fresh snapshot failed')
  })

  it('fails when status regressed from 2xx to 4xx', () => {
    writeDomSnapshotAsNote(store, snap({ url: 'http://a', takenAt: 1, status: 200 }))
    const r = runDomGate(store, [snap({ url: 'http://a', takenAt: 2, status: 404, ok: false })])
    expect(r.ok).toBe(false)
    expect(r.perUrl[0].detail).toContain('fresh snapshot failed')
  })

  it('fails when body shrinks more than the configured ratio', () => {
    writeDomSnapshotAsNote(store, snap({ url: 'http://a', takenAt: 1, bodyLength: 1000 }))
    const r = runDomGate(store, [snap({ url: 'http://a', takenAt: 2, bodyLength: 100 })])
    expect(r.ok).toBe(false)
    expect(r.perUrl[0].detail).toMatch(/body shrank \d+%/)
  })

  it('respects a custom shrinkRatio (loose threshold passes shrink that strict would catch)', () => {
    writeDomSnapshotAsNote(store, snap({ url: 'http://a', takenAt: 1, bodyLength: 1000 }))
    // 50% shrink: tripped at default 0.30 ratio, allowed at 0.60.
    const fresh = [snap({ url: 'http://a', takenAt: 2, bodyLength: 500 })]
    expect(runDomGate(store, fresh).ok).toBe(false)
    expect(runDomGate(store, fresh, { shrinkRatio: 0.60 }).ok).toBe(true)
  })

  it('fails when new console errors appear vs baseline', () => {
    writeDomSnapshotAsNote(store, snap({ url: 'http://a', takenAt: 1, consoleErrors: ['existing'] }))
    const r = runDomGate(store, [
      snap({ url: 'http://a', takenAt: 2, consoleErrors: ['existing', 'new error'] }),
    ])
    expect(r.ok).toBe(false)
    expect(r.perUrl[0].detail).toContain('1 new console error')
  })

  it('passes when baseline already had the same console errors (no regression)', () => {
    writeDomSnapshotAsNote(store, snap({ url: 'http://a', takenAt: 1, consoleErrors: ['x', 'y'] }))
    const r = runDomGate(store, [
      snap({ url: 'http://a', takenAt: 2, consoleErrors: ['x', 'y'] }),
    ])
    expect(r.ok).toBe(true)
  })

  it('aggregates a multi-URL verdict (any failure ⇒ overall fail)', () => {
    writeDomSnapshotAsNote(store, snap({ url: 'http://a', takenAt: 1, bodyLength: 1000 }))
    writeDomSnapshotAsNote(store, snap({ url: 'http://b', takenAt: 1, bodyLength: 1000 }))
    const r = runDomGate(store, [
      snap({ url: 'http://a', takenAt: 2, bodyLength: 1000 }),    // pass
      snap({ url: 'http://b', takenAt: 2, bodyLength: 100 }),     // shrink fail
    ])
    expect(r.ok).toBe(false)
    expect(r.perUrl).toHaveLength(2)
    expect(r.perUrl.find(p => p.url === 'http://a')!.ok).toBe(true)
    expect(r.perUrl.find(p => p.url === 'http://b')!.ok).toBe(false)
  })

  it("treats only OK snapshots as the baseline (ignores prior failures)", () => {
    writeDomSnapshotAsNote(store, snap({ url: 'http://a', takenAt: 1, status: 200, bodyLength: 1000 }))
    writeDomSnapshotAsNote(store, snap({ url: 'http://a', takenAt: 2, status: 500, ok: false }))
    // Even though the most-recent snapshot was a failure, the gate compares
    // against the latest *OK* one (1000 chars) — our 1000-char fresh is ok.
    const r = runDomGate(store, [snap({ url: 'http://a', takenAt: 3, bodyLength: 1000 })])
    expect(r.ok).toBe(true)
  })
})

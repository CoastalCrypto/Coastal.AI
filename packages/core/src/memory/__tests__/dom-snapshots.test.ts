import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import {
  writeDomSnapshotAsNote, writeDomSnapshotsAsNotes,
  recentDomNotes, latestOkSnapshot, latestSnapshot,
  domNoteId, domSourceId, urlSlug,
  type DomSnapshot,
} from '../dom-snapshots.js'

let tempDir: string
let store: NoteStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'dom-snap-'))
  store = new NoteStore({ dataDir: tempDir })
})

afterEach(() => {
  store.close()
  rmSync(tempDir, { recursive: true, force: true })
})

function snap(opts: Partial<DomSnapshot> & { url: string; takenAt: number }): DomSnapshot {
  return {
    url: opts.url,
    status: opts.status ?? 200,
    bodyLength: opts.bodyLength ?? 100,
    bodyPreview: opts.bodyPreview ?? '<html>ok</html>',
    consoleErrors: opts.consoleErrors ?? [],
    takenAt: opts.takenAt,
    durationMs: opts.durationMs ?? 5,
    ok: opts.ok ?? (opts.status === undefined ? true : opts.status >= 200 && opts.status < 400),
    fetchError: opts.fetchError ?? null,
  }
}

describe('urlSlug', () => {
  it('strips protocol and slug-ifies the rest', () => {
    expect(urlSlug('http://localhost:4747/api/admin/architect/status'))
      .toBe('localhost-4747-api-admin-architect-status')
  })

  it('handles https + query strings deterministically', () => {
    const a = urlSlug('https://example.com/x?a=1')
    const b = urlSlug('https://example.com/x?a=1')
    expect(a).toBe(b)
  })

  it('caps to 200 chars', () => {
    const huge = 'http://x.com/' + 'a'.repeat(500)
    expect(urlSlug(huge).length).toBeLessThanOrEqual(200)
  })
})

describe('writeDomSnapshotAsNote', () => {
  it('persists a kind=dom note with deterministic id and source scoping', () => {
    const s = snap({ url: 'http://x/y', takenAt: 100 })
    const ref = writeDomSnapshotAsNote(store, s)
    expect(ref.noteId).toBe(domNoteId(s))
    const note = store.get(ref.noteId)!
    expect(note.kind).toBe('dom')
    expect(note.sourceType).toBe('dom-snapshot')
    expect(note.sourceId).toBe(domSourceId('http://x/y'))
    expect(note.title.startsWith('✓')).toBe(true)
  })

  it('marks failed snapshots with ✗ and includes status', () => {
    const s = snap({ url: 'http://x/y', takenAt: 1, status: 500, ok: false })
    const note = store.get(writeDomSnapshotAsNote(store, s).noteId)!
    expect(note.title.startsWith('✗')).toBe(true)
    expect(note.title).toContain('500')
  })

  it('embeds machine-readable snapshot-meta block in the body', () => {
    const s = snap({ url: 'http://x/y', takenAt: 1, bodyLength: 999 })
    const note = store.get(writeDomSnapshotAsNote(store, s).noteId)!
    expect(note.body).toContain('```snapshot-meta')
    expect(note.body).toContain('"bodyLength":999')
  })

  it('includes console errors when present', () => {
    const s = snap({ url: 'http://x', takenAt: 1, consoleErrors: ['TypeError: undefined'] })
    const note = store.get(writeDomSnapshotAsNote(store, s).noteId)!
    expect(note.body).toContain('TypeError: undefined')
  })
})

describe('writeDomSnapshotsAsNotes', () => {
  it('persists every snapshot and returns refs', () => {
    const refs = writeDomSnapshotsAsNotes(store, [
      snap({ url: 'http://x/a', takenAt: 1 }),
      snap({ url: 'http://x/b', takenAt: 2 }),
    ])
    expect(refs).toHaveLength(2)
    expect(store.list({ kind: 'dom' })).toHaveLength(2)
  })
})

describe('recentDomNotes', () => {
  it('returns history newest-first scoped to a single URL', () => {
    writeDomSnapshotsAsNotes(store, [
      snap({ url: 'http://x/a', takenAt: 100 }),
      snap({ url: 'http://x/a', takenAt: 300 }),
      snap({ url: 'http://x/a', takenAt: 200 }),
      snap({ url: 'http://x/b', takenAt: 250 }),
    ])
    const a = recentDomNotes(store, 'http://x/a')
    expect(a).toHaveLength(3)
    expect(a.every(n => n.id.includes(urlSlug('http://x/a')))).toBe(true)
    expect(Number(a[0].id.split(':').pop())).toBe(300)
    expect(Number(a[2].id.split(':').pop())).toBe(100)
  })

  it('returns [] for a URL with no history', () => {
    expect(recentDomNotes(store, 'http://nothing')).toEqual([])
  })
})

describe('latestOkSnapshot', () => {
  it('returns the most recent OK snapshot, ignoring failures', () => {
    writeDomSnapshotsAsNotes(store, [
      snap({ url: 'http://x', takenAt: 100, status: 200 }),       // ok
      snap({ url: 'http://x', takenAt: 200, status: 500, ok: false }), // fail
      snap({ url: 'http://x', takenAt: 300, status: 500, ok: false }), // fail
    ])
    const baseline = latestOkSnapshot(store, 'http://x')
    expect(baseline).not.toBeNull()
    expect(baseline!.takenAt).toBe(100)
    expect(baseline!.status).toBe(200)
  })

  it('returns null when there is no OK snapshot in the history', () => {
    writeDomSnapshotsAsNotes(store, [
      snap({ url: 'http://x', takenAt: 1, status: 500, ok: false }),
    ])
    expect(latestOkSnapshot(store, 'http://x')).toBeNull()
  })

  it('round-trips bodyLength and consoleErrors through the body', () => {
    writeDomSnapshotAsNote(store, snap({
      url: 'http://x', takenAt: 1, bodyLength: 4242,
      consoleErrors: ['err1', 'err2'],
    }))
    const baseline = latestOkSnapshot(store, 'http://x')!
    expect(baseline.bodyLength).toBe(4242)
    expect(baseline.consoleErrors).toEqual(['err1', 'err2'])
  })
})

describe('latestSnapshot', () => {
  it('returns the most recent snapshot of any verdict', () => {
    writeDomSnapshotsAsNotes(store, [
      snap({ url: 'http://x', takenAt: 1, status: 200 }),
      snap({ url: 'http://x', takenAt: 2, status: 500, ok: false }),
    ])
    const latest = latestSnapshot(store, 'http://x')
    expect(latest!.takenAt).toBe(2)
    expect(latest!.ok).toBe(false)
  })
})

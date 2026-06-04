// packages/curator-agent/src/__tests__/heuristics.test.ts

import { describe, it, expect } from 'vitest'
import type { Note, NoteLink } from '@coastal-ai/core/memory/notes'
import {
  isOrphan, isStale, isDeadCodeGraph, isLowTrust, isRecentlyTouched,
  type HeuristicContext,
} from '../grading/heuristics.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function noteAt(props: Partial<Note> = {}): Note {
  const now = Date.now()
  return {
    id: 'n-1',
    title: 'test',
    body: '',
    kind: 'cycle',
    sourceType: null,
    sourceId: null,
    createdAt: now,
    updatedAt: now,
    ...props,
  }
}

function ctxAt(props: Partial<HeuristicContext> = {}): HeuristicContext {
  return {
    now: Date.now(),
    outgoing: [],
    backlinks: [],
    lowTrustRejectionThreshold: 5,
    ...props,
  }
}

describe('isOrphan', () => {
  it('flags a fully orphaned note past the threshold', () => {
    const now = Date.now()
    const note = noteAt({ updatedAt: now - 100 * MS_PER_DAY })
    const result = isOrphan(note, ctxAt({ now }), { orphanAfterDays: 90 })
    expect(result?.verdict).toBe('prune')
  })

  it('does not flag if the note has outgoing links', () => {
    const note = noteAt({ updatedAt: Date.now() - 100 * MS_PER_DAY })
    const link: NoteLink = { fromId: 'n-1', toId: 'n-2', kind: 'mentions', createdAt: 0 }
    const result = isOrphan(note, ctxAt({ outgoing: [link] }), { orphanAfterDays: 90 })
    expect(result).toBeNull()
  })

  it('does not flag if the note has backlinks', () => {
    const note = noteAt({ updatedAt: Date.now() - 100 * MS_PER_DAY })
    const link: NoteLink = { fromId: 'n-2', toId: 'n-1', kind: 'mentions', createdAt: 0 }
    const result = isOrphan(note, ctxAt({ backlinks: [link] }), { orphanAfterDays: 90 })
    expect(result).toBeNull()
  })

  it('does not flag if under the age threshold', () => {
    const now = Date.now()
    const note = noteAt({ updatedAt: now - 30 * MS_PER_DAY })
    const result = isOrphan(note, ctxAt({ now }), { orphanAfterDays: 90 })
    expect(result).toBeNull()
  })

  it('respects neverPrune rule', () => {
    const note = noteAt({ updatedAt: Date.now() - 1000 * MS_PER_DAY })
    const result = isOrphan(note, ctxAt(), { neverPrune: true, orphanAfterDays: 1 })
    expect(result).toBeNull()
  })
})

describe('isStale', () => {
  it('flags a note past staleAfterDays even if linked', () => {
    const now = Date.now()
    const note = noteAt({ updatedAt: now - 400 * MS_PER_DAY })
    const link: NoteLink = { fromId: 'n-2', toId: 'n-1', kind: 'mentions', createdAt: 0 }
    const result = isStale(note, ctxAt({ now, backlinks: [link] }), { staleAfterDays: 365 })
    expect(result?.verdict).toBe('prune')
  })

  it('skips if the kind has no staleAfterDays rule', () => {
    const note = noteAt({ updatedAt: Date.now() - 10000 * MS_PER_DAY })
    const result = isStale(note, ctxAt(), {})
    expect(result).toBeNull()
  })
})

describe('isDeadCodeGraph', () => {
  it('flags code-graph notes whose source file is gone', () => {
    const note = noteAt({
      kind: 'code', sourceType: 'file', sourceId: '/some/missing/file.ts',
    })
    const result = isDeadCodeGraph(note, ctxAt({ fileExists: () => false }), {})
    expect(result?.verdict).toBe('prune')
    expect(result?.reason).toContain('no longer exists')
  })

  it('does not flag if the file still exists', () => {
    const note = noteAt({
      kind: 'code', sourceType: 'file', sourceId: '/some/file.ts',
    })
    const result = isDeadCodeGraph(note, ctxAt({ fileExists: () => true }), {})
    expect(result).toBeNull()
  })

  it('is a no-op for non-code kinds', () => {
    const note = noteAt({ kind: 'design', sourceType: 'file', sourceId: '/foo.md' })
    const result = isDeadCodeGraph(note, ctxAt({ fileExists: () => false }), {})
    expect(result).toBeNull()
  })

  it('returns null when fileExists callback is not provided', () => {
    const note = noteAt({ kind: 'code', sourceType: 'file', sourceId: '/x.ts' })
    const result = isDeadCodeGraph(note, ctxAt(), {})
    expect(result).toBeNull()
  })
})

describe('isLowTrust', () => {
  it('escalates when rejection count exceeds threshold', () => {
    const note = noteAt()
    const result = isLowTrust(note, ctxAt({
      mentionRejectionCount: 7,
      lowTrustRejectionThreshold: 5,
    }), {})
    expect(result?.verdict).toBe('escalate')
  })

  it('does not escalate when under threshold', () => {
    const note = noteAt()
    const result = isLowTrust(note, ctxAt({
      mentionRejectionCount: 3,
      lowTrustRejectionThreshold: 5,
    }), {})
    expect(result).toBeNull()
  })
})

describe('isRecentlyTouched', () => {
  it('keeps a note touched within the last 3 days', () => {
    const now = Date.now()
    const note = noteAt({ updatedAt: now - 1 * MS_PER_DAY })
    const result = isRecentlyTouched(note, ctxAt({ now }), {})
    expect(result?.verdict).toBe('keep')
  })

  it('does not vote on older notes', () => {
    const now = Date.now()
    const note = noteAt({ updatedAt: now - 10 * MS_PER_DAY })
    const result = isRecentlyTouched(note, ctxAt({ now }), {})
    expect(result).toBeNull()
  })
})

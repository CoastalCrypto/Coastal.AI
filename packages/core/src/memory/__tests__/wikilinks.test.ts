import { describe, it, expect } from 'vitest'
import {
  parseWikilinks, parseMentions, parseAll, defaultShouldLink,
  makeLearnedPolicy, MIN_REJECTIONS_TO_BLOCK,
} from '../wikilinks.js'

describe('parseWikilinks', () => {
  it('extracts a single wikilink', () => {
    const refs = parseWikilinks('see [[Architect]] for more')
    expect(refs).toHaveLength(1)
    expect(refs[0].target).toBe('Architect')
    expect(refs[0].start).toBe(4)
    expect(refs[0].end).toBe(17)
  })

  it('extracts multiple wikilinks', () => {
    const refs = parseWikilinks('[[A]] and [[B]] then [[C]]')
    expect(refs.map(r => r.target)).toEqual(['A', 'B', 'C'])
  })

  it('trims whitespace inside brackets', () => {
    const refs = parseWikilinks('[[  spaced title  ]]')
    expect(refs[0].target).toBe('spaced title')
  })

  it('ignores empty brackets', () => {
    expect(parseWikilinks('[[]] hello [[ ]]')).toHaveLength(0)
  })

  it('does not match across newlines', () => {
    expect(parseWikilinks('[[broken\nlink]]')).toHaveLength(0)
  })

  it('handles ids as targets', () => {
    const refs = parseWikilinks('see [[note-abc-123]]')
    expect(refs[0].target).toBe('note-abc-123')
  })
})

describe('parseMentions', () => {
  const entities = new Map<string, string[]>([
    ['arch-id', ['Architect']],
    ['cycle-id', ['cycle 42', 'cycle42']],
    ['file-id', ['user-profile/store.ts']],
  ])

  it('finds whole-word mentions of registered entities', () => {
    const refs = parseMentions('the Architect ran cycle 42 today', entities)
    expect(refs).toHaveLength(2)
    expect(refs.map(r => r.target).sort()).toEqual(['arch-id', 'cycle-id'])
  })

  it('is case-insensitive but resolves to canonical key', () => {
    const refs = parseMentions('the architect ran', entities)
    expect(refs).toHaveLength(1)
    expect(refs[0].target).toBe('arch-id')
  })

  it('skips spans inside wikilinks to avoid double-counting', () => {
    const refs = parseMentions('see [[Architect]] for the architect details', entities)
    // The wikilink span is skipped; the bare "architect" later in the
    // sentence still matches.
    expect(refs).toHaveLength(1)
    expect(refs[0].start).toBeGreaterThan(15)
  })

  it('respects word boundaries (no substring matches)', () => {
    const refs = parseMentions('the antiarchitecture pattern', entities)
    expect(refs).toHaveLength(0)
  })

  it('matches multi-word aliases with normalized whitespace', () => {
    const refs = parseMentions('we ran cycle  42 yesterday', entities)
    expect(refs).toHaveLength(1)
    expect(refs[0].target).toBe('cycle-id')
  })

  it('matches file-path style aliases', () => {
    const refs = parseMentions('the bug is in user-profile/store.ts probably', entities)
    expect(refs).toHaveLength(1)
    expect(refs[0].target).toBe('file-id')
  })

  it('honors a custom shouldLink predicate (e.g. context filtering)', () => {
    const refs = parseMentions(
      'the Architect was wrong here',
      entities,
      (target, surrounding) => !surrounding.includes('wrong'),
    )
    expect(refs).toHaveLength(0)
  })

  it('emits each occurrence in source order', () => {
    const refs = parseMentions('Architect did X. Then the Architect did Y.', entities)
    expect(refs).toHaveLength(2)
    expect(refs[0].start).toBeLessThan(refs[1].start)
  })
})

describe('defaultShouldLink', () => {
  it('rejects stopwords', () => {
    expect(defaultShouldLink('the', '')).toBe(false)
    expect(defaultShouldLink('core', '')).toBe(false)
  })

  it('rejects very short targets', () => {
    expect(defaultShouldLink('ab', '')).toBe(false)
  })

  it('accepts ordinary entity names', () => {
    expect(defaultShouldLink('Architect', '')).toBe(true)
    expect(defaultShouldLink('user-profile', '')).toBe(true)
  })
})

describe('makeLearnedPolicy', () => {
  const baseEntities = new Map<string, string[]>([['noisy-id', ['Noisy']]])
  const allowAll = (_t: string, _s: string) => true
  const cleanStats = () => ({ kept: 0, rejected: 0, lastRejectedAt: null })

  it('falls back to the base predicate when target has no feedback', () => {
    const stats = (_t: string) => cleanStats()
    const policy = makeLearnedPolicy(stats, { base: allowAll })
    expect(policy('Noisy', '')).toBe(true)
  })

  it('still respects defaultShouldLink rules even with clean feedback', () => {
    const stats = (_t: string) => cleanStats()
    const policy = makeLearnedPolicy(stats) // base = defaultShouldLink
    expect(policy('the', '')).toBe(false) // stopword still blocked
  })

  it('keeps allowing while rejections < threshold', () => {
    const stats = (_t: string) => ({ kept: 1, rejected: MIN_REJECTIONS_TO_BLOCK - 1, lastRejectedAt: 1 })
    const policy = makeLearnedPolicy(stats, { base: allowAll })
    expect(policy('Noisy', '')).toBe(true)
  })

  it('blocks once rejections >= threshold AND ratio >= 0.5', () => {
    const stats = (_t: string) => ({ kept: 1, rejected: 4, lastRejectedAt: 1 })
    const policy = makeLearnedPolicy(stats, { base: allowAll })
    expect(policy('Noisy', '')).toBe(false)
  })

  it('keeps allowing when many kept edges drown out rejections', () => {
    const stats = (_t: string) => ({ kept: 20, rejected: 4, lastRejectedAt: 1 })
    const policy = makeLearnedPolicy(stats, { base: allowAll })
    expect(policy('Noisy', '')).toBe(true)
  })

  it('respects custom thresholds passed in config', () => {
    const stats = (_t: string) => ({ kept: 0, rejected: 1, lastRejectedAt: 1 })
    const strict = makeLearnedPolicy(stats, { base: allowAll, minRejections: 1, rejectionRatio: 0.1 })
    expect(strict('Noisy', '')).toBe(false)
  })

  it('integrates with parseMentions to suppress flagged targets', () => {
    const stats = (target: string) =>
      target === 'noisy-id'
        ? { kept: 0, rejected: 10, lastRejectedAt: 1 }
        : cleanStats()
    const policy = makeLearnedPolicy(stats)
    const refs = parseMentions('the Noisy thing happened today', baseEntities, policy)
    expect(refs).toHaveLength(0)
  })
})

describe('parseAll', () => {
  it('returns both wikilinks and mentions in one pass', () => {
    const entities = new Map<string, string[]>([['arch', ['Architect']]])
    const result = parseAll('see [[Roadmap]] then ask the Architect', entities)
    expect(result.wikilinks).toHaveLength(1)
    expect(result.wikilinks[0].target).toBe('Roadmap')
    expect(result.mentions).toHaveLength(1)
    expect(result.mentions[0].target).toBe('arch')
  })
})

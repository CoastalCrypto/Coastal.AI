import { describe, it, expect, beforeEach } from 'vitest'
import {
  CORE_KINDS, registerKind, allKinds, isRegisteredKind,
  _resetKindsRegistryForTests,
} from '../kinds-registry.js'

beforeEach(() => {
  _resetKindsRegistryForTests()
})

describe('CORE_KINDS', () => {
  it('contains the eight generic kinds (no vertical-specific ones)', () => {
    expect([...CORE_KINDS]).toEqual([
      'cycle', 'learning', 'code', 'design', 'eval',
      'dom', 'visual_diff', 'user',
    ])
    expect((CORE_KINDS as readonly string[])).not.toContain('trade')
  })
})

describe('registerKind', () => {
  it('adds a new kind to allKinds()', () => {
    registerKind('trade')
    expect(allKinds()).toContain('trade')
  })

  it('is idempotent for the same kind', () => {
    registerKind('trade')
    registerKind('trade')
    expect(allKinds().filter(k => k === 'trade')).toHaveLength(1)
  })

  it('does not duplicate when registering a core kind', () => {
    registerKind('user')
    expect(allKinds().filter(k => k === 'user')).toHaveLength(1)
  })

  it('rejects names with invalid characters', () => {
    expect(() => registerKind('Trade')).toThrow(/invalid kind/)
    expect(() => registerKind('trade-signal')).toThrow(/invalid kind/)
    expect(() => registerKind('trade signal')).toThrow(/invalid kind/)
    expect(() => registerKind('1trade')).toThrow(/invalid kind/)
    expect(() => registerKind('')).toThrow(/invalid kind/)
  })

  it('accepts snake_case names that lead with a letter', () => {
    expect(() => registerKind('image_gen')).not.toThrow()
    expect(() => registerKind('audio_clip')).not.toThrow()
    expect(() => registerKind('a')).not.toThrow()
  })
})

describe('allKinds', () => {
  it('returns sorted core kinds when no dynamic kinds registered', () => {
    expect(allKinds()).toEqual([...CORE_KINDS].sort())
  })

  it('returns core + dynamic kinds in sorted order', () => {
    registerKind('trade')
    registerKind('image_gen')
    const kinds = allKinds()
    // Verify it includes everything and is sorted
    expect(kinds).toContain('trade')
    expect(kinds).toContain('image_gen')
    expect([...kinds]).toEqual([...kinds].sort())
  })
})

describe('isRegisteredKind', () => {
  it('returns true for every core kind', () => {
    for (const k of CORE_KINDS) expect(isRegisteredKind(k)).toBe(true)
  })

  it('returns false for an unregistered string', () => {
    expect(isRegisteredKind('trade')).toBe(false)
    expect(isRegisteredKind('nonsense')).toBe(false)
  })

  it('returns true after registerKind', () => {
    expect(isRegisteredKind('trade')).toBe(false)
    registerKind('trade')
    expect(isRegisteredKind('trade')).toBe(true)
  })
})

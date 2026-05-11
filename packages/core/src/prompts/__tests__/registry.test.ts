import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerPrompt, getPrompt, getLatestPrompt, listPrompts,
  _resetPromptRegistryForTests,
  type PromptDefinition,
} from '../registry.js'

beforeEach(() => {
  _resetPromptRegistryForTests()
})

const samplePrompt: PromptDefinition<{ name: string }> = {
  id: 'greeting',
  version: 1,
  description: 'simple greeting',
  expectedVars: ['name'],
  render: (v) => `Hello, ${v.name}!`,
}

describe('registerPrompt + getPrompt', () => {
  it('registers and retrieves by (id, version)', () => {
    registerPrompt(samplePrompt)
    const def = getPrompt<{ name: string }>('greeting', 1)
    expect(def.render({ name: 'Coastal' })).toBe('Hello, Coastal!')
  })

  it('throws when retrieving an unregistered prompt', () => {
    expect(() => getPrompt('missing', 1)).toThrow(/no such prompt/)
  })

  it('throws on duplicate (id, version) with a different definition', () => {
    registerPrompt(samplePrompt)
    expect(() => registerPrompt({
      ...samplePrompt,
      render: (v) => `Hi ${v.name}`,
    })).toThrow(/duplicate/)
  })

  it('is idempotent for the SAME definition object (HMR / re-import safe)', () => {
    registerPrompt(samplePrompt)
    expect(() => registerPrompt(samplePrompt)).not.toThrow()
  })

  it('allows multiple versions of the same id', () => {
    registerPrompt(samplePrompt)
    registerPrompt({ ...samplePrompt, version: 2, render: (v) => `Yo ${v.name}` })
    expect(getPrompt('greeting', 1).render({ name: 'A' })).toBe('Hello, A!')
    expect(getPrompt('greeting', 2).render({ name: 'A' })).toBe('Yo A')
  })
})

describe('getLatestPrompt', () => {
  it('returns null for an unknown id', () => {
    expect(getLatestPrompt('nothing')).toBeNull()
  })

  it('returns the highest registered version', () => {
    registerPrompt({ ...samplePrompt, version: 1 })
    registerPrompt({ ...samplePrompt, version: 3, render: (v) => `v3 ${v.name}` })
    registerPrompt({ ...samplePrompt, version: 2, render: (v) => `v2 ${v.name}` })
    const latest = getLatestPrompt<{ name: string }>('greeting')
    expect(latest!.version).toBe(3)
    expect(latest!.render({ name: 'X' })).toBe('v3 X')
  })
})

describe('listPrompts', () => {
  it('returns an empty array when registry is empty', () => {
    expect(listPrompts()).toEqual([])
  })

  it('returns a sorted snapshot (id asc, version asc)', () => {
    registerPrompt({ ...samplePrompt, id: 'b', version: 1 })
    registerPrompt({ ...samplePrompt, id: 'a', version: 2 })
    registerPrompt({ ...samplePrompt, id: 'a', version: 1 })
    const list = listPrompts()
    expect(list.map(p => `${p.id}@${p.version}`)).toEqual(['a@1', 'a@2', 'b@1'])
  })

  it('includes description and expectedVars', () => {
    registerPrompt(samplePrompt)
    const [first] = listPrompts()
    expect(first.description).toBe('simple greeting')
    expect(first.expectedVars).toEqual(['name'])
  })
})

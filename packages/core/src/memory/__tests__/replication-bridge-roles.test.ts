import { describe, it, expect } from 'vitest'
import { workerSelector, type Note } from '../replication-bridge.js'

const local = { origin: null } as Note
const replicated = { origin: 'node-9' } as Note

describe('bridge role selectors', () => {
  it('worker inbox exports only locally-authored notes', () => {
    expect(workerSelector(local)).toBe(true)
    expect(workerSelector(replicated)).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { workerFor } from '../worker-table.js'

describe('workerFor', () => {
  it('returns a worker function for every role (passthrough for unwired roles)', () => {
    for (const role of ['coder', 'curator', 'monitor', 'sandbox'] as const) {
      expect(typeof workerFor(role)).toBe('function')
    }
  })
})

import { describe, it, expect } from 'vitest'
import { ROLE_SPECS, shouldClaimFor } from '../roles.js'
import { NodeRole } from '../config.js'
import type { Task } from '../../types.js'

describe('ROLE_SPECS', () => {
  it('has a spec for every NodeRole', () => {
    for (const role of NodeRole.options) expect(ROLE_SPECS[role]).toBeDefined()
  })
  it('has exactly one curator-replication role', () => {
    const curators = Object.values(ROLE_SPECS).filter(s => s.replicationRole === 'curator')
    expect(curators).toHaveLength(1)
  })
})

describe('shouldClaimFor', () => {
  it('claims only tasks whose kind is in the role taskKinds', () => {
    const claim = shouldClaimFor(ROLE_SPECS.coder)
    expect(claim({ kind: 'code_task' } as Task)).toBe(true)
    expect(claim({ kind: 'review_task' } as Task)).toBe(false)
  })
})

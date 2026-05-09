import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openArchitectDb } from '../../db.js'
import { UserProfileStore } from '../store.js'

let tempDir: string
let db: Database.Database
let store: UserProfileStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'arch-userprof-'))
  db = openArchitectDb(join(tempDir, 'architect.db'))
  store = new UserProfileStore(db)
})

afterEach(() => {
  if (db && db.open) db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('UserProfileStore.getDefault', () => {
  it('returns a profile with the documented defaults on a fresh db', () => {
    const p = store.getDefault()
    expect(p.id).toBe('default')
    expect(p.planVerbosity).toBe('standard')
    expect(p.autoApproveThreshold).toBe('never')
    expect(p.testStrictness).toBe('must-pass')
    expect(p.gatePolicy).toBe('every-stage')
    expect(p.tone).toBe('standard')
    expect(p.iterationPatience).toBe('stop-at-budget')
    expect(p.riskPosture).toBe('balanced')
  })

  it('is idempotent — second call returns same row', () => {
    const a = store.getDefault()
    const b = store.getDefault()
    expect(a.createdAt).toBe(b.createdAt)
  })
})

describe('UserProfileStore.update', () => {
  it('applies a partial update and bumps updated_at', async () => {
    const before = store.getDefault()
    // Tiny delay so updated_at can move forward in ms
    await new Promise(r => setTimeout(r, 5))
    const after = store.update('default', { tone: 'terse', riskPosture: 'experimental' })
    expect(after?.tone).toBe('terse')
    expect(after?.riskPosture).toBe('experimental')
    expect(after?.planVerbosity).toBe('standard') // untouched
    expect(after!.updatedAt).toBeGreaterThan(before.updatedAt)
  })

  it('treats an empty patch as a no-op (returns current state)', () => {
    const before = store.getDefault()
    const after = store.update('default', {})
    expect(after?.updatedAt).toBe(before.updatedAt)
  })

  it('ignores keys that are not real preference columns', () => {
    const result = store.update('default', { foo: 'bar' } as never)
    expect(result?.tone).toBe('standard')
  })

  it('returns null for unknown id', () => {
    expect(store.update('nope', { tone: 'terse' })).toBeNull()
  })

  it('rejects an invalid enum value via CHECK constraint', () => {
    expect(() => store.update('default', { tone: 'shouting' as never }))
      .toThrow(/CHECK/)
  })
})

describe('UserProfileStore.getOrCreate', () => {
  it('creates a new profile row for an arbitrary id', () => {
    const created = store.getOrCreate('user_42')
    expect(created.id).toBe('user_42')
    expect(created.tone).toBe('standard')
  })

  it('returns existing row on second call (does not reset)', () => {
    store.getOrCreate('user_42')
    store.update('user_42', { tone: 'terse' })
    const fetched = store.getOrCreate('user_42')
    expect(fetched.tone).toBe('terse')
  })
})

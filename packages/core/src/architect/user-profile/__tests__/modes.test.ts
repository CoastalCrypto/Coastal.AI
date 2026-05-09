import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openArchitectDb } from '../../db.js'
import { UserProfileStore } from '../store.js'
import { ARCHITECT_MODES, MODE_PRESETS, applyMode, deriveMode } from '../modes.js'

let tempDir: string
let db: Database.Database
let store: UserProfileStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'arch-modes-'))
  db = openArchitectDb(join(tempDir, 'architect.db'))
  store = new UserProfileStore(db)
})

afterEach(() => {
  if (db && db.open) db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('MODE_PRESETS', () => {
  it('defines a preset for every architect mode', () => {
    for (const mode of ARCHITECT_MODES) {
      expect(MODE_PRESETS[mode]).toBeDefined()
    }
  })

  it('every preset specifies all three mode-controlled knobs', () => {
    for (const mode of ARCHITECT_MODES) {
      const preset = MODE_PRESETS[mode]
      expect(preset.gatePolicy).toBeDefined()
      expect(preset.autoApproveThreshold).toBeDefined()
      expect(preset.testStrictness).toBeDefined()
    }
  })

  it('presets are mutually distinguishable', () => {
    // If two presets had identical values, deriveMode would be ambiguous.
    const fingerprints = ARCHITECT_MODES.map(m => JSON.stringify(MODE_PRESETS[m]))
    expect(new Set(fingerprints).size).toBe(ARCHITECT_MODES.length)
  })
})

describe('applyMode', () => {
  it('hands-on writes every-stage / never / must-pass', () => {
    const after = applyMode(store, 'default', 'hands-on')
    expect(after?.gatePolicy).toBe('every-stage')
    expect(after?.autoApproveThreshold).toBe('never')
    expect(after?.testStrictness).toBe('must-pass')
  })

  it('hands-off writes plan-only / low-risk-only / must-pass', () => {
    const after = applyMode(store, 'default', 'hands-off')
    expect(after?.gatePolicy).toBe('plan-only')
    expect(after?.autoApproveThreshold).toBe('low-risk-only')
    expect(after?.testStrictness).toBe('must-pass')
  })

  it('autopilot writes merge-only / aggressive / warn', () => {
    const after = applyMode(store, 'default', 'autopilot')
    expect(after?.gatePolicy).toBe('merge-only')
    expect(after?.autoApproveThreshold).toBe('aggressive')
    expect(after?.testStrictness).toBe('warn')
  })

  it('does not touch knobs outside the engagement axis', () => {
    store.update('default', { tone: 'terse', riskPosture: 'experimental' })
    const after = applyMode(store, 'default', 'autopilot')
    expect(after?.tone).toBe('terse')
    expect(after?.riskPosture).toBe('experimental')
  })

  it("'custom' is a no-op — leaves all knobs unchanged", () => {
    const before = applyMode(store, 'default', 'autopilot')
    const after = applyMode(store, 'default', 'custom')
    expect(after).toEqual(before)
  })

  it('returns null for unknown id', () => {
    expect(applyMode(store, 'no-such-id', 'autopilot')).toBeNull()
  })
})

describe('deriveMode', () => {
  it("returns 'hands-on' for the seeded default profile", () => {
    // Default profile happens to match the hands-on preset.
    const p = store.getDefault()
    expect(deriveMode(p)).toBe('hands-on')
  })

  it("returns 'autopilot' after applying the autopilot preset", () => {
    const p = applyMode(store, 'default', 'autopilot')!
    expect(deriveMode(p)).toBe('autopilot')
  })

  it("returns 'custom' when one mode-controlled knob drifts off-preset", () => {
    applyMode(store, 'default', 'autopilot')
    const drifted = store.update('default', { testStrictness: 'must-pass' })!
    expect(deriveMode(drifted)).toBe('custom')
  })

  it("ignores drift in non-mode knobs (tone change keeps mode stable)", () => {
    applyMode(store, 'default', 'hands-off')
    const drifted = store.update('default', { tone: 'terse' })!
    expect(deriveMode(drifted)).toBe('hands-off')
  })
})

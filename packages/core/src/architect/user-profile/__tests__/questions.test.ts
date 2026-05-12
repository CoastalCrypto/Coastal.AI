import { describe, it, expect } from 'vitest'
import { PREFERENCE_QUESTIONS, answersToProfilePatch } from '../questions.js'
import type { UserProfilePatch } from '../store.js'
import {
  PLAN_VERBOSITIES, AUTO_APPROVE_THRESHOLDS, TEST_STRICTNESSES,
  GATE_POLICIES, TONES, ITERATION_PATIENCES, RISK_POSTURES,
} from '../store.js'

describe('PREFERENCE_QUESTIONS', () => {
  it('has exactly 7 questions', () => {
    expect(PREFERENCE_QUESTIONS).toHaveLength(7)
  })

  it('every question id is a valid UserProfilePatch key', () => {
    const validKeys: Array<keyof UserProfilePatch> = [
      'planVerbosity', 'autoApproveThreshold', 'testStrictness',
      'gatePolicy', 'tone', 'iterationPatience', 'riskPosture',
    ]
    for (const q of PREFERENCE_QUESTIONS) {
      expect(validKeys).toContain(q.id)
    }
  })

  it('every question id is unique (no duplicates)', () => {
    const ids = PREFERENCE_QUESTIONS.map(q => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every option value matches its column enum', () => {
    const enumByKey: Record<keyof UserProfilePatch, readonly string[]> = {
      planVerbosity: PLAN_VERBOSITIES,
      autoApproveThreshold: AUTO_APPROVE_THRESHOLDS,
      testStrictness: TEST_STRICTNESSES,
      gatePolicy: GATE_POLICIES,
      tone: TONES,
      iterationPatience: ITERATION_PATIENCES,
      riskPosture: RISK_POSTURES,
    }
    for (const q of PREFERENCE_QUESTIONS) {
      const validValues = enumByKey[q.id]
      for (const opt of q.options) {
        expect(validValues, `question ${q.id} option ${opt.value} must be a valid enum`)
          .toContain(opt.value)
      }
    }
  })

  it('every default value is one of the question options', () => {
    for (const q of PREFERENCE_QUESTIONS) {
      const optionValues = q.options.map(o => o.value)
      expect(optionValues).toContain(q.default)
    }
  })

  it('every question covers all enum values exactly once', () => {
    const enumByKey: Record<keyof UserProfilePatch, readonly string[]> = {
      planVerbosity: PLAN_VERBOSITIES,
      autoApproveThreshold: AUTO_APPROVE_THRESHOLDS,
      testStrictness: TEST_STRICTNESSES,
      gatePolicy: GATE_POLICIES,
      tone: TONES,
      iterationPatience: ITERATION_PATIENCES,
      riskPosture: RISK_POSTURES,
    }
    for (const q of PREFERENCE_QUESTIONS) {
      const optionValues = q.options.map(o => o.value).sort()
      const enumValues = [...enumByKey[q.id]].sort()
      expect(optionValues).toEqual(enumValues)
    }
  })
})

describe('answersToProfilePatch', () => {
  it('returns an empty patch for an empty answer set', () => {
    expect(answersToProfilePatch({})).toEqual({})
  })

  it('translates valid answers verbatim', () => {
    const patch = answersToProfilePatch({
      tone: 'terse',
      riskPosture: 'experimental',
      planVerbosity: 'detailed',
    })
    expect(patch).toEqual({
      tone: 'terse',
      riskPosture: 'experimental',
      planVerbosity: 'detailed',
    })
  })

  it('drops unknown keys', () => {
    const patch = answersToProfilePatch({
      tone: 'terse',
      mood: 'happy',
    })
    expect(patch).toEqual({ tone: 'terse' })
    expect((patch as Record<string, unknown>).mood).toBeUndefined()
  })

  it('drops invalid values for known keys', () => {
    const patch = answersToProfilePatch({
      tone: 'shouting',
      planVerbosity: 'detailed',
    })
    expect(patch).toEqual({ planVerbosity: 'detailed' })
  })

  it('drops non-string values for known keys', () => {
    const patch = answersToProfilePatch({
      tone: 42,
      riskPosture: null,
      planVerbosity: 'brief',
    })
    expect(patch).toEqual({ planVerbosity: 'brief' })
  })
})

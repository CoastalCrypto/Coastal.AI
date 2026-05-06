import type { UserProfilePatch } from './store.js'
import {
  PLAN_VERBOSITIES, AUTO_APPROVE_THRESHOLDS, TEST_STRICTNESSES,
  GATE_POLICIES, TONES, ITERATION_PATIENCES, RISK_POSTURES,
} from './store.js'

export interface PreferenceOption {
  value: string
  label: string
  rationale: string
}

export interface PreferenceQuestion {
  id: keyof UserProfilePatch
  prompt: string
  options: PreferenceOption[]
  default: string
}

/**
 * The 7 onboarding-wizard questions. Each maps 1:1 to a column in
 * user_profile. Order matters — this is the order users see them.
 */
export const PREFERENCE_QUESTIONS: PreferenceQuestion[] = [
  {
    id: 'planVerbosity',
    prompt: 'When the architect explains its plan, how much detail do you want?',
    options: [
      { value: 'brief',    label: 'Brief',    rationale: 'Headline change + rationale only' },
      { value: 'standard', label: 'Standard', rationale: 'Headline + key files + risks' },
      { value: 'detailed', label: 'Detailed', rationale: 'Step-by-step with alternatives considered' },
    ],
    default: 'standard',
  },
  {
    id: 'tone',
    prompt: 'How conversational should the architect be?',
    options: [
      { value: 'terse',       label: 'Terse',       rationale: 'Just the facts, minimal narration' },
      { value: 'standard',    label: 'Standard',    rationale: 'Brief framing where it helps' },
      { value: 'explanatory', label: 'Explanatory', rationale: 'Walks through reasoning' },
    ],
    default: 'standard',
  },
  {
    id: 'autoApproveThreshold',
    prompt: 'When should the architect merge without asking?',
    options: [
      { value: 'never',         label: 'Never',         rationale: 'Always require human approval' },
      { value: 'low-risk-only', label: 'Low-risk only', rationale: 'Auto-merge tests, docs, and small refactors' },
      { value: 'aggressive',    label: 'Aggressive',    rationale: 'Auto-merge whenever gates pass' },
    ],
    default: 'low-risk-only',
  },
  {
    id: 'gatePolicy',
    prompt: 'Where should the architect pause to check in with you?',
    options: [
      { value: 'every-stage', label: 'Every stage', rationale: 'Plan, build, and merge each ask first' },
      { value: 'plan-only',   label: 'Plan only',   rationale: 'Approve the plan, then it runs' },
      { value: 'merge-only',  label: 'Merge only',  rationale: 'Only ask before opening a PR' },
    ],
    default: 'plan-only',
  },
  {
    id: 'testStrictness',
    prompt: 'How strict should the test gate be?',
    options: [
      { value: 'must-pass', label: 'Must pass', rationale: 'Failed tests block the cycle' },
      { value: 'warn',      label: 'Warn',      rationale: 'Failed tests log a warning but proceed' },
      { value: 'advisory',  label: 'Advisory',  rationale: 'Tests run for info; failures never block' },
    ],
    default: 'must-pass',
  },
  {
    id: 'iterationPatience',
    prompt: 'How many revision attempts should the architect try before giving up?',
    options: [
      { value: 'stop-at-2',      label: 'Stop at 2',         rationale: 'Surface failures fast' },
      { value: 'stop-at-5',      label: 'Stop at 5',         rationale: 'Default — some patience for tricky problems' },
      { value: 'stop-at-budget', label: 'Use the work item budget', rationale: 'Whatever was set on the work item' },
    ],
    default: 'stop-at-budget',
  },
  {
    id: 'riskPosture',
    prompt: 'How adventurous should the architect be when choosing approaches?',
    options: [
      { value: 'conservative', label: 'Conservative', rationale: 'Prefer well-trodden patterns from the codebase' },
      { value: 'balanced',     label: 'Balanced',     rationale: 'Default — match the existing style' },
      { value: 'experimental', label: 'Experimental', rationale: 'OK to try new patterns when they fit better' },
    ],
    default: 'balanced',
  },
]

const VALID_VALUES: Record<keyof UserProfilePatch, readonly string[]> = {
  planVerbosity: PLAN_VERBOSITIES,
  autoApproveThreshold: AUTO_APPROVE_THRESHOLDS,
  testStrictness: TEST_STRICTNESSES,
  gatePolicy: GATE_POLICIES,
  tone: TONES,
  iterationPatience: ITERATION_PATIENCES,
  riskPosture: RISK_POSTURES,
}

/**
 * Translates the wizard's answer dict into a UserProfilePatch. Drops
 * unknown keys and invalid values (caller can detect what was dropped by
 * comparing input keys to output keys).
 */
export function answersToProfilePatch(
  answers: Record<string, unknown>,
): UserProfilePatch {
  const patch: UserProfilePatch = {}
  for (const q of PREFERENCE_QUESTIONS) {
    const v = answers[q.id]
    if (typeof v === 'string' && (VALID_VALUES[q.id] as readonly string[]).includes(v)) {
      ;(patch as Record<string, string>)[q.id] = v
    }
  }
  return patch
}

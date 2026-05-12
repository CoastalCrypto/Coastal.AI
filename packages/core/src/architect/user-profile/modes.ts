import type { UserProfile, UserProfilePatch, UserProfileStore } from './store.js'

export const ARCHITECT_MODES = ['hands-on', 'hands-off', 'autopilot'] as const
export type ArchitectMode = typeof ARCHITECT_MODES[number]

// 'custom' is not a stored mode; it's what GET /status returns when the
// profile knobs don't match any preset. Callers should accept 'custom'
// in writes for API symmetry but treat it as a no-op (drift is implicit
// — to leave 'custom' state, write a non-custom mode).
export type ModeOrCustom = ArchitectMode | 'custom'

/**
 * The three mode presets fan out to a subset of the user_profile knobs:
 * the "engagement axis" — gatePolicy, autoApproveThreshold, and
 * testStrictness. Other knobs (tone, planVerbosity, iterationPatience,
 * riskPosture) are independent power-user knobs that mode never touches.
 *
 * Edit a value here and the corresponding mode immediately means the new
 * thing on next write. Running cycles keep their previous behavior until
 * the next per-cycle profile read.
 */
export const MODE_PRESETS: Record<ArchitectMode, Required<Pick<UserProfilePatch,
  'gatePolicy' | 'autoApproveThreshold' | 'testStrictness'
>>> = {
  'hands-on': {
    gatePolicy: 'every-stage',
    autoApproveThreshold: 'never',
    testStrictness: 'must-pass',
  },
  'hands-off': {
    gatePolicy: 'plan-only',
    autoApproveThreshold: 'low-risk-only',
    testStrictness: 'must-pass',
  },
  'autopilot': {
    gatePolicy: 'merge-only',
    autoApproveThreshold: 'aggressive',
    testStrictness: 'warn',
  },
}

/** The three knob keys that participate in mode derivation. */
const MODE_KEYS = ['gatePolicy', 'autoApproveThreshold', 'testStrictness'] as const

/**
 * Applies the preset for `mode` to the user_profile row identified by
 * `id`. 'custom' is a deliberate no-op so callers can pass through any
 * value the API accepts. Returns the resulting profile, or null if the
 * row doesn't exist (matching UserProfileStore.update's contract).
 */
export function applyMode(
  store: UserProfileStore,
  id: string,
  mode: ModeOrCustom,
): UserProfile | null {
  if (mode === 'custom') return store.getById(id)
  return store.update(id, MODE_PRESETS[mode])
}

/**
 * Inspects the three mode-controlled knobs and returns the matching
 * preset name, or 'custom' if no preset matches exactly. The other four
 * knobs are ignored — adjusting `tone` doesn't move you off your mode.
 */
export function deriveMode(profile: UserProfile): ModeOrCustom {
  for (const mode of ARCHITECT_MODES) {
    const preset = MODE_PRESETS[mode]
    const matches = MODE_KEYS.every(k => profile[k] === preset[k])
    if (matches) return mode
  }
  return 'custom'
}

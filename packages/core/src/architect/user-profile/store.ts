import type Database from 'better-sqlite3'

export const PLAN_VERBOSITIES = ['brief', 'standard', 'detailed'] as const
export type PlanVerbosity = typeof PLAN_VERBOSITIES[number]

export const AUTO_APPROVE_THRESHOLDS = ['never', 'low-risk-only', 'aggressive'] as const
export type AutoApproveThreshold = typeof AUTO_APPROVE_THRESHOLDS[number]

export const TEST_STRICTNESSES = ['must-pass', 'warn', 'advisory'] as const
export type TestStrictness = typeof TEST_STRICTNESSES[number]

export const GATE_POLICIES = ['every-stage', 'plan-only', 'merge-only'] as const
export type GatePolicy = typeof GATE_POLICIES[number]

export const TONES = ['terse', 'standard', 'explanatory'] as const
export type Tone = typeof TONES[number]

export const ITERATION_PATIENCES = ['stop-at-2', 'stop-at-5', 'stop-at-budget'] as const
export type IterationPatience = typeof ITERATION_PATIENCES[number]

export const RISK_POSTURES = ['conservative', 'balanced', 'experimental'] as const
export type RiskPosture = typeof RISK_POSTURES[number]

export interface UserProfile {
  id: string
  planVerbosity: PlanVerbosity
  autoApproveThreshold: AutoApproveThreshold
  testStrictness: TestStrictness
  gatePolicy: GatePolicy
  tone: Tone
  iterationPatience: IterationPatience
  riskPosture: RiskPosture
  createdAt: number
  updatedAt: number
}

export type UserProfilePatch = Partial<Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt'>>

interface UserProfileRow {
  id: string
  plan_verbosity: PlanVerbosity
  auto_approve_threshold: AutoApproveThreshold
  test_strictness: TestStrictness
  gate_policy: GatePolicy
  tone: Tone
  iteration_patience: IterationPatience
  risk_posture: RiskPosture
  created_at: number
  updated_at: number
}

function rowToProfile(row: UserProfileRow): UserProfile {
  return {
    id: row.id,
    planVerbosity: row.plan_verbosity,
    autoApproveThreshold: row.auto_approve_threshold,
    testStrictness: row.test_strictness,
    gatePolicy: row.gate_policy,
    tone: row.tone,
    iterationPatience: row.iteration_patience,
    riskPosture: row.risk_posture,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const COLUMN_FOR_KEY: Record<keyof UserProfilePatch, string> = {
  planVerbosity: 'plan_verbosity',
  autoApproveThreshold: 'auto_approve_threshold',
  testStrictness: 'test_strictness',
  gatePolicy: 'gate_policy',
  tone: 'tone',
  iterationPatience: 'iteration_patience',
  riskPosture: 'risk_posture',
}

export class UserProfileStore {
  constructor(private db: Database.Database) {}

  /** Returns the default profile, creating it if absent (idempotent guard). */
  getDefault(): UserProfile {
    return this.getOrCreate('default')
  }

  getOrCreate(id: string): UserProfile {
    const existing = this.getById(id)
    if (existing) return existing
    const now = Date.now()
    this.db.prepare(`
      INSERT OR IGNORE INTO user_profile (id, created_at, updated_at)
      VALUES (?, ?, ?)
    `).run(id, now, now)
    return this.getById(id)!
  }

  getById(id: string): UserProfile | null {
    const row = this.db.prepare('SELECT * FROM user_profile WHERE id = ?').get(id) as UserProfileRow | undefined
    return row ? rowToProfile(row) : null
  }

  /**
   * Applies a partial update. Empty patches are no-ops. Unknown keys are
   * ignored (defensive: API request body validation should reject them
   * upstream, but we don't trust the caller).
   */
  update(id: string, patch: UserProfilePatch): UserProfile | null {
    const entries = Object.entries(patch).filter(([k]) => k in COLUMN_FOR_KEY)
    if (entries.length === 0) return this.getById(id)

    const setClauses = entries
      .map(([k]) => `${COLUMN_FOR_KEY[k as keyof UserProfilePatch]} = ?`)
      .join(', ')
    const values = entries.map(([, v]) => v)

    const now = Date.now()
    const result = this.db.prepare(
      `UPDATE user_profile SET ${setClauses}, updated_at = ? WHERE id = ?`
    ).run(...values, now, id)

    if (result.changes === 0) return null
    return this.getById(id)
  }
}

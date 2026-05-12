import { describe, it, expect } from 'vitest'
import {
  WORK_ITEM_STATUSES,
  CYCLE_STAGES,
  CYCLE_OUTCOMES,
  APPROVAL_POLICIES,
  PRIORITIES,
  SOURCES,
  CYCLE_KINDS,
  FAILURE_KINDS,
} from '../types.js'

describe('architect status vocabulary', () => {
  it('work_item statuses match the spec exactly', () => {
    expect(WORK_ITEM_STATUSES).toEqual([
      'pending', 'active', 'awaiting_human',
      'merged', 'cancelled', 'error', 'paused',
    ])
  })

  it('cycle stages do NOT include curriculum (kind discriminator handles that)', () => {
    expect(CYCLE_STAGES).toEqual([
      'planning', 'plan_review', 'building', 'pr_review', 'done', 'cancelled',
    ])
    expect(CYCLE_STAGES).not.toContain('curriculum')
  })

  it('cycle outcomes cover spec values + Plan-1 transitional "built"', () => {
    expect(CYCLE_OUTCOMES).toEqual([
      'merged', 'built', 'failed', 'vetoed', 'error', 'revised',
    ])
  })

  it('cycle kinds discriminate normal vs curriculum_scan', () => {
    expect(CYCLE_KINDS).toEqual(['normal', 'curriculum_scan'])
  })

  it('approval policies match spec', () => {
    expect(APPROVAL_POLICIES).toEqual(['full', 'plan-only', 'pr-only', 'none'])
  })

  it('priorities are listed in PRIORITIES array as high → normal → low (front-of-queue first)', () => {
    expect(PRIORITIES).toEqual(['high', 'normal', 'low'])
  })

  it('sources include all 6 spec values including curriculum and skill_md', () => {
    expect(SOURCES).toEqual([
      'ui', 'markdown', 'skill_md', 'github', 'skill_gap', 'curriculum',
    ])
  })

  it('failure kinds cover soft-fail and hard env_* taxonomy', () => {
    expect(FAILURE_KINDS).toEqual([
      'parse', 'apply', 'locked', 'budget',
      'lint', 'type', 'build', 'test', 'eval',
      'env_branch', 'env_gh', 'env_push', 'env_perm', 'env_db', 'env_llm',
    ])
  })
})

// packages/curator-agent/src/grading/heuristics.ts
//
// Individual grading heuristics. Each is a pure function: given a note
// and its context, returns a verdict slice (or null = no opinion).
//
// The grader (next module) collects opinions from every heuristic and
// resolves them into a single per-note verdict via a precedence policy.

import type { Note, NoteLink } from '@coastal-ai/core/memory/notes'
import type { KindRules } from '../types.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface HeuristicContext {
  now: number
  outgoing: NoteLink[]
  backlinks: NoteLink[]
  /** Returns true iff the source file (for kind='code' notes) is alive. */
  fileExists?: (sourcePath: string) => boolean
  /** Mention rejection count for this note's id (kept vs. rejected feedback). */
  mentionRejectionCount?: number
  /** Threshold from CuratorConfig.lowTrustRejectionThreshold (default 5). */
  lowTrustRejectionThreshold: number
}

export interface HeuristicOpinion {
  /**
   * Suggested verdict. 'keep' means "I see no problem here." Heuristics
   * that don't apply return null instead of 'keep'.
   */
  verdict: 'keep' | 'prune' | 'escalate'
  reason: string
}

/**
 * Note has zero outgoing AND zero backlinks. Combined with sufficient
 * age, this is a strong "delete me" signal.
 */
export function isOrphan(
  note: Note,
  ctx: HeuristicContext,
  rules: KindRules,
): HeuristicOpinion | null {
  if (rules.neverPrune) return null
  const threshold = rules.orphanAfterDays
  if (threshold === undefined) return null
  if (ctx.outgoing.length > 0 || ctx.backlinks.length > 0) return null
  const ageDays = (ctx.now - note.updatedAt) / MS_PER_DAY
  if (ageDays < threshold) return null
  return {
    verdict: 'prune',
    reason: `orphan (no links) ${ageDays.toFixed(0)}d > ${threshold}d`,
  }
}

/**
 * Note hasn't been updated in a long time, even if it still has links.
 * Per-kind threshold; defaults to a year for unspecified kinds.
 */
export function isStale(
  note: Note,
  ctx: HeuristicContext,
  rules: KindRules,
): HeuristicOpinion | null {
  if (rules.neverPrune) return null
  const threshold = rules.staleAfterDays
  if (threshold === undefined) return null
  const ageDays = (ctx.now - note.updatedAt) / MS_PER_DAY
  if (ageDays < threshold) return null
  return {
    verdict: 'prune',
    reason: `stale ${ageDays.toFixed(0)}d > ${threshold}d`,
  }
}

/**
 * Code-graph note whose source file no longer exists. Strong prune
 * signal — the note is referencing dead code.
 *
 * Requires CuratorConfig.fileExists callback. Without it, returns null.
 */
export function isDeadCodeGraph(
  note: Note,
  ctx: HeuristicContext,
  rules: KindRules,
): HeuristicOpinion | null {
  if (rules.neverPrune) return null
  if (note.kind !== 'code') return null
  if (!ctx.fileExists) return null
  // Code-graph entries record their source via sourceType='file' + sourceId='<path>'
  if (note.sourceType !== 'file' || !note.sourceId) return null
  if (ctx.fileExists(note.sourceId)) return null
  return {
    verdict: 'prune',
    reason: `code-graph source ${note.sourceId} no longer exists`,
  }
}

/**
 * Note's id has been rejected many times by the user (high
 * mention-feedback rejection count). Doesn't mean prune outright —
 * escalate for human attention.
 */
export function isLowTrust(
  note: Note,
  ctx: HeuristicContext,
  _rules: KindRules,
): HeuristicOpinion | null {
  if (ctx.mentionRejectionCount === undefined) return null
  if (ctx.mentionRejectionCount < ctx.lowTrustRejectionThreshold) return null
  return {
    verdict: 'escalate',
    reason: `mention-feedback rejected ${ctx.mentionRejectionCount}× — user attention needed`,
  }
}

/**
 * Recently updated despite being an orphan — possibly a work-in-progress
 * the user just hasn't linked yet. Override prune with escalate.
 */
export function isRecentlyTouched(
  note: Note,
  ctx: HeuristicContext,
  _rules: KindRules,
): HeuristicOpinion | null {
  const ageDays = (ctx.now - note.updatedAt) / MS_PER_DAY
  if (ageDays > 3) return null
  // Only meaningful for notes that other heuristics might prune
  return {
    verdict: 'keep',
    reason: `recently touched (${ageDays.toFixed(1)}d) — defer to user`,
  }
}

/**
 * Authoritative heuristics: their verdict is final, no soft override.
 *
 * - isDeadCodeGraph — file doesn't exist; the note is wrong by definition.
 *   Recently-touched can't defer this; the note is referencing dead code.
 * - isLowTrust — the user has explicitly rejected this many times;
 *   surfacing for review is more useful than silently keeping.
 */
export const AUTHORITATIVE_HEURISTICS: ReadonlyArray<
  (note: Note, ctx: HeuristicContext, rules: KindRules) => HeuristicOpinion | null
> = [
  isDeadCodeGraph,
  isLowTrust,
] as const

/**
 * Soft heuristics: can be overridden by isRecentlyTouched (the user is
 * actively working on this; defer to them).
 */
export const SOFT_HEURISTICS: ReadonlyArray<
  (note: Note, ctx: HeuristicContext, rules: KindRules) => HeuristicOpinion | null
> = [
  isOrphan,
  isStale,
] as const

/** All heuristics, in canonical evaluation order. Kept for callers that want a flat view. */
export const ALL_HEURISTICS: ReadonlyArray<
  (note: Note, ctx: HeuristicContext, rules: KindRules) => HeuristicOpinion | null
> = [
  ...AUTHORITATIVE_HEURISTICS,
  ...SOFT_HEURISTICS,
  isRecentlyTouched,
] as const

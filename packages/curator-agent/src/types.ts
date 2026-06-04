// packages/curator-agent/src/types.ts
//
// Type contracts for the Curator agent. The Curator is the Hermes v0.12
// pattern: an agent that runs on its own schedule and grades/prunes/
// consolidates the notes substrate so quality doesn't erode over time.
//
// Three terminal verdicts per note:
//   keep        — note is healthy, no action
//   prune       — note is stale, orphaned, or low-trust; delete
//   consolidate — note has duplicates within its (kind, title); merge
//
// Plus an escalation pathway for edge cases where heuristics conflict
// or rules don't have enough confidence — surfaced to the user.

import type { Note, NoteKind } from '@coastal-ai/core/memory/notes'

// ─── Action verdicts ────────────────────────────────────────────────

export const VERDICTS = ['keep', 'prune', 'consolidate', 'escalate'] as const
export type Verdict = typeof VERDICTS[number]

export interface NoteVerdict {
  noteId: string
  noteKind: NoteKind
  noteTitle: string
  verdict: Verdict
  /** One-line human-readable explanation of why this verdict was chosen. */
  reason: string
  /**
   * For 'consolidate', the canonical id to merge into.
   * For 'prune' / 'keep' / 'escalate', null.
   */
  consolidateInto?: string | null
}

// ─── Per-kind rule configuration ────────────────────────────────────

export interface KindRules {
  /** Days of inactivity (since updatedAt) past which the note is considered stale. */
  staleAfterDays?: number
  /** Days of inactivity past which a fully orphan note (no in/out links) is prunable. */
  orphanAfterDays?: number
  /** If true, never prune notes of this kind (sacred — user-authored, etc.). */
  neverPrune?: boolean
  /** If true, never consolidate notes of this kind (uniqueness assumed). */
  neverConsolidate?: boolean
}

/**
 * Default rules. Concrete kinds can override per-kind in CuratorConfig.kindRules.
 *
 * Notes on the choices:
 *   - 'user' is sacred: never prune, never consolidate
 *   - 'eval' / 'cycle' are audit kinds: prune slowly (1 year)
 *   - 'dom' / 'visual_diff' are snapshots: prune fast (7 days)
 *   - 'code' is code-graph: prune at 60 days if orphaned (file-aliveness
 *     check is a separate heuristic)
 *   - 'design' / 'learning': moderate retention
 */
export const DEFAULT_KIND_RULES: Record<string, KindRules> = {
  user:        { neverPrune: true, neverConsolidate: true },
  eval:        { staleAfterDays: 365 },
  cycle:       { staleAfterDays: 365, orphanAfterDays: 90 },
  dom:         { staleAfterDays: 7,   orphanAfterDays: 7 },
  visual_diff: { staleAfterDays: 7,   orphanAfterDays: 7 },
  code:        { orphanAfterDays: 60 },
  design:      { orphanAfterDays: 180 },
  learning:    { staleAfterDays: 180, orphanAfterDays: 90 },
  // Unrecognized kinds fall through to GLOBAL_DEFAULT_RULES below.
}

export const GLOBAL_DEFAULT_RULES: KindRules = {
  staleAfterDays: 365,
  orphanAfterDays: 90,
}

// ─── Cycle configuration ────────────────────────────────────────────

export interface CuratorConfig {
  /** Path to the NoteStore data dir. The Curator opens its own connection. */
  dataDir: string
  /**
   * If true, the cycle reports what it would do but does NOT mutate.
   * Default true — match Hermes v0.12 conservative behavior.
   */
  dryRun?: boolean
  /** Per-kind rule overrides. Merged on top of DEFAULT_KIND_RULES. */
  kindRules?: Record<string, KindRules>
  /**
   * Optional callback to check whether a code-graph note's source file
   * still exists. The Curator can't depend on the filesystem layout
   * directly; the daemon injects this. Without it, source-aliveness
   * pruning is skipped.
   */
  fileExists?: (sourcePath: string) => boolean
  /**
   * Mention-feedback rejection count past which a target is considered
   * low-trust and its notes flagged for escalation. Default 5.
   */
  lowTrustRejectionThreshold?: number
  /** Override clock for tests. */
  now?: () => number
}

// ─── Cycle output ───────────────────────────────────────────────────

export interface CuratorReport {
  /** When the cycle ran. */
  startedAt: number
  finishedAt: number
  /** Total notes considered. */
  notesScanned: number
  /** True iff the cycle was dry-run (no mutations executed). */
  dryRun: boolean
  /** Per-verdict counts. */
  counts: Record<Verdict, number>
  /** Detailed verdicts — capped at REPORT_VERDICT_DETAIL_LIMIT for readability. */
  verdicts: NoteVerdict[]
  /**
   * If executed (dryRun=false), this is the count of notes actually
   * deleted / consolidated. May be lower than verdicts.prune if a note
   * was missing or a delete failed.
   */
  executed?: {
    pruned: number
    consolidated: number
  }
}

export const REPORT_VERDICT_DETAIL_LIMIT = 200

// Re-export Note for downstream convenience
export type { Note, NoteKind }

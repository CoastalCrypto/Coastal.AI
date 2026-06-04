// packages/curator-agent/src/grading/grader.ts
//
// Resolves opinions from heuristics into a single verdict per note.
// Two-tier precedence:
//
//   1. AUTHORITATIVE — dead-code-graph (file gone → note is wrong) or
//      low-trust (user has rejected this many times → escalate).
//      Nothing overrides these.
//   2. SOFT — orphan or stale → propose prune, but allow
//      isRecentlyTouched to defer ("user is actively working on this").
//
// This two-tier model exists because the v0 grader's single-precedence
// policy gave isRecentlyTouched 'keep' the wrong precedence over
// isDeadCodeGraph 'prune' — a fresh code-graph note for a deleted file
// would be incorrectly kept.

import type { Note } from '@coastal-ai/core/memory/notes'
import type { NoteVerdict, KindRules, Verdict } from '../types.js'
import { DEFAULT_KIND_RULES, GLOBAL_DEFAULT_RULES } from '../types.js'
import {
  AUTHORITATIVE_HEURISTICS,
  SOFT_HEURISTICS,
  isRecentlyTouched,
  type HeuristicContext, type HeuristicOpinion,
} from './heuristics.js'

// Within the SOFT tier, when multiple opinions are produced, escalate
// wins over prune (defer to humans rather than auto-delete).
const SOFT_PRECEDENCE: Record<Verdict, number> = {
  keep: 0,
  escalate: 1,
  prune: 2,
  consolidate: 3, // not produced by heuristics
}

export function rulesFor(
  kind: string,
  overrides: Record<string, KindRules> = {},
): KindRules {
  return {
    ...GLOBAL_DEFAULT_RULES,
    ...(DEFAULT_KIND_RULES[kind] ?? {}),
    ...(overrides[kind] ?? {}),
  }
}

function verdictFrom(note: Note, op: HeuristicOpinion): NoteVerdict {
  return {
    noteId: note.id,
    noteKind: note.kind,
    noteTitle: note.title,
    verdict: op.verdict,
    reason: op.reason,
  }
}

export function gradeNote(
  note: Note,
  ctx: HeuristicContext,
  kindRules: Record<string, KindRules> = {},
): NoteVerdict {
  const rules = rulesFor(note.kind, kindRules)

  // Tier 1: authoritative. First non-null opinion wins.
  for (const h of AUTHORITATIVE_HEURISTICS) {
    const op = h(note, ctx, rules)
    if (op) return verdictFrom(note, op)
  }

  // Tier 2: soft prune signals — pick the strongest.
  const softOps: HeuristicOpinion[] = []
  for (const h of SOFT_HEURISTICS) {
    const op = h(note, ctx, rules)
    if (op) softOps.push(op)
  }

  if (softOps.length === 0) {
    return verdictFrom(note, {
      verdict: 'keep',
      reason: 'no heuristic flagged this note',
    })
  }

  // Recently-touched can defer soft prune signals — the user is
  // actively working on this note; let them decide.
  const recent = isRecentlyTouched(note, ctx, rules)
  if (recent) return verdictFrom(note, recent)

  // Otherwise the strongest soft opinion wins.
  let best = softOps[0]
  for (const op of softOps.slice(1)) {
    if (SOFT_PRECEDENCE[op.verdict] < SOFT_PRECEDENCE[best.verdict]) best = op
  }
  return verdictFrom(note, best)
}

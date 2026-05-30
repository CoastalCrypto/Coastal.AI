// packages/curator-agent/src/cycle/run-cycle.ts
//
// The Curator's main entrypoint. Reads all notes, grades each one,
// detects consolidation candidates, optionally executes the verdicts,
// writes a report.
//
// Cycle structure:
//   1. open NoteStore (read-only intent; we only mutate if not dryRun)
//   2. snapshot: list every note, count by kind
//   3. grade each note via gradeNote()
//   4. group remaining 'keep'-verdict notes by (kind, title) to find
//      consolidation candidates — for each duplicate group, downgrade
//      all but the newest to 'consolidate' with consolidateInto=<newest.id>
//   5. if !dryRun: execute prune + consolidate actions
//   6. write the CuratorReport, persist as a note with kind='curator_report'
//   7. close the store
//
// Mutation policy: the Curator NEVER mutates 'user' kind notes regardless
// of dryRun setting. neverPrune / neverConsolidate rules are
// load-bearing safety guarantees, not just defaults.

import { NoteStore } from '@coastal-ai/core/memory/notes'
import type { Note } from '@coastal-ai/core/memory/notes'
import { registerKind } from '@coastal-ai/core/memory/kinds-registry'
import type {
  CuratorConfig, CuratorReport, NoteVerdict, Verdict,
} from '../types.js'
import { REPORT_VERDICT_DETAIL_LIMIT } from '../types.js'
import { gradeNote, rulesFor } from '../grading/grader.js'
import { writeReportNote, formatReportMarkdown } from '../report/write-report.js'

const PAGE_SIZE = 500

/**
 * Run one Curator cycle against the configured data dir.
 * Returns a CuratorReport summarizing what was found and (if not
 * dryRun) what was done.
 */
export function runCuratorCycle(config: CuratorConfig): CuratorReport {
  // Side-effect: ensure the 'curator_report' kind is registered before
  // we try to persist the report. Idempotent.
  registerKind('curator_report')

  const dryRun = config.dryRun ?? true
  const now = config.now ?? (() => Date.now())
  const startedAt = now()
  const lowTrustThreshold = config.lowTrustRejectionThreshold ?? 5

  const store = new NoteStore({ dataDir: config.dataDir })

  // ── 1. snapshot ───────────────────────────────────────────────────

  const allNotes: Note[] = []
  let offset = 0
  while (true) {
    const page = store.list({ limit: PAGE_SIZE, offset })
    if (page.length === 0) break
    allNotes.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  // ── 2. grade each note ────────────────────────────────────────────

  const verdicts: NoteVerdict[] = []
  for (const note of allNotes) {
    const outgoing = store.outgoing(note.id)
    const backlinks = store.backlinks(note.id)
    const mentionStats = store.getMentionStats(note.id)
    const verdict = gradeNote(note, {
      now: now(),
      outgoing,
      backlinks,
      fileExists: config.fileExists,
      mentionRejectionCount: mentionStats.rejected,
      lowTrustRejectionThreshold: lowTrustThreshold,
    }, config.kindRules)
    verdicts.push(verdict)
  }

  // ── 3. detect consolidation candidates ─────────────────────────────
  //
  // For each (kind, normalized-title) group with more than one 'keep'
  // verdict, downgrade all but the most-recently-updated note to
  // 'consolidate' with consolidateInto = newest.id.

  const keepByKey = new Map<string, Note[]>()
  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i]
    if (v.verdict !== 'keep') continue
    const note = allNotes[i]
    const rules = rulesFor(note.kind, config.kindRules)
    if (rules.neverConsolidate) continue
    const key = `${note.kind}::${note.title.trim().toLowerCase()}`
    const bucket = keepByKey.get(key) ?? []
    bucket.push(note)
    keepByKey.set(key, bucket)
  }

  for (const [key, bucket] of keepByKey.entries()) {
    if (bucket.length < 2) continue
    // Newest by updatedAt wins; ties broken by id (lex order) for determinism
    const sorted = [...bucket].sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
      return a.id.localeCompare(b.id)
    })
    const canonical = sorted[0]
    for (const dupe of sorted.slice(1)) {
      const i = verdicts.findIndex(v => v.noteId === dupe.id)
      if (i < 0) continue
      verdicts[i] = {
        ...verdicts[i],
        verdict: 'consolidate',
        reason: `duplicate of ${canonical.id} (same kind + title); merging into newest`,
        consolidateInto: canonical.id,
      }
    }
  }

  // ── 4. execute (if not dryRun) ─────────────────────────────────────

  let executed: CuratorReport['executed'] | undefined
  if (!dryRun) {
    let pruned = 0
    let consolidated = 0
    for (const v of verdicts) {
      if (v.verdict === 'prune') {
        if (store.delete(v.noteId)) pruned++
      } else if (v.verdict === 'consolidate' && v.consolidateInto) {
        // Move backlinks: rewrite (from, dupeId, kind) edges to point at canonical.
        // For simplicity in v0.0.x, we don't re-merge the body — we trust the user
        // can recover content from the audit log if needed.
        // The deletion CASCADEs the dupe's link rows; we add new ones first.
        for (const link of store.backlinks(v.noteId)) {
          store.link(link.fromId, v.consolidateInto, link.kind)
        }
        if (store.delete(v.noteId)) consolidated++
      }
    }
    executed = { pruned, consolidated }
  }

  // ── 5. assemble + write report ─────────────────────────────────────

  const counts: Record<Verdict, number> = {
    keep: 0, prune: 0, consolidate: 0, escalate: 0,
  }
  for (const v of verdicts) counts[v.verdict]++

  const finishedAt = now()
  const report: CuratorReport = {
    startedAt,
    finishedAt,
    notesScanned: allNotes.length,
    dryRun,
    counts,
    verdicts: verdicts.slice(0, REPORT_VERDICT_DETAIL_LIMIT),
    executed,
  }

  // Persist report as a note (idempotent via id derived from startedAt)
  writeReportNote(store, report, formatReportMarkdown(report))

  store.close()
  return report
}

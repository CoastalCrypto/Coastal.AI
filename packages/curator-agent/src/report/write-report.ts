// packages/curator-agent/src/report/write-report.ts
//
// Two responsibilities:
//   - formatReportMarkdown(): pretty-print a CuratorReport to markdown
//     (also the body of the persisted report note)
//   - writeReportNote(): persist the report as a note with kind='curator_report'
//     and a deterministic id based on the start timestamp

import type { NoteStore } from '@coastal-ai/core/memory/notes'
import type { CuratorReport, NoteVerdict } from '../types.js'

export function reportNoteId(startedAt: number): string {
  // ISO timestamp without separators, sortable
  const iso = new Date(startedAt).toISOString().replace(/[-:T.Z]/g, '')
  return `curator-report-${iso.slice(0, 14)}`
}

export function reportNoteTitle(startedAt: number): string {
  return `Curator cycle ${new Date(startedAt).toISOString().slice(0, 19)}Z`
}

export function formatReportMarkdown(report: CuratorReport): string {
  const lines: string[] = []
  lines.push(`# ${reportNoteTitle(report.startedAt)}`)
  lines.push('')
  lines.push(`**Mode:** ${report.dryRun ? 'dry-run (no mutations)' : 'live (mutations executed)'}`)
  lines.push(`**Notes scanned:** ${report.notesScanned}`)
  lines.push(`**Duration:** ${report.finishedAt - report.startedAt} ms`)
  lines.push('')
  lines.push('## Verdict counts')
  lines.push('')
  lines.push('| Verdict | Count |')
  lines.push('|---|---:|')
  lines.push(`| keep | ${report.counts.keep} |`)
  lines.push(`| prune | ${report.counts.prune} |`)
  lines.push(`| consolidate | ${report.counts.consolidate} |`)
  lines.push(`| escalate | ${report.counts.escalate} |`)
  lines.push('')
  if (report.executed) {
    lines.push('## Executed')
    lines.push('')
    lines.push(`- Pruned: ${report.executed.pruned}`)
    lines.push(`- Consolidated: ${report.executed.consolidated}`)
    lines.push('')
  }

  // Per-verdict detail sections — useful when scanning a cycle report
  // to understand WHAT changed.
  appendSection(lines, 'Prune', report.verdicts.filter(v => v.verdict === 'prune'))
  appendSection(lines, 'Consolidate', report.verdicts.filter(v => v.verdict === 'consolidate'))
  appendSection(lines, 'Escalate', report.verdicts.filter(v => v.verdict === 'escalate'))

  return lines.join('\n')
}

function appendSection(lines: string[], heading: string, verdicts: NoteVerdict[]): void {
  if (verdicts.length === 0) return
  lines.push(`## ${heading} (${verdicts.length})`)
  lines.push('')
  for (const v of verdicts) {
    const target = v.consolidateInto ? ` → ${v.consolidateInto}` : ''
    lines.push(`- \`${v.noteId}\` (${v.noteKind}) — ${v.noteTitle}${target}`)
    lines.push(`  - ${v.reason}`)
  }
  lines.push('')
}

export function writeReportNote(
  store: NoteStore,
  report: CuratorReport,
  body: string,
): void {
  const id = reportNoteId(report.startedAt)
  store.upsert({
    id,
    kind: 'curator_report',
    title: reportNoteTitle(report.startedAt),
    body,
    sourceType: 'curator',
    sourceId: id,
  })
}

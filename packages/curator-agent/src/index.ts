// packages/curator-agent/src/index.ts
//
// Public entry point. Importing this module registers the
// 'curator_report' note kind with core's kinds-registry — same
// trading-architect pattern.

import { registerKind } from '@coastal-ai/core/memory/kinds-registry'

registerKind('curator_report')

export type {
  Verdict, NoteVerdict, KindRules,
  CuratorConfig, CuratorReport,
} from './types.js'

export {
  VERDICTS,
  DEFAULT_KIND_RULES,
  GLOBAL_DEFAULT_RULES,
  REPORT_VERDICT_DETAIL_LIMIT,
} from './types.js'

export { runCuratorCycle } from './cycle/run-cycle.js'

export {
  gradeNote, rulesFor,
} from './grading/grader.js'

export {
  ALL_HEURISTICS,
  AUTHORITATIVE_HEURISTICS,
  SOFT_HEURISTICS,
  isOrphan, isStale, isDeadCodeGraph, isLowTrust, isRecentlyTouched,
  type HeuristicContext, type HeuristicOpinion,
} from './grading/heuristics.js'

export {
  formatReportMarkdown,
  writeReportNote,
  reportNoteId,
  reportNoteTitle,
} from './report/write-report.js'

export {
  createCuratorDaemon,
  type CuratorDaemon,
  type CuratorDaemonConfig,
} from './daemon.js'

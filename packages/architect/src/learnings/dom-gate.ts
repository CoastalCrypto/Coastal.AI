// packages/architect/src/learnings/dom-gate.ts
//
// Compares a fresh batch of DOM snapshots against the most recent
// known-good baseline per URL. Returns a {ok, output} verdict matching
// the other building gates.
//
// Regression rules (any one trips the gate):
//   - status moved from 2xx/3xx → 4xx/5xx or fetch error
//   - bodyLength shrank by more than SHRINK_RATIO (default 30%) — likely
//     a route returning an empty/error page that still HTTP-200s
//   - new console errors appeared (count increased vs baseline)
//
// No baseline yet → ok=true with a "baseline initialized" message; the
// gate doesn't block on the first run.

import type { NoteStore } from '@coastal-ai/core/memory/notes'
import type { DomSnapshot } from '@coastal-ai/core/memory/dom-snapshots'
import { latestOkSnapshot } from '@coastal-ai/core/memory/dom-snapshots'

const DEFAULT_SHRINK_RATIO = 0.30

export interface DomGateConfig {
  /** Allowed shrink before the gate trips. 0 = strict (any shrink fails),
   *  1 = never trip on shrink. Default 0.30. */
  shrinkRatio?: number
}

export interface DomGateOutput {
  ok: boolean
  output: string
  /** Per-URL verdict for telemetry. */
  perUrl: Array<{
    url: string
    ok: boolean
    detail: string
    hadBaseline: boolean
  }>
}

export function runDomGate(
  store: NoteStore,
  fresh: readonly DomSnapshot[],
  config: DomGateConfig = {},
): DomGateOutput {
  const shrinkRatio = config.shrinkRatio ?? DEFAULT_SHRINK_RATIO
  const perUrl: DomGateOutput['perUrl'] = []
  let anyFail = false

  for (const snap of fresh) {
    const baseline = latestOkSnapshot(store, snap.url)
    if (!baseline) {
      perUrl.push({ url: snap.url, ok: true, detail: 'baseline initialized', hadBaseline: false })
      continue
    }
    const verdict = compareSnapshots(baseline, snap, shrinkRatio)
    perUrl.push({ url: snap.url, ok: verdict.ok, detail: verdict.detail, hadBaseline: true })
    if (!verdict.ok) anyFail = true
  }

  const summary = perUrl.length === 0
    ? 'dom gate: no URLs configured'
    : `dom gate: ${perUrl.filter(p => p.ok).length}/${perUrl.length} URLs passing`
  const detail = perUrl
    .map(p => `  - ${p.ok ? '✓' : '✗'} ${p.url} — ${p.detail}`)
    .join('\n')

  return { ok: !anyFail, output: detail.length > 0 ? `${summary}\n${detail}` : summary, perUrl }
}

interface PairVerdict { ok: boolean; detail: string }

function compareSnapshots(baseline: DomSnapshot, fresh: DomSnapshot, shrinkRatio: number): PairVerdict {
  if (!fresh.ok) {
    return { ok: false, detail: `fresh snapshot failed (status=${fresh.status}, error=${fresh.fetchError ?? 'none'})` }
  }
  if (baselineWas2xxAndFreshIsnt(baseline.status, fresh.status)) {
    return { ok: false, detail: `status regressed: baseline=${baseline.status}, fresh=${fresh.status}` }
  }
  const shrinkAllowed = baseline.bodyLength * (1 - shrinkRatio)
  if (baseline.bodyLength > 0 && fresh.bodyLength < shrinkAllowed) {
    const pct = Math.round((1 - fresh.bodyLength / baseline.bodyLength) * 100)
    return { ok: false, detail: `body shrank ${pct}% (baseline=${baseline.bodyLength}, fresh=${fresh.bodyLength})` }
  }
  if (fresh.consoleErrors.length > baseline.consoleErrors.length) {
    const delta = fresh.consoleErrors.length - baseline.consoleErrors.length
    return { ok: false, detail: `${delta} new console error${delta === 1 ? '' : 's'} appeared` }
  }
  return { ok: true, detail: `status=${fresh.status}, body=${fresh.bodyLength} chars, no new errors` }
}

function baselineWas2xxAndFreshIsnt(baselineStatus: number, freshStatus: number): boolean {
  const baselineOk = baselineStatus >= 200 && baselineStatus < 400
  const freshOk    = freshStatus    >= 200 && freshStatus    < 400
  return baselineOk && !freshOk
}

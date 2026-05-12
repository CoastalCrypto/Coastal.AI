// packages/trading-architect/src/notes.ts
//
// Persists TradeSignal objects as `kind='trade'` notes against any core
// NoteStore. Lives here (in the trading vertical) rather than in core so
// the kernel stays vertical-neutral — `kind='trade'` is registered with
// the core kinds-registry by this package's entry point on import.
//
// Pre-Tier-2 (commit f9179f0..1a6f337) this module lived in
// `@coastal-ai/core/memory/trade-notes`. It was moved here in commit
// (Tier-2 cleanup) so users who never install trading-architect get a
// kernel that doesn't know about markets at all.

import type { NoteStore, Note } from '@coastal-ai/core/memory/notes'

export type SignalActionLike = 'buy' | 'sell' | 'hold'

export interface TradeSignalLike {
  symbol: string
  action: SignalActionLike
  confidence: number
  reasoning: string
  generatorId: string
  emittedAt: number
  priceAtEmit: number
}

const ACTION_GLYPH: Record<SignalActionLike, string> = {
  buy:  '▲',
  sell: '▼',
  hold: '·',
}

export function tradeNoteId(signal: TradeSignalLike): string {
  return `trade:${signal.generatorId}:${signal.symbol}:${signal.emittedAt}`
}

export function tradeSourceId(generatorId: string, symbol: string): string {
  return `trade:${generatorId}:${symbol}`
}

export interface PersistedTradeRef {
  noteId: string
  generatorId: string
  symbol: string
  action: SignalActionLike
  emittedAt: number
}

export function writeTradeSignalAsNote(store: NoteStore, signal: TradeSignalLike): PersistedTradeRef {
  const id = tradeNoteId(signal)
  const sourceId = tradeSourceId(signal.generatorId, signal.symbol)
  const title = `${ACTION_GLYPH[signal.action]} ${signal.symbol} ${signal.action.toUpperCase()} ` +
    `(${(signal.confidence * 100).toFixed(0)}%) — ${signal.generatorId}`
  const body = renderTradeMarkdown(signal)
  store.upsert({
    id, title, body, kind: 'trade',
    sourceType: 'trade-signal',
    sourceId,
  })
  return {
    noteId: id, generatorId: signal.generatorId,
    symbol: signal.symbol, action: signal.action,
    emittedAt: signal.emittedAt,
  }
}

export function writeTradeSignalsAsNotes(
  store: NoteStore,
  signals: readonly TradeSignalLike[],
): PersistedTradeRef[] {
  return signals.map(s => writeTradeSignalAsNote(store, s))
}

/**
 * Newest-first signal history for one (generator, symbol). Useful for
 * the canvas (timeline view) and for back-testing helpers that compare
 * historical signals against subsequent price moves.
 */
export function recentTradeNotes(
  store: NoteStore,
  generatorId: string,
  symbol: string,
  limit = 50,
): Note[] {
  const all = store.bySource('trade-signal', tradeSourceId(generatorId, symbol))
  return all
    .sort((a, b) => decodeEmittedAt(b.id) - decodeEmittedAt(a.id))
    .slice(0, limit)
}

function renderTradeMarkdown(s: TradeSignalLike): string {
  return [
    `# ${s.symbol} · ${s.action.toUpperCase()}`,
    '',
    `- **Generator:** ${s.generatorId}`,
    `- **Confidence:** ${(s.confidence * 100).toFixed(1)}%`,
    `- **Price at emit:** ${s.priceAtEmit}`,
    `- **Emitted at:** ${new Date(s.emittedAt).toISOString()}`,
    '',
    '```signal-meta',
    JSON.stringify(s),
    '```',
    '',
    '## Reasoning',
    s.reasoning,
  ].join('\n')
}

function decodeEmittedAt(noteId: string): number {
  const tail = noteId.split(':').pop() ?? ''
  const n = Number(tail)
  return Number.isFinite(n) ? n : 0
}

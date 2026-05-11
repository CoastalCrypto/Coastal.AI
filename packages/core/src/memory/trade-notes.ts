// packages/core/src/memory/trade-notes.ts
//
// Persists TradeSignal objects as `kind='trade'` notes. Same hygiene as
// dom-snapshots / eval-notes: deterministic note id sortable by emit
// time, sourceType+sourceId scoping per (generator, symbol).
//
// The trade-architect package owns the TradeSignal type — but to keep
// core free of trade-architect imports, we accept a structurally typed
// signal here. Any `{ symbol, action, confidence, reasoning, generatorId,
// emittedAt, priceAtEmit }` shape works.

import type { NoteStore, Note } from './notes.js'

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

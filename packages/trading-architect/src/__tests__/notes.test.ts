import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { registerKind } from '@coastal-ai/core/memory/kinds-registry'
import {
  writeTradeSignalAsNote, writeTradeSignalsAsNotes,
  recentTradeNotes,
  tradeNoteId, tradeSourceId,
  type TradeSignalLike,
} from '../notes.js'

// Register 'trade' explicitly. In real use, importing the package
// entry point does this as a side effect; tests bypass the entry point.
// Idempotent — safe to call from every test file in this package.
registerKind('trade')

let dir: string
let store: NoteStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trade-notes-'))
  store = new NoteStore({ dataDir: dir })
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

function signal(opts: Partial<TradeSignalLike> & { emittedAt: number }): TradeSignalLike {
  return {
    symbol: opts.symbol ?? 'BTC-USD',
    action: opts.action ?? 'buy',
    confidence: opts.confidence ?? 0.75,
    reasoning: opts.reasoning ?? 'mock reasoning',
    generatorId: opts.generatorId ?? 'rsi-14',
    emittedAt: opts.emittedAt,
    priceAtEmit: opts.priceAtEmit ?? 100,
  }
}

describe('writeTradeSignalAsNote', () => {
  it('persists with kind=trade and the canonical id format', () => {
    const ref = writeTradeSignalAsNote(store, signal({ emittedAt: 1 }))
    expect(ref.noteId).toBe(tradeNoteId(signal({ emittedAt: 1 })))
    const note = store.get(ref.noteId)!
    expect(note.kind).toBe('trade')
    expect(note.sourceType).toBe('trade-signal')
    expect(note.sourceId).toBe(tradeSourceId('rsi-14', 'BTC-USD'))
  })

  it('marks buy/sell/hold actions with distinct glyphs in the title', () => {
    const buy  = store.get(writeTradeSignalAsNote(store, signal({ emittedAt: 1, action: 'buy' })).noteId)!
    const sell = store.get(writeTradeSignalAsNote(store, signal({ emittedAt: 2, action: 'sell' })).noteId)!
    const hold = store.get(writeTradeSignalAsNote(store, signal({ emittedAt: 3, action: 'hold' })).noteId)!
    expect(buy.title.startsWith('▲')).toBe(true)
    expect(sell.title.startsWith('▼')).toBe(true)
    expect(hold.title.startsWith('·')).toBe(true)
  })

  it('embeds machine-readable signal-meta block in the body', () => {
    const note = store.get(writeTradeSignalAsNote(store, signal({ emittedAt: 1 })).noteId)!
    expect(note.body).toContain('```signal-meta')
    expect(note.body).toContain('"action":"buy"')
  })

  it("includes the generator's reasoning verbatim", () => {
    const note = store.get(writeTradeSignalAsNote(store, signal({
      emittedAt: 1, reasoning: 'RSI(14) = 22.4 — strongly oversold',
    })).noteId)!
    expect(note.body).toContain('RSI(14) = 22.4 — strongly oversold')
  })
})

describe('writeTradeSignalsAsNotes', () => {
  it('persists each signal and returns refs in order', () => {
    const refs = writeTradeSignalsAsNotes(store, [
      signal({ emittedAt: 1 }),
      signal({ emittedAt: 2 }),
    ])
    expect(refs).toHaveLength(2)
    expect(store.list({ kind: 'trade' })).toHaveLength(2)
  })
})

describe('recentTradeNotes', () => {
  it('returns history newest-first scoped to (generator, symbol)', () => {
    writeTradeSignalsAsNotes(store, [
      signal({ emittedAt: 100 }),
      signal({ emittedAt: 300 }),
      signal({ emittedAt: 200 }),
    ])
    const recent = recentTradeNotes(store, 'rsi-14', 'BTC-USD')
    expect(recent.map(n => Number(n.id.split(':').pop()))).toEqual([300, 200, 100])
  })

  it('filters out other generators and other symbols', () => {
    writeTradeSignalsAsNotes(store, [
      signal({ emittedAt: 1, generatorId: 'rsi-14', symbol: 'BTC' }),
      signal({ emittedAt: 2, generatorId: 'rsi-7',  symbol: 'BTC' }),
      signal({ emittedAt: 3, generatorId: 'rsi-14', symbol: 'ETH' }),
    ])
    const r = recentTradeNotes(store, 'rsi-14', 'BTC')
    expect(r).toHaveLength(1)
    expect(r[0].id).toContain(':BTC:1')
  })

  it('respects the limit parameter', () => {
    for (let i = 1; i <= 5; i++) writeTradeSignalAsNote(store, signal({ emittedAt: i }))
    expect(recentTradeNotes(store, 'rsi-14', 'BTC-USD', 2)).toHaveLength(2)
  })
})

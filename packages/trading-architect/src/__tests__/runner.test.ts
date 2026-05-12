// End-to-end test for runTradeTick: file provider + RSI generator →
// trade signals persisted as kind='trade' notes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { registerKind } from '@coastal-ai/core/memory/kinds-registry'
import { recentTradeNotes, tradeSourceId } from '../notes.js'
import { createFileMarketProvider } from '../providers/file-provider.js'
import { createRsiThresholdGenerator } from '../generators/rsi-threshold.js'
import { runTradeTick } from '../runner.js'

// Tests bypass the package entry point (which would auto-register
// 'trade'), so register explicitly. Idempotent.
registerKind('trade')

let fixturesDir: string
let dbDir: string
let store: NoteStore

beforeEach(() => {
  fixturesDir = mkdtempSync(join(tmpdir(), 'tt-fix-'))
  dbDir = mkdtempSync(join(tmpdir(), 'tt-db-'))
  store = new NoteStore({ dataDir: dbDir })
})

afterEach(() => {
  store.close()
  rmSync(fixturesDir, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

function writeFixture(symbol: string, closes: number[]) {
  const candles = closes.map((c, i) => ({ timestamp: i, open: c, high: c, low: c, close: c, volume: 1 }))
  writeFileSync(join(fixturesDir, `${symbol}.json`), JSON.stringify({ symbol, candles }))
}

describe('runTradeTick end-to-end', () => {
  it('produces a buy signal for an oversold symbol and persists it as a kind=trade note', async () => {
    // Steep downturn → RSI ≈ 0 → buy
    writeFixture('OVER-SOLD', Array.from({ length: 20 }, (_, i) => 100 - i * 5))
    const result = await runTradeTick({
      symbols: ['OVER-SOLD'],
      providers: [createFileMarketProvider({ fixturesDir })],
      generators: [createRsiThresholdGenerator()],
      store,
    })
    expect(result.signalsEmitted['OVER-SOLD']).toBe(1)
    expect(result.refs[0].action).toBe('buy')
    const notes = store.list({ kind: 'trade' })
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toContain('OVER-SOLD BUY')
  })

  it('runs every generator against every symbol (cartesian product)', async () => {
    writeFixture('A', Array.from({ length: 20 }, (_, i) => 100 - i * 5)) // oversold
    writeFixture('B', Array.from({ length: 20 }, (_, i) => 10 + i * 5))  // overbought
    const result = await runTradeTick({
      symbols: ['A', 'B'],
      providers: [createFileMarketProvider({ fixturesDir })],
      generators: [
        createRsiThresholdGenerator({ id: 'rsi-default' }),
        createRsiThresholdGenerator({ id: 'rsi-strict', oversold: 20, overbought: 80 }),
      ],
      store,
    })
    // Both generators emit for both symbols → 4 signals
    expect(result.refs).toHaveLength(4)
  })

  it('records errors when a provider fetch fails but continues other symbols', async () => {
    writeFixture('OK', Array.from({ length: 20 }, (_, i) => 100 - i * 5))
    // 'MISSING' has no fixture file
    const result = await runTradeTick({
      symbols: ['OK', 'MISSING'],
      providers: [createFileMarketProvider({ fixturesDir })],
      generators: [createRsiThresholdGenerator()],
      store,
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].symbol).toBe('MISSING')
    expect(result.signalsEmitted['OK']).toBe(1)
    expect(result.signalsEmitted['MISSING']).toBe(0)
  })

  it('subsequent ticks accumulate signal history per (generator, symbol)', async () => {
    writeFixture('X', Array.from({ length: 20 }, (_, i) => 100 - i * 5))
    const provider = createFileMarketProvider({ fixturesDir, now: () => 100 })
    const generator = createRsiThresholdGenerator()
    await runTradeTick({ symbols: ['X'], providers: [provider], generators: [generator], store })
    // Second tick at a different timestamp so the note id differs.
    const provider2 = createFileMarketProvider({ fixturesDir, now: () => 200 })
    await runTradeTick({ symbols: ['X'], providers: [provider2], generators: [generator], store })
    const history = recentTradeNotes(store, generator.id, 'X')
    expect(history).toHaveLength(2)
    expect(store.bySource('trade-signal', tradeSourceId(generator.id, 'X'))).toHaveLength(2)
  })
})

// packages/trading-architect/src/runner.ts
//
// Orchestrates a single "tick" of the trading-architect cycle:
//
//   1. Pull a market snapshot for each watched symbol from a MarketProvider.
//   2. Run every registered SignalGenerator against each snapshot.
//   3. Persist non-null signals as kind='trade' notes.
//
// The runner is deliberately simple — no scheduling loop here. The
// caller (a daemon, a cron, a one-shot CLI) decides when to call it.
// That keeps the module unit-testable and lets the trading vertical
// borrow whatever cadence model the parent architect already uses.

import type { NoteStore } from '@coastal-ai/core/memory/notes'
import { writeTradeSignalAsNote, type PersistedTradeRef } from '@coastal-ai/core/memory/trade-notes'
import type { MarketProvider, SignalGenerator } from './types.js'

export interface TradeTickInput {
  symbols: readonly string[]
  providers: readonly MarketProvider[]
  generators: readonly SignalGenerator[]
  store: NoteStore
}

export interface TradeTickResult {
  /** Symbols that were attempted this tick. */
  symbols: string[]
  /** Per-symbol counts. */
  signalsEmitted: Record<string, number>
  /** Refs to the persisted notes for inspection / linking. */
  refs: PersistedTradeRef[]
  /** Any per-provider/symbol errors encountered. */
  errors: { symbol: string; providerId: string; message: string }[]
}

export async function runTradeTick(input: TradeTickInput): Promise<TradeTickResult> {
  const result: TradeTickResult = {
    symbols: [...input.symbols],
    signalsEmitted: Object.fromEntries(input.symbols.map(s => [s, 0])),
    refs: [],
    errors: [],
  }

  for (const symbol of input.symbols) {
    for (const provider of input.providers) {
      let snapshot
      try {
        snapshot = await provider.fetchSnapshot(symbol)
      } catch (err) {
        result.errors.push({
          symbol, providerId: provider.id,
          message: err instanceof Error ? err.message : String(err),
        })
        continue
      }
      for (const generator of input.generators) {
        let signal
        try {
          signal = await generator.generate(snapshot)
        } catch (err) {
          result.errors.push({
            symbol, providerId: provider.id,
            message: `generator ${generator.id} threw: ${err instanceof Error ? err.message : String(err)}`,
          })
          continue
        }
        if (!signal) continue
        const ref = writeTradeSignalAsNote(input.store, signal)
        result.refs.push(ref)
        result.signalsEmitted[symbol] = (result.signalsEmitted[symbol] ?? 0) + 1
      }
    }
  }

  return result
}

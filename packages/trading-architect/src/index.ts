// packages/trading-architect/src/index.ts
//
// Public entry point. Re-exports the surface that consumers (daemon
// processes, REST routes, future CLI) need. Internals live under their
// own subdirectories and aren't promised stable here.
//
// IMPORTANT — side effect on import: this module registers the 'trade'
// note kind with the core kinds-registry. Coastal.AI's kernel ships
// without 'trade' so installs that don't include trading get a strictly
// non-financial note set. Importing anything from this package
// (including just `import '@coastal-ai/trading-architect'`) opts in.

import { registerKind } from '@coastal-ai/core/memory/kinds-registry'
registerKind('trade')

export type {
  MarketCandle, MarketSnapshot,
  TradeSignal, SignalAction,
  MarketProvider, SignalGenerator,
} from './types.js'

export { createFileMarketProvider, type FileProviderConfig } from './providers/file-provider.js'
export { createRsiThresholdGenerator, computeRsi, type RsiThresholdConfig } from './generators/rsi-threshold.js'
export {
  createKronosAdapter,
  type KronosAdapterConfig, type KronosPrediction,
} from './generators/kronos-adapter.js'
export { runTradeTick, type TradeTickInput, type TradeTickResult } from './runner.js'

// Trade-notes persistence — moved from @coastal-ai/core/memory/trade-notes
// in the Tier-2 cleanup so the kernel stays vertical-neutral.
export {
  writeTradeSignalAsNote, writeTradeSignalsAsNotes,
  recentTradeNotes, tradeNoteId, tradeSourceId,
  type TradeSignalLike, type SignalActionLike, type PersistedTradeRef,
} from './notes.js'

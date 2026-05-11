// packages/trading-architect/src/index.ts
//
// Public entry point. Re-exports the surface that consumers (daemon
// processes, REST routes, future CLI) need. Internals live under their
// own subdirectories and aren't promised stable here.

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

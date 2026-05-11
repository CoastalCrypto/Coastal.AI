// packages/trading-architect/src/types.ts
//
// Core abstractions for the trading-architect package. The pattern
// mirrors packages/architect: types live in core/architect/types and the
// runtime stages consume them. Here we keep types local to the package
// because none of them need to leak across the workspace boundary yet.

export interface MarketCandle {
  /** ISO timestamp at the candle's open. */
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  /** Volume in base units. */
  volume: number
}

export interface MarketSnapshot {
  /** Stable instrument identifier (e.g. 'BTC-USD'). */
  symbol: string
  /** Most recent close price. */
  price: number
  /** OHLCV history, oldest → newest. The signal generator decides how
   *  many candles it actually needs. */
  candles: readonly MarketCandle[]
  /** Wall-clock millisecond timestamp when this snapshot was assembled. */
  takenAt: number
  /** Where the data came from — used as the eval/notes sourceType. */
  providerId: string
}

export type SignalAction = 'buy' | 'sell' | 'hold'

export interface TradeSignal {
  symbol: string
  action: SignalAction
  /** 0–1 confidence the signal generator places on the action. */
  confidence: number
  /** Generator-specific reasoning, surfaced verbatim in the trade note. */
  reasoning: string
  /** Identifier for the generator that produced this signal. Used as
   *  sourceId for trade notes so history per-generator stays scoped. */
  generatorId: string
  /** ISO timestamp the signal was emitted. */
  emittedAt: number
  /** The price the generator saw at emit time, for retroactive
   *  back-testing once the next candles arrive. */
  priceAtEmit: number
}

export interface MarketProvider {
  id: string
  /** Pull the latest snapshot for `symbol`. Implementations decide
   *  how much candle history to include. */
  fetchSnapshot(symbol: string): Promise<MarketSnapshot>
}

export interface SignalGenerator {
  id: string
  description: string
  /** Given a market snapshot, emit zero-or-one signal. Generators may
   *  return null when no actionable verdict exists (insufficient data,
   *  conflicting indicators, sidecar offline). The return type is widened
   *  to `T | Promise<T>` so generators can run synchronously (RSI) or
   *  call out over the network (Kronos, TradingAgents) through the same
   *  interface. The runner always awaits. */
  generate(snapshot: MarketSnapshot): TradeSignal | null | Promise<TradeSignal | null>
}

// packages/trading-architect/src/generators/rsi-threshold.ts
//
// Classic RSI mean-reversion signal. Bought when oversold (RSI < lo),
// sold when overbought (RSI > hi). Nothing fancy — this generator's job
// is to be DETERMINISTIC so the trade-architect's substrate (notes,
// gate, back-test) can be exercised with confidence before we plug in
// model-driven generators (Kronos, TradingAgents) in the next slice.
//
// References:
//   J. Welles Wilder, "New Concepts in Technical Trading Systems" (1978)
//   The classic RSI calculation; we use the Wilder smoothing variant.

import type { MarketSnapshot, SignalGenerator, TradeSignal } from '../types.js'

export interface RsiThresholdConfig {
  /** Look-back window for the RSI calculation. Wilder's default = 14. */
  period?: number
  /** RSI value below which we emit a 'buy' signal. */
  oversold?: number
  /** RSI value above which we emit a 'sell' signal. */
  overbought?: number
  /** Override generator id (defaults to a config-derived label). */
  id?: string
}

export function createRsiThresholdGenerator(config: RsiThresholdConfig = {}): SignalGenerator {
  const period = config.period ?? 14
  const oversold = config.oversold ?? 30
  const overbought = config.overbought ?? 70
  const id = config.id ?? `rsi-${period}-${oversold}-${overbought}`

  return {
    id,
    description: `RSI(${period}) mean-reversion: buy<${oversold}, sell>${overbought}`,
    generate(snapshot: MarketSnapshot): TradeSignal | null {
      // Need period+1 candles to compute one RSI value.
      if (snapshot.candles.length < period + 1) return null
      const rsi = computeRsi(snapshot.candles.map(c => c.close), period)
      if (rsi === null) return null

      const reasoning = `RSI(${period}) = ${rsi.toFixed(2)} on ${snapshot.candles.length} candles ` +
        `(thresholds: buy<${oversold}, sell>${overbought}, current price ${snapshot.price})`

      const baseSignal = {
        symbol: snapshot.symbol,
        generatorId: id,
        emittedAt: snapshot.takenAt,
        priceAtEmit: snapshot.price,
        reasoning,
      }

      if (rsi < oversold) {
        // Confidence rises as RSI sinks further below the threshold.
        const confidence = clamp((oversold - rsi) / oversold, 0, 1)
        return { ...baseSignal, action: 'buy', confidence }
      }
      if (rsi > overbought) {
        // Same shape on the sell side.
        const confidence = clamp((rsi - overbought) / (100 - overbought), 0, 1)
        return { ...baseSignal, action: 'sell', confidence }
      }
      // Mid-range: emit a low-confidence hold so the cycle still records
      // an audit trail of "we looked, here's why we did nothing."
      return {
        ...baseSignal,
        action: 'hold',
        confidence: 0,
      }
    },
  }
}

/**
 * Wilder-smoothed RSI. Returns null if there isn't enough history.
 * Exported for the test suite to verify the math against worked examples.
 */
export function computeRsi(closes: readonly number[], period: number): number | null {
  if (closes.length < period + 1) return null

  // Initial average gain/loss = simple average over the first `period` deltas.
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1]
    if (delta >= 0) gainSum += delta
    else lossSum -= delta
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period

  // Wilder smoothing for every subsequent candle.
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1]
    const gain = delta > 0 ? delta : 0
    const loss = delta < 0 ? -delta : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }

  if (avgLoss === 0) return 100 // pure upward momentum
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

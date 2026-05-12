import { describe, it, expect } from 'vitest'
import { createRsiThresholdGenerator, computeRsi } from '../rsi-threshold.js'
import type { MarketCandle, MarketSnapshot } from '../../types.js'

function snapshot(closes: readonly number[]): MarketSnapshot {
  const candles: MarketCandle[] = closes.map((c, i) => ({
    timestamp: i, open: c, high: c, low: c, close: c, volume: 1,
  }))
  return {
    symbol: 'TEST',
    price: closes[closes.length - 1],
    candles, takenAt: 1_000, providerId: 'mock',
  }
}

describe('computeRsi', () => {
  it('returns null when there are fewer than period+1 candles', () => {
    expect(computeRsi([1, 2, 3], 14)).toBeNull()
  })

  it('returns 100 for a strictly monotonic upward series (no losses)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 10 + i)
    expect(computeRsi(closes, 14)).toBe(100)
  })

  it('returns ~0 for a strictly monotonic downward series (no gains)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 30 - i)
    const rsi = computeRsi(closes, 14)
    expect(rsi).toBeCloseTo(0, 1)
  })

  it('returns ~50 for an alternating up/down series of equal magnitude', () => {
    // 14-period Wilder smoothing on a perfect alternation gives RSI ≈ 50.
    const closes: number[] = []
    let value = 100
    for (let i = 0; i < 30; i++) {
      value += (i % 2 === 0) ? 1 : -1
      closes.push(value)
    }
    const rsi = computeRsi(closes, 14)!
    expect(rsi).toBeGreaterThan(40)
    expect(rsi).toBeLessThan(60)
  })
})

describe('createRsiThresholdGenerator', () => {
  it('emits a buy signal when RSI is below the oversold threshold', () => {
    const gen = createRsiThresholdGenerator({ period: 14, oversold: 30, overbought: 70 })
    // Strongly downward series → RSI near 0 → buy
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i * 2)
    const signal = gen.generate(snapshot(closes))
    expect(signal).not.toBeNull()
    expect(signal!.action).toBe('buy')
    expect(signal!.confidence).toBeGreaterThan(0.5)
    expect(signal!.reasoning).toContain('RSI(14)')
  })

  it('emits a sell signal when RSI is above the overbought threshold', () => {
    const gen = createRsiThresholdGenerator({ period: 14, oversold: 30, overbought: 70 })
    const closes = Array.from({ length: 20 }, (_, i) => 10 + i * 2)
    const signal = gen.generate(snapshot(closes))!
    expect(signal.action).toBe('sell')
    expect(signal.confidence).toBeGreaterThan(0)
  })

  it('emits a hold signal when RSI is between the thresholds', () => {
    const gen = createRsiThresholdGenerator({ period: 14, oversold: 30, overbought: 70 })
    // Alternating series → RSI ≈ 50 → hold
    const closes: number[] = []
    let v = 100
    for (let i = 0; i < 30; i++) { v += (i % 2 === 0 ? 1 : -1); closes.push(v) }
    const signal = gen.generate(snapshot(closes))!
    expect(signal.action).toBe('hold')
    expect(signal.confidence).toBe(0)
  })

  it('returns null when the snapshot has fewer than period+1 candles', () => {
    const gen = createRsiThresholdGenerator({ period: 14 })
    const closes = Array.from({ length: 5 }, (_, i) => 10 + i)
    expect(gen.generate(snapshot(closes))).toBeNull()
  })

  it('records the price at emit and the snapshot timestamp', () => {
    const gen = createRsiThresholdGenerator({ period: 14, oversold: 30, overbought: 70 })
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i * 2)
    const snap = snapshot(closes)
    const signal = gen.generate(snap)!
    expect(signal.priceAtEmit).toBe(snap.price)
    expect(signal.emittedAt).toBe(snap.takenAt)
  })

  it('uses a config-derived id by default and respects overrides', () => {
    expect(createRsiThresholdGenerator({ period: 7, oversold: 25, overbought: 75 }).id)
      .toBe('rsi-7-25-75')
    expect(createRsiThresholdGenerator({ id: 'custom' }).id).toBe('custom')
  })

  it('confidence on the buy side maxes at 1 for deep oversold', () => {
    const gen = createRsiThresholdGenerator({ period: 14, oversold: 30, overbought: 70 })
    const steep = gen.generate(snapshot(Array.from({ length: 20 }, (_, i) => 100 - i * 5)))!
    expect(steep.action).toBe('buy')
    expect(steep.confidence).toBeGreaterThanOrEqual(0)
    expect(steep.confidence).toBeLessThanOrEqual(1)
    expect(steep.confidence).toBeGreaterThan(0.9)
  })

  it('confidence on the sell side is bounded in [0, 1]', () => {
    const gen = createRsiThresholdGenerator({ period: 14, oversold: 30, overbought: 70 })
    const steep = gen.generate(snapshot(Array.from({ length: 20 }, (_, i) => 10 + i * 5)))!
    expect(steep.action).toBe('sell')
    expect(steep.confidence).toBeGreaterThanOrEqual(0)
    expect(steep.confidence).toBeLessThanOrEqual(1)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { createKronosAdapter, type KronosPrediction } from '../kronos-adapter.js'
import type { MarketCandle, MarketSnapshot } from '../../types.js'

function snapshot(closes: number[] = [100, 101, 102]): MarketSnapshot {
  const candles: MarketCandle[] = closes.map((c, i) => ({
    timestamp: i, open: c, high: c, low: c, close: c, volume: 1,
  }))
  return {
    symbol: 'BTC-USD',
    price: closes[closes.length - 1],
    candles, takenAt: 1_000, providerId: 'mock',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }) as unknown as Response
}

describe('createKronosAdapter id + description', () => {
  it('derives an id from the sidecar host when not overridden', () => {
    const gen = createKronosAdapter({
      baseUrl: 'http://kronos.local:8788',
      fetchFn: vi.fn(),
    })
    expect(gen.id).toBe('kronos:kronos.local:8788')
  })

  it('respects an explicit id override', () => {
    const gen = createKronosAdapter({
      baseUrl: 'http://localhost:8788', id: 'kronos-prod', fetchFn: vi.fn(),
    })
    expect(gen.id).toBe('kronos-prod')
  })
})

describe('createKronosAdapter signal mapping', () => {
  it('maps direction=up + high confidence to a BUY signal', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      direction: 'up', confidence: 0.82, magnitude: 0.04,
      model: 'kronos-1b', reasoning: 'momentum building',
    } satisfies KronosPrediction))
    const gen = createKronosAdapter({ baseUrl: 'http://x', fetchFn, now: () => 9999 })
    const signal = await gen.generate(snapshot())
    expect(signal).not.toBeNull()
    expect(signal!.action).toBe('buy')
    expect(signal!.confidence).toBeCloseTo(0.82)
    expect(signal!.emittedAt).toBe(9999)
    expect(signal!.priceAtEmit).toBe(102)
    expect(signal!.reasoning).toContain('direction=up')
    expect(signal!.reasoning).toContain('action=buy')
  })

  it('maps direction=down + high confidence to a SELL signal', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      direction: 'down', confidence: 0.75,
    }))
    const gen = createKronosAdapter({ baseUrl: 'http://x', fetchFn })
    const signal = await gen.generate(snapshot())
    expect(signal!.action).toBe('sell')
  })

  it('maps low-confidence predictions to HOLD even when direction is non-flat', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      direction: 'up', confidence: 0.40, // below default buy threshold (0.55)
    }))
    const gen = createKronosAdapter({ baseUrl: 'http://x', fetchFn })
    const signal = await gen.generate(snapshot())
    expect(signal!.action).toBe('hold')
  })

  it('respects a custom buyThreshold', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      direction: 'up', confidence: 0.50,
    }))
    const gen = createKronosAdapter({ baseUrl: 'http://x', fetchFn, buyThreshold: 0.45 })
    const signal = await gen.generate(snapshot())
    expect(signal!.action).toBe('buy')
  })

  it('always returns HOLD for direction=flat', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      direction: 'flat', confidence: 0.99,
    }))
    const gen = createKronosAdapter({ baseUrl: 'http://x', fetchFn })
    const signal = await gen.generate(snapshot())
    expect(signal!.action).toBe('hold')
  })

  it('clamps confidence into [0, 1]', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      direction: 'up', confidence: 1.5, // sidecar misbehaves
    }))
    const gen = createKronosAdapter({ baseUrl: 'http://x', fetchFn, buyThreshold: 0.5 })
    const signal = await gen.generate(snapshot())
    expect(signal!.confidence).toBe(1)
  })
})

describe('createKronosAdapter graceful degradation', () => {
  it('returns null when the sidecar is unreachable (fetch throws)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const gen = createKronosAdapter({ baseUrl: 'http://x', fetchFn })
    expect(await gen.generate(snapshot())).toBeNull()
  })

  it('returns null on non-2xx responses', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'no model' }, 503))
    const gen = createKronosAdapter({ baseUrl: 'http://x', fetchFn })
    expect(await gen.generate(snapshot())).toBeNull()
  })

  it('returns null when the response payload is malformed', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      // Missing direction + confidence — invalid prediction shape
      foo: 'bar',
    }))
    const gen = createKronosAdapter({ baseUrl: 'http://x', fetchFn })
    expect(await gen.generate(snapshot())).toBeNull()
  })

  it('returns null when direction is unrecognized', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      direction: 'sideways', confidence: 0.9,
    }))
    const gen = createKronosAdapter({ baseUrl: 'http://x', fetchFn })
    expect(await gen.generate(snapshot())).toBeNull()
  })
})

describe('createKronosAdapter request shape', () => {
  it('POSTs to <baseUrl>/predict with symbol + candles in the body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      direction: 'flat', confidence: 0.5,
    }))
    const gen = createKronosAdapter({ baseUrl: 'http://kronos:8788', fetchFn })
    await gen.generate(snapshot([100, 101]))
    expect(fetchFn).toHaveBeenCalledWith('http://kronos:8788/predict', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
    }))
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.symbol).toBe('BTC-USD')
    expect(body.candles).toHaveLength(2)
    expect(body.candles[1].close).toBe(101)
  })

  it('strips trailing slashes from baseUrl', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ direction: 'flat', confidence: 0.5 }))
    await createKronosAdapter({ baseUrl: 'http://kronos:8788///', fetchFn }).generate(snapshot())
    expect(fetchFn).toHaveBeenCalledWith('http://kronos:8788/predict', expect.anything())
  })
})

// packages/trading-architect/src/generators/kronos-adapter.ts
//
// HTTP adapter for the shiyu-coder/Kronos foundation model.
// Kronos is a Python research project (foundation model for financial
// time series). To keep this TypeScript daemon free of Python deps,
// the adapter calls a Kronos sidecar over HTTP — typically run by the
// operator alongside the architect (separate process, separate venv).
//
// Sidecar contract (caller's responsibility to provide):
//   POST <baseUrl>/predict
//   Body: { symbol: string, candles: MarketCandle[] }
//   Response: KronosPrediction (see below)
//
// When the sidecar is unreachable, the generator returns null rather
// than throwing — it acts like "I have no signal right now," letting
// the runner record the unavailability without poisoning the gate.
// The deterministic RSI generator continues to produce signals, so
// the trading-architect cycle stays useful even when Kronos is down.

import type { MarketCandle, MarketSnapshot, SignalGenerator, TradeSignal, SignalAction } from '../types.js'

export interface KronosPrediction {
  /** Predicted direction over the model's forecast horizon. */
  direction: 'up' | 'down' | 'flat'
  /** Magnitude estimate (0–1, model-defined). */
  magnitude?: number
  /** 0–1 confidence. */
  confidence: number
  /** Short reasoning string for audit. */
  reasoning?: string
  /** Optional model identifier returned by the sidecar. */
  model?: string
}

export interface KronosAdapterConfig {
  /** Base URL of the Kronos HTTP sidecar (no trailing slash). */
  baseUrl: string
  /** Per-call timeout in ms. Defaults to 8s. */
  timeoutMs?: number
  /** Override generator id (defaults to 'kronos:<host>'). */
  id?: string
  /** Inject a fetch implementation for tests. */
  fetchFn?: typeof fetch
  /** Inject a clock for test determinism. */
  now?: () => number
  /** Override the buy threshold for `up` direction confidence. Default 0.55. */
  buyThreshold?: number
  /** Override the sell threshold for `down` direction confidence. Default 0.55. */
  sellThreshold?: number
}

const DEFAULT_TIMEOUT_MS = 8_000

export function createKronosAdapter(config: KronosAdapterConfig): SignalGenerator {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchFn = config.fetchFn ?? globalThis.fetch
  const now = config.now ?? Date.now
  const buyThreshold = config.buyThreshold ?? 0.55
  const sellThreshold = config.sellThreshold ?? 0.55
  const id = config.id ?? `kronos:${urlHost(baseUrl)}`

  return {
    id,
    description: `Kronos foundation-model adapter (${baseUrl}, buy>${buyThreshold}, sell>${sellThreshold})`,
    async generate(snapshot: MarketSnapshot): Promise<TradeSignal | null> {
      const prediction = await callKronos(baseUrl, snapshot, fetchFn, timeoutMs)
      if (!prediction) return null

      const action = chooseAction(prediction, buyThreshold, sellThreshold)
      const reasoning = renderReasoning(prediction, action, baseUrl)

      return {
        symbol: snapshot.symbol,
        action,
        confidence: clamp(prediction.confidence, 0, 1),
        reasoning,
        generatorId: id,
        emittedAt: now(),
        priceAtEmit: snapshot.price,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function callKronos(
  baseUrl: string,
  snapshot: MarketSnapshot,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<KronosPrediction | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchFn(`${baseUrl}/predict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        symbol: snapshot.symbol,
        candles: snapshot.candles as MarketCandle[],
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const json = await res.json() as KronosPrediction
    if (!isValidPrediction(json)) return null
    return json
  } catch {
    // Sidecar unreachable / timed out / malformed JSON. Caller treats
    // null as "no signal," which is the correct semantics.
    return null
  } finally {
    clearTimeout(timer)
  }
}

function isValidPrediction(p: unknown): p is KronosPrediction {
  if (!p || typeof p !== 'object') return false
  const obj = p as Record<string, unknown>
  if (obj.direction !== 'up' && obj.direction !== 'down' && obj.direction !== 'flat') return false
  if (typeof obj.confidence !== 'number') return false
  return true
}

function chooseAction(
  pred: KronosPrediction,
  buyThreshold: number,
  sellThreshold: number,
): SignalAction {
  if (pred.direction === 'up'   && pred.confidence >= buyThreshold)  return 'buy'
  if (pred.direction === 'down' && pred.confidence >= sellThreshold) return 'sell'
  return 'hold'
}

function renderReasoning(
  pred: KronosPrediction,
  action: SignalAction,
  baseUrl: string,
): string {
  const parts = [
    `Kronos ${pred.model ?? 'sidecar'} @ ${baseUrl}`,
    `direction=${pred.direction}, confidence=${pred.confidence.toFixed(2)}`,
  ]
  if (pred.magnitude !== undefined) parts.push(`magnitude=${pred.magnitude.toFixed(3)}`)
  if (pred.reasoning) parts.push(`note: ${pred.reasoning}`)
  parts.push(`→ action=${action}`)
  return parts.join('; ')
}

function urlHost(url: string): string {
  try { return new URL(url).host } catch { return url }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

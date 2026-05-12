// packages/trading-architect/src/providers/file-provider.ts
//
// MarketProvider backed by JSON fixture files on disk. Useful for:
//   - tests (deterministic — no network, no flaky exchanges)
//   - back-testing (replay a known time series)
//   - air-gapped operation (the architect daemon doesn't need to
//     phone home to a paid data feed)
//
// Real-exchange providers (Binance, Coinbase, etc) implement the same
// MarketProvider interface and slot in transparently.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MarketCandle, MarketProvider, MarketSnapshot } from '../types.js'

export interface FileProviderConfig {
  /** Directory holding `<symbol>.json` files. */
  fixturesDir: string
  /** Override the wall clock (test injection). Default Date.now. */
  now?: () => number
}

interface FixtureFile {
  symbol: string
  candles: MarketCandle[]
}

export function createFileMarketProvider(config: FileProviderConfig): MarketProvider {
  const now = config.now ?? Date.now
  return {
    id: 'file',
    async fetchSnapshot(symbol: string): Promise<MarketSnapshot> {
      const path = join(config.fixturesDir, `${symbol}.json`)
      if (!existsSync(path)) {
        throw new Error(`file-provider: no fixture for symbol "${symbol}" at ${path}`)
      }
      const raw = readFileSync(path, 'utf8')
      let parsed: FixtureFile
      try { parsed = JSON.parse(raw) as FixtureFile }
      catch (err) {
        throw new Error(`file-provider: invalid JSON in ${path}: ${(err as Error).message}`)
      }
      if (!parsed.candles?.length) {
        throw new Error(`file-provider: ${path} must contain a non-empty candles array`)
      }
      const last = parsed.candles[parsed.candles.length - 1]
      return {
        symbol: parsed.symbol ?? symbol,
        price: last.close,
        candles: parsed.candles,
        takenAt: now(),
        providerId: 'file',
      }
    },
  }
}

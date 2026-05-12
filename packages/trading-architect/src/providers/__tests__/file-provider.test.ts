import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileMarketProvider } from '../file-provider.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'file-provider-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function fixture(symbol: string, candles: Array<{ close: number }>) {
  const full = candles.map((c, i) => ({
    timestamp: i, open: c.close, high: c.close, low: c.close, close: c.close, volume: 1,
  }))
  writeFileSync(join(dir, `${symbol}.json`), JSON.stringify({ symbol, candles: full }))
}

describe('createFileMarketProvider', () => {
  it('reads a fixture file and returns the latest close as price', async () => {
    fixture('BTC-USD', [{ close: 1 }, { close: 2 }, { close: 3 }])
    const provider = createFileMarketProvider({ fixturesDir: dir, now: () => 100 })
    const snap = await provider.fetchSnapshot('BTC-USD')
    expect(snap.symbol).toBe('BTC-USD')
    expect(snap.price).toBe(3)
    expect(snap.candles).toHaveLength(3)
    expect(snap.takenAt).toBe(100)
    expect(snap.providerId).toBe('file')
  })

  it('throws when the fixture file is missing', async () => {
    const provider = createFileMarketProvider({ fixturesDir: dir })
    await expect(provider.fetchSnapshot('MISSING')).rejects.toThrow(/no fixture/)
  })

  it('throws when the fixture has invalid JSON', async () => {
    writeFileSync(join(dir, 'BAD.json'), 'not json{')
    const provider = createFileMarketProvider({ fixturesDir: dir })
    await expect(provider.fetchSnapshot('BAD')).rejects.toThrow(/invalid JSON/)
  })

  it('throws when the fixture has an empty candles array', async () => {
    writeFileSync(join(dir, 'EMPTY.json'), JSON.stringify({ symbol: 'EMPTY', candles: [] }))
    const provider = createFileMarketProvider({ fixturesDir: dir })
    await expect(provider.fetchSnapshot('EMPTY')).rejects.toThrow(/non-empty candles array/)
  })

  it('id is "file" so notes and gates can scope by provider', () => {
    const provider = createFileMarketProvider({ fixturesDir: dir })
    expect(provider.id).toBe('file')
  })
})

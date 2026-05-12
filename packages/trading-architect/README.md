# @coastal-ai/trading-architect

**Optional vertical package.** Coastal.AI's kernel ships without any trading
or financial-markets functionality. Install this package only if you want
the architect to produce, persist, and visualize trade signals.

Importing anything from this package as a side effect:

- Registers `'trade'` as a note kind with the core kinds-registry so
  `NoteStore` will accept trade-signal notes.
- Adds the package's directory to your TypeScript workspace resolution.

If you never import from this package, the kernel behaves as if trading
infrastructure doesn't exist — including:

- The `NoteStore` rejects writes with `kind: 'trade'` at the application
  layer (`unregistered note kind`).
- The REST notes API's Zod schema rejects requests with `kind: 'trade'`.
- The `MyceliumCanvas` will never render trade nodes because none can be
  persisted.

## What's in the box

### Types
- `MarketCandle`, `MarketSnapshot` — OHLCV time series with provenance.
- `TradeSignal` — buy/sell/hold + confidence + reasoning + price-at-emit.
- `MarketProvider` — pluggable data source interface.
- `SignalGenerator` — pure-ish generator: snapshot → TradeSignal | null.
  Async-friendly (returns `T | Promise<T>`) so HTTP-backed generators
  compose with deterministic local ones.

### Providers
- `createFileMarketProvider` — reads `<symbol>.json` from a fixtures
  directory. Useful for tests, back-testing, and air-gapped operation.

### Generators
- `createRsiThresholdGenerator` — classic Wilder-smoothed RSI mean
  reversion. Buys oversold, sells overbought. Deterministic and
  testable; useful as a baseline.
- `createKronosAdapter` — HTTP adapter for the `shiyu-coder/Kronos`
  foundation model. Talks to a Python sidecar (operator runs it
  separately). Gracefully returns `null` when the sidecar is down so
  the cycle keeps producing RSI signals.

### Runner
- `runTradeTick` — one-shot orchestrator. For each (symbol, provider)
  pulls a snapshot, runs every generator, persists non-null signals.
  Errors per (symbol, provider, generator) are recorded but never abort
  the tick.

### Persistence
- `writeTradeSignalAsNote` / `recentTradeNotes` / etc. live in this
  package (not core) so the kernel stays vertical-neutral.

## Usage

```ts
import {
  createFileMarketProvider,
  createRsiThresholdGenerator,
  runTradeTick,
} from '@coastal-ai/trading-architect'
import { NoteStore } from '@coastal-ai/core/memory/notes'

const store = new NoteStore({ dataDir: './data/architect' })
const provider = createFileMarketProvider({ fixturesDir: './data/markets' })
const generator = createRsiThresholdGenerator() // RSI(14), thresholds 30/70

const result = await runTradeTick({
  symbols: ['BTC-USD', 'ETH-USD'],
  providers: [provider],
  generators: [generator],
  store,
})

console.log(result.signalsEmitted) // { 'BTC-USD': 1, 'ETH-USD': 0 }
```

To use Kronos:

```ts
import { createKronosAdapter } from '@coastal-ai/trading-architect'

const kronos = createKronosAdapter({ baseUrl: 'http://localhost:8788' })
// Then include `kronos` in the `generators` array passed to runTradeTick.
```

You'll need to run the Kronos sidecar yourself — this package only
ships the wire. See the
[sidecar contract](./src/generators/kronos-adapter.ts) at the top of
`kronos-adapter.ts` for the expected request/response shapes.

## Status

| Component | State |
|---|---|
| Types + interfaces | Stable |
| File provider | Stable |
| RSI generator | Stable |
| Kronos adapter | Stable (wire only — sidecar BYO) |
| `runTradeTick` | Stable, one-shot |
| Daemon loop | **Not yet shipped** |
| REST control | **Not yet shipped** |
| SettingsTab UI | **Not yet shipped** |
| TradingAgents adapter (Tauric) | **Not yet shipped** |

The substrate is built; orchestration and UX are pending follow-ups.

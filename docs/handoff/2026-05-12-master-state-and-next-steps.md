# Handoff — Master State & Next Steps

**Date:** 2026-05-12
**Branch:** `master` at `8dde158` (clean, pushed)
**Supersedes:** [`2026-05-11-v1.7-unified-memory-roadmap.md`](./2026-05-11-v1.7-unified-memory-roadmap.md) (kept for slice-by-slice detail)
**Tests:** 371 passing — `core` (233) + `architect` (95) + `trading-architect` (43)

---

## TL;DR

Across two sessions on `feat/v1.6-user-profile`, eight feature slices and one structural refactor shipped, then the branch was merged to master with `--no-ff`, the residual hardware-scan feature was cherry-picked from a stale branch, and all metadata (versions, README, CHANGELOG) was aligned with reality.

The architect now operates over a unified knowledge graph (Obsidian-style notes substrate populated by 6 ingesters), the planner sees its impact radius and design context on every cycle, the building stage gates on prompt-eval regressions, the kernel is vertical-neutral (trading is an opt-in plugin via the kinds-registry), and the System page exposes hardware-aware model recommendations.

The branch tree is clean: only `master` exists locally; the v1.6 user-profile and hardware-scan feature branches were deleted post-merge; `origin/feat/polish-windows-update` was deleted (residual value drained); `origin/apt` was kept as a separate release-artifact lane.

---

## What ships on master right now

### Versions

| Component | Version |
|-----------|---------|
| `VERSION` (root) | `1.7.0-dev` |
| `@coastal-ai/core` | `1.7.0-dev` |
| `@coastal-ai/architect` | `1.7.0-dev` |
| `@coastal-ai/daemon` | `1.7.0-dev` |
| `@coastal-ai/trading-architect` | `1.7.0-dev` |
| `web` | `1.7.0-dev` |
| `@coastal-ai/shell` | `0.1.0` (intentionally pre-1.0) |
| `@coastal-ai/video` | `0.0.0` (intentionally pre-1.0) |

### Capability inventory (since v1.5)

**v1.6 — User profile (preferences-as-data)**

- 7-knob preference profile in `architect.db` table `user_profile`: `planVerbosity`, `autoApproveThreshold`, `testStrictness`, `gatePolicy`, `tone`, `iterationPatience`, `riskPosture`. All CHECK-constrained enums.
- Modes (`hands-on` / `hands-off` / `autopilot`) reduced to **presets** that fan out into 3 of the 7 knobs (`gatePolicy`, `autoApproveThreshold`, `testStrictness`). The fourth mode `custom` is *derived* — the daemon computes it from the current profile values.
- Architect daemon reads the profile per cycle, so live edits via REST or the SettingsTab take effect on the next cycle without a daemon restart.
- Building stage consumes `testStrictness` (`must-pass` blocks, `warn` passes with `[WARN]` summary, `advisory` passes silently with `[ADVISORY]` prefix). Daemon's `isApprovalRequired` consumes `gatePolicy`.
- Frontend Preferences panel under Settings → Architect. Custom-mode badge appears inline next to the Mode heading whenever any preset knob drifts off its mode value.

**v1.7 — Unified knowledge graph (architect's shared memory)**

- New `obsidian.db` with `notes` + `note_links` + `mention_feedback` tables. `kind` is validated at the application layer (no SQLite CHECK) so plugins can register additional kinds at runtime.
- Wikilink + entity-mention parser with a learned-policy feedback loop: when a user manually unlinks an auto-`mentions` edge, a per-target rejection counter increments; future auto-mentions of that target get suppressed once it exceeds threshold.
- Frontend KNOWLEDGE toggle on the Agent Graph fades the agent layer (Mycelium canvas) and brings notes forward in violet. Sidebar grows clickable backlinks + outgoing-link list with per-edge ✕ unlink (which also feeds the learned policy).
- Three ingesters populate the graph on every daemon startup:
  - **Code-graph** — regex scanner walks `packages/*/src` for `.ts`/`.tsx`, extracts imports + exports. Each file becomes a `kind='code'` note; each resolved import becomes a `mentions` edge. Stale-edge removal passes `recordFeedback: false`.
  - **Design** — every `packages/<name>/DESIGN.md` is parsed into atomic H2 sections (Zettelkasten style). File note `contains` each section; in-file `[[wikilinks]]` resolve to sibling section ids.
  - **Eval** — versioned prompt registry (`registerPrompt(id, version, template)`); planner template extracted to `planner.v1.ts`. Eval runner with `contains` / `matches` / `minLength` / `maxLength` assertions persists results as `kind='eval'` notes.
- Two C-line gates ship the substrate, not yet wired by default:
  - **DOM snapshot** — HTTP browser snapshotter persists `kind='dom'` notes; `runDomGate` compares fresh vs. last-OK baseline (status / shrink / new console errors).
  - **Visual diff** — extracts H1-H3 headings + button/link/label text + error keywords; reports added/removed sets + Jaccard similarity + `regressed` flag.
- Planner prompt now accumulates three optional context channels (each backwards-compatible — omit ⇒ legacy behavior):
  - `IMPACT RADIUS` — code-graph backlinks for the targeted files
  - `DESIGN SYSTEM` — relevant `DESIGN.md` sections when targets touch a UI package
  - `PRIOR ATTEMPT FEEDBACK` — existing reviseContext (pre-v1.7)
- Building stage accumulates one optional gate (after tests pass):
  - `runEvals` — pure read of latest planner-eval verdicts; soft_fail with `failureKind='eval'` on regression. New `'eval'` value added to `FAILURE_KINDS`.

**Tier 2 refactor — vertical neutrality**

- New `KindsRegistry`: `CORE_KINDS` enumerates 8 generic kinds (`cycle` / `learning` / `code` / `design` / `eval` / `dom` / `visual_diff` / `user`); plugins extend via `registerKind(kind)` side-effect on import.
- `'trade'` removed from core; `trade-notes.ts` moved to `packages/trading-architect/src/notes.ts`. Importing the trading-architect package registers `'trade'` automatically.
- SQLite CHECK constraint on `notes.kind` dropped in favor of app-level `assertRegisteredKind` so the registry can grow without schema migrations.
- REST notes route schema switched from `z.enum(NOTE_KINDS)` to `z.string().refine(isRegisteredKind)` — kinds registered after server start are honored per-request.
- Web client `NoteKind` widened from closed union to `string`; `CoreNoteKind` available for compile-time-checked core code.

**Trading architect — optional vertical (B-line)**

- `packages/trading-architect/` peer package; importing it registers `'trade'` with the core kinds-registry.
- `MarketProvider` / `SignalGenerator` interfaces, async-friendly (returns `T | Promise<T>`) so HTTP-backed and deterministic generators compose.
- Built-in providers: file-backed JSON fixture provider for tests / back-testing / air-gapped operation.
- Built-in generators: RSI mean-reversion (Wilder smoothing, configurable thresholds, fully deterministic) + Kronos foundation-model HTTP adapter (talks to a Python sidecar; gracefully returns `null` when offline).
- `runTradeTick` orchestrates one cycle; trade signals persist as `kind='trade'` notes that render on the canvas alongside everything else.

**Hardware scan (cherry-picked)**

- `packages/core/src/models/hardware-scan.ts` — `scanHardware()` probes GPU/RAM/disk; `recommendModels()` returns a `minimum` / `recommended` / `optimal` Ollama-model trio.
- `GET /api/admin/hardware-scan` REST endpoint.
- Hardware card on the System page renders the scan + recommendation trio live.

### File census (what's where)

```
packages/core/src/
  memory/
    notes.ts                    NoteStore + assertRegisteredKind (v1.7)
    kinds-registry.ts           CORE_KINDS + registerKind (Tier 2)
    wikilinks.ts                Parser + learned-policy feedback (v1.7)
    code-graph-id.ts            Shared id format (v1.7-A1)
    code-graph-sync.ts          Reconcile code scan into NoteStore (v1.7-A1)
    impact.ts                   getImpactSummary for planner (v1.7-A1)
    markdown-ingest.ts          Markdown → atomic notes (v1.7-A2)
    markdown-sync.ts            Reconcile markdown ingest (v1.7-A2)
    design-context.ts           getDesignContext for planner (v1.7-A2)
    dom-snapshots.ts            DOM-snapshot persistence (v1.7-C1)
    visual-diff.ts              Structural visual diff (v1.7-C2)
    index.ts                    UnifiedMemory facade (Mem0 + Lossless + Infinity + NoteStore)
    lossless.ts mem0.ts infinity-client.ts  (pre-v1.7, unchanged)
  prompts/
    registry.ts                 Versioned prompt registry (v1.7-A3)
    eval-runner.ts              Assertion DSL + LLM-agnostic runner (v1.7-A3)
    eval-notes.ts               Eval results as kind='eval' notes (v1.7-A3)
  api/routes/
    notes.ts                    Notes CRUD + policy feedback REST (v1.7)
    architect-user-profile.ts   v1.6 user-profile REST
    architect-controls.ts       Mode preset writes (v1.6 reconciled)
    system.ts                   GET /api/admin/hardware-scan added
  models/
    hardware-scan.ts            scanHardware + recommendModels (cherry-pick)
  architect/
    user-profile/store.ts       UserProfileStore (v1.6)
    user-profile/modes.ts       Mode presets + deriveMode (v1.6)
    user-profile/questions.ts   PREFERENCE_QUESTIONS for wizard (v1.6)
    types.ts                    FAILURE_KINDS gained 'eval' (v1.7-A3)

packages/architect/src/
  prompts/
    planner.v1.ts               Planner template extracted to registry (v1.7-A3)
    planner.fixtures.ts         3 structural fixtures (v1.7-A3)
  learnings/
    code-graph.ts               Regex scanner (v1.7-A1)
    design-ingest.ts            DESIGN.md walker (v1.7-A2)
    run-evals.ts                Wires modelClient → eval runner (v1.7-A3)
    eval-gate.ts                Pure read of latest verdicts (v1.7-A3)
    browser-snapshot.ts         BrowserSnapshotter + HTTP impl (v1.7-C1)
    dom-gate.ts                 Compare fresh vs baseline (v1.7-C1)
  stages/
    planning.ts                 + impactSummary + designContext optional inputs
    building.ts                 + runEvals optional gate
  index.ts                      Daemon wires all the above on startup

packages/trading-architect/      NEW PACKAGE
  src/
    types.ts                    MarketSnapshot / TradeSignal / interfaces
    runner.ts                   runTradeTick orchestrator
    notes.ts                    Trade-as-notes (moved from core in Tier 2)
    providers/file-provider.ts  Fixture-backed market data
    generators/rsi-threshold.ts RSI mean-reversion
    generators/kronos-adapter.ts HTTP adapter for Kronos sidecar
    index.ts                    Side-effect: registerKind('trade')
  README.md                     Documents the package as opt-in vertical

packages/web/
  DESIGN.md                     v1.7-A2 — design system documentation
  src/
    api/client.ts               Note CRUD + hardware-scan client methods
    hooks/useNotes.ts           Note graph data hook (v1.7-0d)
    pages/AgentGraph.tsx        KNOWLEDGE toggle, sidebar backlinks
    components/MyceliumCanvas.tsx  Note color/edge palette
    types/agent-graph.ts        NodeType += 'note'
    pages/System.tsx            Hardware card (cherry-pick)

docs/
  handoff/
    2026-05-12-master-state-and-next-steps.md  THIS FILE
    2026-05-11-v1.7-unified-memory-roadmap.md  Slice-by-slice detail (v1.7 only)
    _archive/                   Pre-v1.7 + v1.6 slice-1 (superseded)
README.md                       Updated header + Modes + Knowledge Graph + Features
CHANGELOG.md                    v1.6.0 + v1.7.0-dev entries added (Keep-a-Changelog)
VERSION                         1.7.0-dev
```

---

## Recent activity (last 12 commits on master)

```
8dde158 chore: post-merge housekeeping — versions, README, CHANGELOG, handoff archive
3dc4a15 Merge feat/hardware-scan — cherry-pick hardware-scan feature from polish-windows-update
23549c7 feat(web): hardware-scan types, client method, Hardware card on System page
44cf312 feat(core/api): GET /api/admin/hardware-scan endpoint
74ff790 fix(core): block-body beforeEach/afterEach for hardware-scan tests
4c81c54 feat(core/models): hardware-scan module
1b5ae97 Merge feat/v1.6-user-profile — v1.6 user-profile + v1.7 unified-memory roadmap
546b123 refactor(core): Tier 2 — kinds-registry + trading moves out of kernel
c237b4e docs(handoff): v1.7 unified-memory roadmap session handoff + bump VERSION
5bf9bab feat(trading-architect): B2 — Kronos foundation-model SignalGenerator
1a6f337 feat(trading-architect): B1 — peer package + signal-as-notes substrate
dbdca9e feat(architect): C2 — structural visual diff between DOM snapshots
```

Use `git log --first-parent master` to walk only the merge points; the per-slice commits are reachable through them.

---

## Architectural through-line

**The notes substrate is the seam everything else hangs off.**

Every learnings module (code-graph, design ingest, eval runner, DOM snapshot, visual diff, trade signals) follows the same hygiene pattern:

1. Stable, deterministic note id with sortable suffix (`<kind>:<scope>:<timestamp>` or similar).
2. `sourceType` + `sourceId` for scoped reconciliation via `NoteStore.bySource(sourceType, sourceId)`.
3. Stale-edge removal passes `recordFeedback: false` so internal churn never poisons the learned mention policy.
4. Machine-readable trailing block in body (`` ```snapshot-meta `` / `` ```diff-meta `` / `` ```signal-meta ``) that round-trips back into a typed object — no separate index needed.

**The planner has three context channels in parallel.** Each is a pure function over the notes layer, resolved once per cycle by the daemon, and threaded into `runPlanningStage` as an optional input. Adding a fourth (e.g. cross-cycle learnings, prior eval outputs) is the same template.

**The building stage gates compose by short-circuit.** Lint → type → build → test → optional eval. Failure kind from `FAILURE_KINDS` enum tells the cycle store what happened; `testStrictness` gates the test step's hard/soft behavior.

**The kernel is vertical-neutral.** `CORE_KINDS` is 8 generic kinds; everything domain-specific (trade, future image-gen, audio-gen) lives in a peer package that calls `registerKind(...)` on import. The kernel never imports a vertical.

---

## Operational notes

### To use the new architect features

1. **Run the daemon**: `coastal-ai architect on` (or `pnpm --filter @coastal-ai/architect dev`).
2. **Tune the profile**: Settings → Architect → Preferences. Or REST: `PUT /api/admin/architect/user-profile` with a partial Zod-validated body.
3. **View the knowledge graph**: open the Agent Graph page, click the **KNOWLEDGE** toggle (top-left). Note nodes appear in violet; click any to see backlinks; click a backlink to navigate.
4. **Trigger an eval pass** (one-shot, opt-in): set `CC_ARCHITECT_RUN_EVALS=1` and restart the daemon; it will run all planner fixtures via the live `modelClient` and persist results.
5. **Hardware scan**: `GET /api/admin/hardware-scan`, or just open the System page and look at the Hardware card.

### To install the optional trading vertical

Already installed by virtue of being a workspace package — there's no separate npm install. To opt in, just import from it in your daemon entry or a script:

```ts
import {
  createFileMarketProvider, createRsiThresholdGenerator, runTradeTick,
} from '@coastal-ai/trading-architect'
```

The import side-effect registers `'trade'` with the kinds-registry. To opt out: don't import. To remove entirely: delete `packages/trading-architect/`.

### To add a new vertical (the pattern)

1. New package under `packages/<vertical>/`
2. Imports from `@coastal-ai/core/memory/*`
3. Calls `registerKind('<your_kind>')` at module load (top of `src/index.ts`)
4. Ships its own ingester / runner / persistence helpers
5. Kernel doesn't need to know about it

`packages/trading-architect/` is the reference implementation.

---

## What's next (prioritized)

### Quick wins (1–2 hours each)

- **Per-kind canvas colors** — today every note is violet. Eval-fail nodes should be red, trade-buy green, dom-fail amber. Read note `kind` + verdict from title glyph; extend `NODE_COLOR` in `MyceliumCanvas.tsx`.
- **REST trigger routes** for the v1.7 ingesters: `POST /api/admin/architect/learnings/code-graph/sync`, `/design/sync`, `/evals/run`. Backend functions all exist; just fastify wrappers with the global admin-auth hook.
- **`evalStrictness` profile knob** mirroring `testStrictness`. Schema migration concerns: add column with DEFAULT, no rebuild needed since SQLite supports `ALTER TABLE ADD COLUMN`.
- **DOM gate wiring** behind `CC_ARCHITECT_DOM_URLS=...` env var. One-line plumbing in the daemon's `runBuild` callback.
- **Browser smoke test** of slice 0d. The Knowledge toggle + sidebar backlinks have only been typecheck/build-verified; never driven in a real browser.
- **Wire architect daemon to call hardware-scan** at startup and use the `recommended` model trio for default `CC_ARCHITECT_MODEL`. Today the model is hardcoded via env or defaulted to `llama3.2`; the recommendation should preempt that on a fresh install.

### Medium (half-day each)

- **SettingsTab UI for the policy feedback table** — `listMentionFeedback()` exists; render as a table so users can see/clear suppressed mention targets.
- **Live notes feed widget** on Agent Graph — sidebar showing the most-recent N writes across all kinds. Pure frontend over the existing `useNotes` hook.
- **Trading-architect daemon loop** — wrap `runTradeTick` in a setInterval (mirror `architect/daemon.ts`); add SettingsTab controls for symbols + interval.
- **CI/CD pipeline that runs the targeted vitest groups** — the full suite hits a known Windows segfault in `snapshots.test.ts`. The targeted approach (`npx vitest run src/memory src/prompts src/architect/__tests__`) works and is what we run manually. CI should mirror that grouping.

### Big bets (multi-day each)

- **Real Kronos sidecar deploy** — clone `shiyu-coder/Kronos`, write a Flask/FastAPI `/predict` wrapper, ship a Dockerfile under `packages/trading-architect/sidecar/`. Requires Python + GPU expertise.
- **Vision-LLM upgrade for visual diff** — current C2 is structural HTML diff. A real GPT-4V / UI-TARS judge writes the same `kind='visual_diff'` note shape with richer reasoning. Adds vision-API dependency + cost; behind a feature flag is the obvious shape.
- **Cross-package code-graph edges** — A1 scanner skips workspace imports (`@coastal-ai/core/architect/db`). Resolving them properly means walking each package's `exports` map and resolving the `dist/` path back to source.
- **Full TauricResearch/TradingAgents integration** — multi-agent LLM trading framework as another `SignalGenerator` (Python sidecar like Kronos).
- **Tier 3 plugin architecture** — formal manifest, discovery (`plugins/` dir or `@coastalai-plugin-*` npm scope), lifecycle hooks, UI for management. The current Tier 2 substrate is enough to validate the pattern with one real plugin (trading-architect); Tier 3 is the productization step.

### Documentation backlog

- **`CONTRIBUTING.md`** at repo root — for an open-source project, the lack of one is a small friction. The Tier 2 vertical-package pattern is the kind of guidance that belongs there.
- **`docs/CI-CD-SANDBOX.md`, `DEVELOPER_GUIDE_GRAPHQL.md`, `GRAPHQL_AGENT_DEPENDENCIES.md`, `phase5-launch.md`** — all dated `Apr 28`. Audit for accuracy or move to `_archive/`.
- **README's "Hardware-Aware Tiers" Feature row** mentions `Lite`/`Standard`/`Apex` but the new hardware-scan endpoint uses `minimum`/`recommended`/`optimal`. One should win and the other should be retired.

---

## Known issues / quirks

- **Pre-existing Windows segfault in the full vitest suite.** Triggered by `snapshots.test.ts` when running the architect package's full `pnpm test`. Individual test files run cleanly. Workaround: run targeted groups (the test-sweep commands in this doc are the safe form). Investigation deferred — predates this work.
- **10 `TODO` / `FIXME` comments** scattered across `packages/*/src/**/*.ts`. None are blocking; a sweep to either resolve or convert to issues would clean ambient debt.
- **`packages/web` `useNotes` hook fetches each note's outgoing links sequentially** via `getNote(id)`. Acceptable for low-thousands of notes; will need a bulk `/links` endpoint when the corpus grows.
- **`packages/core` `obsidian.db` and `architect.db` live in the same `dataDir` as `lossless.db`** — both processes (daemon + server) open them with WAL, which is fine, but if you ever need to nuke the knowledge graph, `rm obsidian.db*` is the surgical option (chat history at `lossless.db` is separate).
- **`origin/apt` remote branch** is 525 commits behind master. Kept intentionally as a release-artifact lane (publishes `.deb` packages); not a feature branch. Lifecycle owned externally.

---

## Quick reference — commands you'll want

```bash
# Run all tests by package
cd packages/core            && npx vitest run src/memory src/prompts src/architect/__tests__
cd packages/architect       && npx vitest run src/learnings src/stages
cd packages/trading-architect && npx vitest run

# Build core (required for architect/trading-architect to resolve subpath exports)
cd packages/core && npx tsc

# Typecheck without emit
cd packages/core && npx tsc --noEmit
cd packages/architect && npx tsc --noEmit
cd packages/web && npx tsc --noEmit -p tsconfig.app.json

# Web production build
cd packages/web && npx vite build

# Trigger an architect eval pass on next startup
CC_ARCHITECT_RUN_EVALS=1 pnpm --filter @coastal-ai/architect dev

# Browse the knowledge graph
# → open the web UI, navigate to Agent Graph, click KNOWLEDGE toggle
```

---

## Memory note for next session

The auto-memory file at `C:\Users\John\.claude\projects\c--Users-John-CoastalAI\memory\project_v1.6_user_profile.md` was updated through commit `5bf9bab` (B2). It does NOT yet reflect the Tier 2 refactor (`546b123`) or the hardware-scan cherry-pick (`3dc4a15`) or this housekeeping commit (`8dde158`). When picking up next session:

1. Read this handoff first (it's authoritative through `8dde158`).
2. Update the memory file to point to this doc instead of the older slice-by-slice one.
3. The "v1.6 status" framing in the memory file name is now misleading — most of what's there is v1.7. Consider renaming the memory file to `project_unified_memory_v1.7.md` for clarity.

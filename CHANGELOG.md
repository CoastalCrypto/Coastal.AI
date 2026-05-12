# Changelog

All notable changes to Coastal.AI are documented here.

## [1.7.0-dev] — 2026-05-11/12

### The Unified-Memory Release

Coastal.AI's architect now operates over a shared knowledge graph. Every cycle reads and writes typed notes (`code`, `design`, `eval`, `dom`, `visual_diff`, `trade`, `learning`, `user`, `cycle`) connected by wikilinks and auto-detected entity mentions. The planner prompt gains three new context channels (impact radius, design system, prior-attempt feedback) and the building stage gains an optional eval gate. The kernel was simultaneously refactored to be vertical-neutral — trading lives in an opt-in peer package that registers its note kind at module load.

### Added

**Notes substrate (slice 0)**
- `NoteStore` with `notes`/`note_links`/`mention_feedback` tables in `obsidian.db`
- FTS5 full-text search, CHECK-constrained link kinds (`mentions`/`derives_from`/`contradicts`/`supersedes`/`contains`)
- Wikilink + entity-mention parser with learned-policy feedback loop — auto-mention rejection bumps a per-target counter, future auto-links to repeatedly-rejected targets get suppressed
- `KindsRegistry` (Tier 2) — `CORE_KINDS` enumerates 8 generic kinds; plugins extend the runtime set via `registerKind(...)` side-effect on import
- 12-route REST surface: CRUD + search + subgraph + manual link management + policy feedback
- Frontend: `useNotes` hook + KNOWLEDGE toggle on Agent Graph that dims agents and brings notes forward; sidebar grows clickable backlinks and outgoing-link list with per-edge ✕ unlink

**Code-graph as notes (A1)**
- Regex-based scanner walks `packages/*/src` for `.ts`/`.tsx`, extracts import specifiers + top-level exports
- `syncCodeGraph` upserts one `kind='code'` note per file + one `mentions` edge per resolved import; stale-edge removal passes `recordFeedback: false`
- `getImpactSummary` formats backlinks of a target file as prompt-ready prose — "Imported by (N): a.ts, b.ts, …"
- Planner injects an `IMPACT RADIUS` block when a work item touches files with known importers

**DESIGN.md ingest (A2)**
- New `packages/web/DESIGN.md` documents the de-facto design system (color tokens, typography, component idioms, animation language, status palette)
- Markdown ingester splits each `DESIGN.md` by H2 into atomic section notes (Zettelkasten-style), file note `contains` each section, in-file `[[wikilinks]]` resolve to sibling section ids
- Planner injects a `DESIGN SYSTEM` block when target hints touch a package with a `DESIGN.md`

**Eval gate (A3)**
- Prompt registry (`registerPrompt` / `getPrompt` / `getLatestPrompt`) — versioned templates pinned by `(id, version)`
- Eval runner with `contains` / `matches` / `minLength` / `maxLength` assertions (with `not:true` inversion); LLM errors recorded as failures rather than thrown
- Eval-results-as-notes: each fixture run becomes a `kind='eval'` note; `latestEvalVerdicts` collapses history to one verdict per fixture for the gate
- Optional `runEvals` callback on `BuildingInput`; soft_fail with new `failureKind='eval'` on regression
- Planner template extracted from `planning.ts` into the registry (`planner.v1`); 3 default fixtures cover structural correctness

**DOM snapshot gate + visual diff (C1, C2)**
- `BrowserSnapshotter` interface + HTTP impl; persists `kind='dom'` notes with embedded `snapshot-meta` JSON for round-trip
- `runDomGate` compares fresh vs. latest-OK baseline; trips on status regression, body shrink past configurable ratio, or new console errors
- `computeVisualDiff` extracts H1-H3 headings + button/link/label text + error keywords; reports added/removed sets + Jaccard similarity + `regressed` flag
- Both gates substrate-only — opt-in wiring deferred behind `CC_ARCHITECT_DOM_URLS`

**Trading architect — optional vertical (B1, B2)**
- New `packages/trading-architect/` peer package; importing it registers `'trade'` with the kinds-registry
- `MarketProvider` / `SignalGenerator` interfaces, async-friendly (returns `T | Promise<T>`) so HTTP-backed and deterministic generators compose
- File-backed provider for tests + back-testing
- RSI mean-reversion generator (Wilder smoothing, configurable thresholds) as the deterministic baseline
- Kronos foundation-model HTTP adapter (talks to a Python sidecar; gracefully returns null when offline)
- `runTradeTick` orchestrates one cycle; signal persistence as `kind='trade'` notes lives in the package, not core

**Hardware scan (cherry-picked from polish-windows-update)**
- `packages/core/src/models/hardware-scan.ts` — scans GPU/RAM, computes `minimum`/`recommended`/`optimal` Ollama model trio
- `GET /api/admin/hardware-scan` endpoint
- Hardware card on the System page with the recommendation trio rendered live

### Changed

**Kernel is now vertical-neutral (Tier 2 refactor)**
- `'trade'` removed from `CORE_KINDS`; SQLite `CHECK` constraint on `notes.kind` dropped in favor of app-level `assertRegisteredKind`
- `trade-notes.ts` moved from `packages/core/src/memory/` to `packages/trading-architect/src/notes.ts`
- New top-level "Package Layout — Core vs. Optional" section in README documents the kernel + delete-safe verticals contract
- `NoteKind` widened from closed union to `string`; `CoreNoteKind` available for compile-time-checked core code

**Planner stage now composable**
- `PlanningInput` accepts `impactSummary?: string | null` and `designContext?: string | null` — both optional, both omitted ⇒ legacy behavior
- Template moved out of `planning.ts` into the prompt registry; same wording, version 1

**Building stage now extensible**
- New `runEvals?: () => GateOutput` callback; runs after a successful test gate (no point evaluating prompts on a broken build)
- `BuildingResult` extended with `failureKind='eval'`; cycle store's `FAILURE_KINDS` gains `'eval'`

### Infrastructure

- 358+ tests across `core` (220) + `architect` (95) + `trading-architect` (43) + hardware-scan additions (13)
- 13 new core subpath exports: `memory/*` (kinds-registry, code-graph-id, code-graph-sync, impact, markdown-ingest, markdown-sync, design-context, dom-snapshots, visual-diff) and `prompts/*` (registry, eval-runner, eval-notes)
- Two complete session handoffs in `docs/handoff/` covering the v1.6 user-profile and v1.7 unified-memory roadmaps

---

## [1.6.0] — 2026-05-08/10

### The Preference-Profile Release

The architect's behavior is now tuned through a 7-knob preference profile stored in `architect.db`. The existing 3-mode legacy system (hands-on/hands-off/autopilot) became presets that fan out into the new knobs; the fourth mode `custom` is derived when any knob drifts off-preset.

### Added

**User-profile persistence layer**
- New `user_profile` table with default row seeded on first boot
- 7 CHECK-constrained enum columns: `planVerbosity`, `autoApproveThreshold`, `testStrictness`, `gatePolicy`, `tone`, `iterationPatience`, `riskPosture`
- `UserProfileStore` with `getDefault` / `getOrCreate` / `getById` / `update`
- `PREFERENCE_QUESTIONS` array + `answersToProfilePatch` for the first-run wizard

**REST surface**
- `GET /api/admin/architect/user-profile`
- `PUT /api/admin/architect/user-profile` (Zod `.strict()` validation)
- `GET /api/admin/architect/user-profile/questions`
- `POST /api/admin/architect/user-profile/wizard`

**Mode reconciliation**
- `MODE_PRESETS` for `hands-on` / `hands-off` / `autopilot` — each preset writes a specific combination of `gatePolicy`, `autoApproveThreshold`, `testStrictness`
- `applyMode(store, id, mode)` and `deriveMode(profile)` — selecting a mode is a write; if any preset knob drifts, the derived mode becomes `'custom'`
- `GET /status` returns the derived mode so the UI always reflects current truth

**Runtime integration**
- Architect daemon reads `user_profile` per cycle (live edits take effect on the next cycle without daemon restart)
- `runBuildingStage` consumes `testStrictness` — must-pass blocks, warn passes with `[WARN]` summary, advisory passes silently with `[ADVISORY]` prefix
- `ArchitectDaemon.isApprovalRequired` consumes `gatePolicy` — every-stage / plan-only / merge-only

**Frontend**
- Preferences panel in the Architect SettingsTab — knobs render as flex-wrap of selected/unselected chips
- Amber **CUSTOM** badge inline next to the Mode heading when `status.mode === 'custom'`
- Per-knob saving indicator so only the row being saved dims, not the whole panel

### Notes

- v1.6 work landed on the same branch (`feat/v1.6-user-profile`) as the subsequent v1.7 roadmap; both shipped together in the master merge `1b5ae97`

---

## [1.5.0] — 2026-05-04

### The Self-Healing Release

Coastal.AI now includes an autonomous Architect that takes work items, writes plans, runs against your real models, opens PRs, and shows its work.

### Added

**Architect Daemon**
- Queue-driven autonomous improvement system with 3-phase poll loop
- Planning stage: LLM-generated plans with `<plan>/<diff>` parsing, locked-path enforcement, budget checks
- Building stage: sequential lint/typecheck/build/test gates scoped to touched packages
- PR creation: `gh pr create` with generated body, trailers, draft mode for full-approval policy
- PR review polling: daemon monitors open PRs, transitions on merge/close
- Auto-merge for `approval_policy=none` via `gh pr merge --squash --auto`
- Time-Travel snapshots: shadow-git repo captures workspace state before builds, restorable to recovery branches
- Curriculum mode: idle-time self-improvement that harvests codebase signals (stale TODOs, churn hotspots) and proposes low-priority work items
- 30-day suppression for rejected curriculum proposals
- Event log (`architect_events` table) for SSE streaming to web UI
- HMAC-signed callback tokens for one-tap approval from notification channels
- Model router adapter: bridges existing ModelRouter to architect's tier-aware interface

**REST API (12 endpoints)**
- `GET/POST /api/admin/architect/work-items` — CRUD with status filters
- `PATCH /api/admin/architect/work-items/:id` — pause/resume/priority changes
- `GET /api/admin/architect/activity` — cycle timeline with stage/time filters
- `GET /api/admin/architect/cycles/:id` — full cycle detail
- `POST /api/admin/architect/cycles/:id/approval` — approve/revise/reject
- `GET/POST /api/admin/architect/power` — on/off control
- `POST /api/admin/architect/mode` — hands-on/hands-off/autopilot/custom
- `POST /api/admin/architect/run-now` — trigger immediate tick
- `GET /api/admin/architect/insights` — aggregate stats (success rate, iterations, time saved)
- `GET /api/admin/architect/receipts` — merged PRs with attribution
- `POST/GET /api/admin/architect/callbacks/:token` — HMAC callback resolution
- `GET /api/admin/architect/events` — SSE event stream

**CLI**
- `coastal-ai architect on|off` — power control
- `coastal-ai architect status` — plain-English summary
- `coastal-ai architect mode <hands-on|hands-off|autopilot>` — mode switch
- `coastal-ai architect ask "description"` — create work item
- `coastal-ai architect queue` — list missions
- `coastal-ai architect approve|reject|revise <id>` — gate decisions
- `coastal-ai architect last` — recent activity
- `coastal-ai architect digest` — 24h summary

**Web Dashboard**
- Architect page with status card ("What's happening right now")
- Missions tab: work item list with create/pause/resume/cancel
- Activity tab: cycle timeline with inline expansion, filter chips, plan/test/PR detail
- Approval flow: approve/revise/reject buttons with comment input
- Insights tab: 6 stat tiles (success rate, avg iterations, time saved, queue depth, errors, top failure)
- Receipts tab: merged PR list with attribution metadata
- Settings tab: power toggle, mode selector (3 tiles), Run Now button

**Infrastructure**
- `architect_events` table for event streaming
- `snapshots` table for Time-Travel metadata
- `curriculum_suppressions` table for proposal dedup
- `CycleStore.listByStage()`, `.listRecent()`, `.recordApproval()`, `.getInsights()`, `.listMergedWithPR()`
- `WorkItemStore.listByStatus()`, `.listAll()`, `.countByStatus()`
- `Patcher.pushBranch()`, `.branchExistsOnRemote()`
- Output Channel notifications via existing ChannelManager (Telegram, Discord, Slack, Zapier)
- Daily digest timer in daemon

### Architecture

The architect is structured as a set of pure functions (planning, building, PR creation, PR review) wired into a daemon via dependency injection. All I/O is injected as closures, making every stage independently testable without filesystem, network, or LLM calls. The stage runner orchestrates plan-build-PR with a revise loop (exponential cooldown, budget exhaustion), and the daemon adds PR polling and curriculum scanning on top.

---

## [1.0.0] — 2026-04-15

Initial release of Coastal.AI.

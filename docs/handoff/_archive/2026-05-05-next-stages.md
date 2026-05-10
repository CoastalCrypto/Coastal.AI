# Next Stages — Coastal.AI Post-v1.5.0 Roadmap

**Date:** 2026-05-05
**Repo:** `C:\Users\John\CoastalAI` -> `https://github.com/CoastalCrypto/Coastal.AI`
**Branch:** `master`
**HEAD:** `32a0326`
**Tag:** `v1.5.0`

---

## Current State

Coastal.AI v1.5.0 is the "Self-Healing Release" — a fully autonomous architect daemon that takes work items, writes plans using local LLMs, runs them against build/test gates, opens PRs, and shows its work through a web dashboard.

### What's Shipped

| Component | Lines | Tests | Status |
|-----------|-------|-------|--------|
| **Architect daemon** (`packages/architect/`) | ~2,400 | ~133 (31 files) | Production-ready |
| **Core API** (`packages/core/`) | ~8,500 | 326 (66 files) | Production-ready |
| **Web dashboard** (`packages/web/`) | ~9,800 | — (visual) | Production-ready |
| **Daemon** (`packages/daemon/`) | ~600 | 28 (7 files) | Production-ready |
| **Shell** (`packages/shell/`) | ~200 | — | Electron wrapper, v0.1.0 |
| **Video** (`packages/video/`) | ~150 | — | Remotion promo, v0.0.0 |

### Architecture

```
┌─────────────────────────────────────────────┐
│ Web (React 19 + Vite + Tailwind v4)         │
│ ├── Chat (always mounted, SSE streaming)    │
│ ├── Architect dashboard (lazy-loaded)       │
│ └── 12 more pages (all lazy-loaded)         │
├─────────────────────────────────────────────┤
│ Core (Fastify v4 REST API)                  │
│ ├── 30+ routes, Zod validation, admin auth  │
│ ├── better-sqlite3 (WAL, FK)               │
│ ├── ModelRouter (Ollama/vLLM, tier-aware)   │
│ └── Architect stores (WorkItem, Cycle)      │
├─────────────────────────────────────────────┤
│ Architect (standalone daemon process)       │
│ ├── 3-phase tick: poll PRs → process → scan │
│ ├── Pure-function stages (plan/build/PR)    │
│ ├── Time-Travel snapshots (shadow-git)      │
│ └── Curriculum mode (signal harvesting)     │
├─────────────────────────────────────────────┤
│ Daemon (cron scheduler + voice pipeline)    │
│ └── Agent "hands" + wake-word listener      │
├─────────────────────────────────────────────┤
│ Ollama / vLLM (local inference)             │
└─────────────────────────────────────────────┘
```

### Tech Stack

- TypeScript 5.9, ESM, Node 22+, pnpm monorepo
- `module: Node16`, `moduleResolution: Node16`
- Cross-package: bare specifiers (`@coastal-ai/core/architect/types`)
- Intra-package: relative with `.js` extension
- React 19, no React Router (manual `page` state in App.tsx)
- Fastify v4, `@fastify/rate-limit`, `@fastify/websocket`, `@fastify/cors`
- better-sqlite3 with WAL mode and foreign keys
- Vitest for testing

---

## Stage 1: Smoke Test + Production Validation

**Priority:** CRITICAL — must complete before any new features.

### 1A. Manual Smoke Test with Real Ollama Model

**Goal:** Verify the full architect pipeline works end-to-end with a real LLM.

**Prerequisites:**
- Ollama installed and running (`ollama serve`)
- A model pulled (e.g., `ollama pull llama3.2`)

**Steps:**
1. Start the core server: `pnpm start`
2. Start the architect daemon: `node packages/architect/dist/index.js`
   - Ensure `CC_ARCHITECT_LEGACY` is NOT set (uses v1.5 queue-driven path)
   - Set `CC_OLLAMA_URL=http://127.0.0.1:11434` and `CC_ARCHITECT_MODEL=llama3.2`
3. Open the web UI → Architect page
4. Complete the first-run wizard (hands-on mode)
5. Create a work item: "Add a greeting message to the README"
6. Watch the daemon tick — it should:
   - Pick up the work item (status → active)
   - Call the LLM for planning (plan + diff)
   - Apply the diff, run lint/typecheck/build/test gates
   - If gates pass → create a PR via `gh pr create`
   - Activity tab shows the cycle progressing
7. Approve or reject the plan in the Activity tab
8. Verify Time-Travel snapshot was captured

**Known Issues to Watch:**
- Windows: `pnpm.cmd` vs `pnpm` — the daemon handles this via `execGate()` in index.ts:163
- `ModelRouter` → architect adapter uses `as any` cast (documented in model-router-client.ts header comment)
- `gh` CLI must be authenticated (`gh auth login`)

### 1B. Test Callback URLs

**Goal:** Verify HMAC-signed approval links work via Telegram/Discord.

**Prerequisites:**
- A Telegram bot token or Discord webhook URL
- Configure in the web UI Settings → Output Channels

**Steps:**
1. Set the architect mode to "hands-on"
2. Create a work item that will trigger a plan approval gate
3. When the notifier fires, check the channel for the callback URL
4. Click the approve link — should return "Done" HTML page
5. Verify the cycle advances past the plan gate

**Key Files:**
- `packages/architect/src/callback-signer.ts` — HMAC-SHA256 sign/verify
- `packages/architect/src/notifier.ts` — formats messages with callback URLs
- `packages/core/src/api/routes/architect-callbacks.ts` — POST/GET handlers
- Fastify `maxParamLength: 500` needed for base64url tokens (~136 chars)

---

## Stage 2: v1.6.0 — Mission Control + Fleet View

**Priority:** HIGH — the natural next feature.

### 2A. Agent State Table

**Goal:** Track all running agents (architect, daemon hands, pipeline runs) in a unified `agent_states` table.

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS agent_states (
  id          TEXT PRIMARY KEY,
  agent_type  TEXT NOT NULL,    -- 'architect' | 'hand' | 'pipeline' | 'swarm'
  agent_id    TEXT NOT NULL,
  status      TEXT NOT NULL,    -- 'running' | 'idle' | 'error' | 'stopped'
  last_tick   INTEGER,
  metadata    TEXT,             -- JSON: model, memory usage, etc.
  started_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

**Files to Create/Modify:**
- `packages/core/src/agent-state/store.ts` — AgentStateStore CRUD
- `packages/core/src/api/routes/agent-state.ts` — GET /api/admin/agent-states
- `packages/architect/src/daemon.ts` — emit heartbeat on each tick
- `packages/daemon/src/index.ts` — emit heartbeat on each hand run

### 2B. Mission Control Dashboard Page

**Goal:** A new "Mission Control" page showing all running agents, their status, resource usage, and health.

**Design:**
- Fleet overview: grid of agent cards with status indicators
- Each card shows: agent type, status, last tick time, model in use
- Click to expand → recent events, memory usage, error log
- Kill button for stuck agents

**Files to Create:**
- `packages/web/src/pages/MissionControl.tsx` — main page (lazy-loaded)
- `packages/web/src/pages/mission-control/AgentCard.tsx`
- `packages/web/src/pages/mission-control/FleetGrid.tsx`
- Add to `NavBar.tsx` NavPage union and NAV_ITEMS array
- Add lazy import to `App.tsx`

### 2C. First-Run Wizard Enhancement

**Goal:** Add notification channel selection to the first-run wizard.

Currently the wizard only sets the architect mode. Extend it to:
1. Mode selection (existing)
2. Notification channel setup (Telegram/Discord/Slack — optional)
3. Confirmation screen

**File:** `packages/web/src/pages/architect/FirstRunWizard.tsx`

---

## Stage 3: v1.7.0 — Architect Intelligence

**Priority:** MEDIUM — makes the architect smarter.

### 3A. Learning from Merged PRs

**Goal:** After a PR is merged, analyze what worked and store the pattern for future planning.

**Approach:**
- On `pr_merged` event, extract: what kind of change, which files, what model worked, how many iterations
- Store in a `learnings` table: `{ pattern, confidence, usageCount, lastUsedAt }`
- Feed top-5 relevant learnings into the planning prompt as context

### 3B. Smarter Curriculum Signals

**Goal:** Expand beyond TODO/FIXME and churn hotspots.

**New signals:**
- **Dependency staleness**: `pnpm outdated` output → "Update X from v1 to v2"
- **Test coverage gaps**: Run coverage, find files with 0% → "Add tests for X"
- **Bundle size regressions**: Compare build output sizes over time
- **Security advisories**: `pnpm audit` → "Fix vulnerability in X"

**Files:**
- `packages/architect/src/curriculum/signals.ts` — add new harvesters
- `packages/architect/src/index.ts` — wire new signals into `harvestSignals()`

### 3C. Multi-Model Planning

**Goal:** Try planning with multiple models and pick the best result.

**Approach:**
1. Send the same planning prompt to 2-3 models in parallel
2. Score each plan: diff size vs budget, file count, readability
3. Pick the highest-scoring plan
4. Fall back to single-model if parallel fails

---

## Stage 4: v2.0.0 — Platform Features

**Priority:** LOW — major version, needs design work.

### 4A. Plugin Marketplace

**Goal:** A local marketplace for sharing skill packs, agent configs, and tool definitions.

- Browse published packs (local filesystem, no cloud)
- One-click install/uninstall
- Version management
- Pack format: zip with manifest.json + skills/ + agents/ + tools/

### 4B. Multi-Machine Federation

**Goal:** Run Coastal.AI on multiple machines and have them collaborate.

- Agent discovery across machines on the same network
- Cross-machine task routing (send heavy tasks to the GPU machine)
- Shared model registry

### 4C. Mobile App

**Goal:** React Native app that connects to a running Coastal.AI server.

- Chat interface
- Architect status + approval
- Push notifications for approval gates

---

## Codebase Conventions

### File Organization
- **Many small files > few large files** (200-400 lines typical, 800 max)
- Organize by feature/domain, not by type
- Sub-component directories: `pages/architect/`, `pages/chat/`

### Imports
- Cross-package: `import { X } from '@coastal-ai/core/architect/types'`
- Intra-package: `import { X } from './types.js'` (always `.js` extension)

### Testing
- Vitest for all packages
- DI pattern: all I/O injected as closures for testability
- Test files: `__tests__/*.test.ts` adjacent to source
- Architect tests exit 3221225477 on Windows (cosmetic native crash on teardown — tests pass before it)

### State Management (Web)
- No React Router — `page` state in App.tsx with manual `NavPage` union
- All non-Chat pages lazy-loaded via `React.lazy` + `Suspense`
- Chat always mounted (`display: none/block`) for session persistence
- SSE via shared singleton (`useArchitectSSE` hook)
- localStorage for persistent UI state (bg picker, wizard completion)

### API Patterns
- All admin routes under `/api/admin/*` (global auth hook in server.ts)
- Zod validation on request bodies
- Rate limiting via `@fastify/rate-limit` config per-route
- SSE endpoint with max 10 concurrent connections

### Security
- HMAC-SHA256 signed callback tokens with expiry
- Input validation: all numeric query params clamped to safe ranges
- No hardcoded secrets — all via env vars
- `isLockedPath()` prevents architect from modifying protected files

### Architect Domain Model
```
WorkItem (pending → active → awaiting_human → merged/cancelled/error)
    ↳ Cycle (planning → building → pr_review → done/cancelled)
        ↳ Approval (gate + decision + comment)
        ↳ Snapshot (shadow-git state capture)
    ↳ Event (SSE-streamed to web UI)
```

### Key Environment Variables
```bash
CC_OLLAMA_URL=http://127.0.0.1:11434    # Ollama endpoint
CC_ARCHITECT_MODEL=llama3.2              # Default model for planning
CC_ARCHITECT_INTERVAL_MS=60000           # Tick interval (default 60s)
CC_ARCHITECT_LEGACY=1                    # Use old skill-gaps loop (not recommended)
CC_ARCHITECT_CURRICULUM=1                # Enable curriculum scanning
CC_ARCHITECT_MIN_TIER=low               # Minimum model tier (low/medium/high)
CC_CURRICULUM_DAILY_BUDGET=1             # Max curriculum proposals per day
CC_TRUST_LEVEL=sandboxed                # sandboxed | autonomous (enables voice)
CC_DATA_DIR=./data                       # Data directory
CC_SERVER_URL=http://localhost:4747      # Core server URL
CC_ADMIN_TOKEN=                          # Admin auth token (or read from .admin-token file)
```

---

## Test Counts (as of v1.5.0 + session 5)

| Package | Files | Tests | Status |
|---------|-------|-------|--------|
| core | 66 (+1 skip) | 326 (+7 skip) | All green |
| architect | 31 | ~133 | All green (exit 3221225477 cosmetic) |
| daemon | 7 | 28 | All green |
| **Total** | **104** | **~487** | **All green** |

---

## Quick Reference: Key Files

| Purpose | File |
|---------|------|
| Core server entry | `packages/core/src/server.ts` |
| Architect daemon entry | `packages/architect/src/index.ts` |
| Architect daemon class | `packages/architect/src/daemon.ts` |
| Stage runner orchestrator | `packages/architect/src/stage-runner.ts` |
| Planning stage | `packages/architect/src/stages/planning.ts` |
| Building stage | `packages/architect/src/stages/building.ts` |
| PR creation | `packages/architect/src/stages/pr-creation.ts` |
| PR polling | `packages/architect/src/stages/pr-review.ts` |
| Work item store | `packages/core/src/architect/store.ts` |
| Cycle store | `packages/core/src/architect/cycle-store.ts` |
| DB schema | `packages/core/src/architect/db.ts` |
| Architect types | `packages/core/src/architect/types.ts` |
| Callback signer | `packages/architect/src/callback-signer.ts` |
| SSE endpoint | `packages/core/src/api/routes/architect-events-sse.ts` |
| Web: Architect page | `packages/web/src/pages/Architect.tsx` |
| Web: Chat page | `packages/web/src/pages/Chat.tsx` |
| Web: App router | `packages/web/src/App.tsx` |
| Web: API client | `packages/web/src/api/client.ts` |
| Web: SSE hook | `packages/web/src/hooks/useArchitectSSE.ts` |
| NavBar + pages union | `packages/web/src/components/NavBar.tsx` |
| Config + locked paths | `packages/architect/src/config.ts` |
| Curriculum scanner | `packages/architect/src/curriculum/scanner.ts` |
| Snapshot manager | `packages/architect/src/snapshots.ts` |
| Event log | `packages/architect/src/event-log.ts` |
| CHANGELOG | `CHANGELOG.md` |

# Coastal.AI Standalone Desktop App (Tauri) — Design

- **Status:** Approved 2026-06-11
- **Author:** brainstormed with operator (bigmoneymazz)
- **Supersedes:** the Electron `packages/shell` as the desktop delivery vehicle (kept runnable until Tauri reaches parity, then deleted)

## Goal & Success Criteria

A user double-clicks an installer on **Windows / macOS / Linux**, the app launches, the
React UI loads, and a **bundled Node `core` sidecar runs with working SQLite** — with
**no Node/pnpm prerequisite on the user's machine**. The only external dependency is an
LLM backend (Ollama), guided by the in-app install wizard.

"Done" for the whole effort:

1. Installers exist for Windows (nsis/msi), macOS (dmg, x64 + arm64), and Linux (AppImage/deb).
2. Each launches a self-contained app with the Node backend embedded as a sidecar.
3. No `node`/`pnpm` on PATH is required.
4. Auto-update works from GitHub releases.

## Locked Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Shell framework | **Tauri v2** (replacing Electron) | Cross-platform goal; smaller binaries; aligns with the Rust inference path; `phodal/routa` (MIT) proves the pattern for the same lane-based multi-agent job. |
| Standalone level | **Fully standalone** | True consumer app. Only Ollama remains external. |
| Node sidecar bundling | ~~Node SEA~~ → **Folder-bundle** (REVERSED 2026-06-11, Phase-1 spike) | SEA cannot embed core's native-addon surface (`better-sqlite3`, `onnxruntime-node`, `nodejs-polars`, `bufferutil`/`utf-8-validate`) or puppeteer's Chromium. Ship `node` + `dist/` + production `node_modules` as Tauri resources and spawn `node dist/main.js`. Robust; larger install. |
| Migration sequencing | **Parallel, then cut over** | New `packages/desktop` alongside the working Electron `shell`; delete `shell` only after parity. Safe, reversible. |
| Notes-substrate replication | Out of this spec — **syncthing sidecar** (own spec, after this) | Decided in the same session; tracked separately. |

## Architecture

```
┌─ packages/desktop (Tauri v2, Rust shell) ───────────────────┐
│  • spawns sidecar, owns window / tray / updater             │
│  ┌─ coastal-core-<target-triple>  (Node SEA binary) ──────┐ │
│  │   the entire Node/Fastify backend + better-sqlite3      │ │
│  │   listens on 127.0.0.1:<free-port>                      │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌─ embedded web dist (unchanged React/Vite) ─────────────┐ │
│  │   talks to sidecar via /api + /ws (exactly as today)    │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

Tauri replaces Electron as the *window + spawner + updater*. The Node backend and the
React UI survive essentially untouched. The webview reaches the sidecar over
`127.0.0.1:<port>` (`/api` GraphQL + `/ws`), the same transport the Vite proxy uses today.

### Why a sidecar (not in-process)

`core` is a Node/Fastify server with **multiple native C++ addons** (`better-sqlite3`,
`onnxruntime-node`, `nodejs-polars`, `bufferutil`/`utf-8-validate`) and puppeteer
browser tooling. Tauri's backend is Rust and cannot host Node in-process the way Electron
does. The only viable path is to ship `core` as an external process that Tauri spawns.
This is the single largest engineering risk in the spec and was de-risked first (Phase 1).

**Phase 1 outcome (2026-06-11):** the spike rejected single-binary Node SEA bundling
because the native-addon + puppeteer surface above cannot be embedded. Adopted the
**folder-bundle** strategy instead: Tauri ships a `node` runtime + the built `dist/` +
production `node_modules` as bundled resources and spawns `node dist/main.js`. The
`CC_SIDECAR_READY <port>` startup contract is unchanged.

## Components (small, single-purpose units)

### `packages/desktop/src-tauri/` (Rust)
- `main.rs` — Tauri bootstrap; frameless window (matches current Electron look: `frame:false`, hidden titlebar, `#050d1a` background); lifecycle wiring.
- `sidecar.rs` — pick a free port; start the `coastal-core` sidecar; health-check (`READY <port>` on stdout); **guaranteed kill-on-exit so no zombie `core` process survives the app**; restart-on-crash policy.
- `commands.rs` — `#[tauri::command]` handlers replacing the Electron installer IPC: check Ollama, pull-model with progress events, open external URL.
- `tauri.conf.json` — `externalBin` (the sidecar), `resources` (the prebuilt `.node`), bundle targets, updater config, `frontendDist` pointing at the built `web`.

### `packages/core/` additions
- `bundle:sidecar` script: produce a self-contained `node` + `dist/` + production
  `node_modules` folder (via `pnpm deploy --prod`), plus a copy of the `node` runtime
  named `coastal-core-<target-triple>`. Tauri ships the folder as resources and spawns
  the node runtime against `dist/main.js`. (No esbuild/SEA — see Phase 1 outcome.)
- Startup contract: accept `--port` / `PORT`; choose `127.0.0.1`; print `READY <port>`
  on stdout once Fastify is listening, so Tauri loads the UI only when the backend is up.

### `packages/web/` additions
- `src/platform/bridge.ts` — a `PlatformBridge` interface (window controls, installer
  ops, update events, platform name) with **three runtime-detected implementations**:
  `tauri.ts` (`@tauri-apps/api`), `electron.ts` (legacy `window.coastalShell`),
  `browser.ts` (no-ops / hidden window chrome). This removes the direct
  `window.coastalShell` coupling the UI has today.
- Installer wizard simplified: drop the `node`/`pnpm` checks (now bundled); keep the
  Ollama check + model pull, routed through the bridge → Tauri commands.

### Updater
Tauri updater plugin. minisign keypair: public key in `tauri.conf.json`, private key a
CI secret. Updates published to GitHub releases (reuse `CoastalCrypto/CoastalClaw_IO` or
a new repo). Replaces `electron-updater`.

### CI
`.github/workflows/desktop-release.yml` — matrix `{windows, macos-x64, macos-arm64,
ubuntu}`. Each runner builds the core sidecar **on its own OS** (native `better-sqlite3`
cannot be cross-compiled), then `tauri-action` builds, signs, and drafts the release.

## Data Flow

Launch → Tauri spawns `coastal-core` (SQLite under the OS app-data dir) → waits for
`READY <port>` on stdout → opens the window and loads the embedded UI → UI calls
`127.0.0.1:<port>/api` + `/ws` → on quit, Tauri kills the sidecar.

## Error Handling (never silent — per project rules)

- Sidecar crash / fails to start → native error screen with "view logs" + relaunch;
  logs written to `app-data/logs`.
- Port in use → sidecar picks the next free port; Tauri reads the chosen port from
  stdout. The port is never hardcoded.
- Ollama missing → actionable wizard message (install link); the app still launches in a
  degraded state (matches the existing engine-agnostic philosophy).
- Update check failure → non-fatal, logged, retried later.

## Phases (each independently shippable / testable)

1. **Spike — go/no-go (Windows only).** esbuild + SEA the core into a sidecar that runs a
   *real `better-sqlite3` query*; a Tauri window spawns it; one UI page loads against it.
   **Fallback trigger:** if SEA cannot carry the native addon cleanly, switch to the
   "ship `node` + `dist` folder" strategy before any further phase. This phase exists to
   kill the #1 risk first.
2. **Shell parity.** Frameless window + controls via `PlatformBridge`, tray, port
   handoff, clean sidecar lifecycle (no zombies), graceful error screen.
3. **Installer wizard rework.** Ollama checks/model-pull as Tauri commands; remove
   node/pnpm checks.
4. **Cross-platform + CI.** macOS x64, macOS arm64, Linux; GitHub Actions matrix;
   installers for all three OSes.
5. **Updater + retire Electron `shell`.** Tauri updater plugin + signing + release
   pipeline; delete `packages/shell`.

## Testing Strategy

- **Rust:** unit tests for free-port selection and sidecar lifecycle (start → ready →
  kill, zombie reclaim).
- **Core:** a "bundle smoke" test — run the built sidecar binary, hit `/api/version` and
  one SQLite-backed endpoint, assert HTTP 200.
- **Web:** `PlatformBridge` unit tests with mocked tauri / electron / browser
  implementations; the existing vitest suite is unchanged.
- **E2E:** a manual gate per phase (scripted where feasible); Phase 1's gate is the
  go/no-go.

## Out of Scope (YAGNI / flagged follow-ups)

- Rewriting `core` in Rust.
- Mobile (iOS/Android Tauri).
- **Code-signing certificates** (macOS notarization, Windows Authenticode) — needed for
  warning-free distribution, but **not** for the build to function. Ship self-signed /
  unsigned first; real certs are a distinct follow-up.
- Notes-substrate replication via syncthing — its own spec, after this one.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| SEA can't bundle `better-sqlite3` cleanly | Medium | Phase 1 spike; documented fallback to folder-bundle strategy. |
| Native addon per-OS build friction | High (expected) | CI matrix builds each sidecar on its own OS from the start. |
| Sidecar zombie processes on crash/quit | Medium | `sidecar.rs` owns guaranteed kill-on-exit + tested lifecycle. |
| Updater signing key handling | Low | minisign keypair; private key as CI secret only. |

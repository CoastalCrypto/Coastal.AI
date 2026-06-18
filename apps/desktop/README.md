# @coastal-ai/desktop

The standalone, cross-platform desktop app — a **Tauri v2** shell that runs the
Node `core` backend as a bundled **sidecar** and serves the real `web` UI. One
double-click; no Node/pnpm required on the user's machine.

```
┌─ coastal-desktop (Tauri v2 / Rust) ─────────────────────────────┐
│  • picks a free port, spawns the sidecar, owns the window        │
│                                                                  │
│  ┌─ coastal-core-<triple>  (renamed node runtime) ────────────┐ │
│  │   node dist/main.js   →   Fastify on 127.0.0.1:<freePort>  │ │
│  │   (flat node_modules: better-sqlite3, onnxruntime, …)      │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌─ web build (embedded frontendDist) ───────────────────────┐ │
│  │   React UI → talks to the sidecar via coreOrigin()        │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

## How it fits together

- **Startup contract:** the shell starts `core` with `CC_PORT=0` (OS-assigned
  free port) and waits for the line `CC_SIDECAR_READY <port>` on the sidecar's
  stdout before opening the window. See `core/src/main.ts`.
- **Dynamic port → UI:** the window loads `index.html?corePort=<port>`. The web
  app resolves the backend origin through `web/src/platform/coreOrigin.ts`
  (`window.__COASTAL_CORE_PORT__` / `?corePort=` / `VITE_CORE_PORT` / `:4747`),
  so every HTTP/Apollo/SSE/WebSocket call hits the right port.
- **CORS:** the webview origin (`http://tauri.localhost`) is cross-origin to the
  sidecar, so the supervisor passes `CC_CORS_ORIGINS` when spawning core.
- **Lifecycle:** the sidecar `Child` is killed on `RunEvent::Exit` — no zombie
  `core` process after the window closes.

## Dev

```bash
pnpm --filter @coastal-ai/core build          # build core's dist
pnpm --filter @coastal-ai/core bundle:sidecar # flat npm bundle + node runtime
pnpm --filter @coastal-ai/desktop dev         # presync + tauri dev
```

`dev` runs `presync` (stages the sidecar runtime + flat `app/` into
`src-tauri/{binaries,resources}`) then `tauri dev`. In dev the supervisor falls
back to `../../../packages/core/sidecar-build/app` if bundled resources aren't present.

## Verify the webview CSP

```bash
pnpm --filter @coastal-ai/desktop verify:csp
```

Serves the built `web` bundle with the configured Content-Security-Policy
(`src-tauri/tauri.conf.json` → `app.security.csp`) in headless Chromium and fails
on any violation. Re-run after adding any external dependency (fonts, CDNs, etc.).

**Version** lives in `src-tauri/tauri.conf.json` (`version`) — the single source
of truth Tauri builds from. Cut a release by tagging `desktop-v<version>`.

## Build an installer

```bash
pnpm --filter @coastal-ai/core build
pnpm --filter @coastal-ai/core bundle:sidecar
pnpm --filter @coastal-ai/desktop build       # presync + tauri build (NSIS/dmg/AppImage)
```

Cross-platform installers are produced by `.github/workflows/release-desktop-app.yml`
on a `desktop-v*` tag — a `{windows, macos-x64, macos-arm64, ubuntu}` matrix that
builds the sidecar on each OS (native addons can't be cross-compiled).

## Why the sidecar is bundled this way (hard-won)

`core` pulls in heavy **native addons** (`better-sqlite3`, `onnxruntime-node`,
`nodejs-polars`) and **Playwright**. The bundling strategy was chosen by
elimination during the Phase-1 spike:

| Tried | Why it failed |
|---|---|
| **Node SEA** (single binary) | Can't embed the native-addon surface or Playwright. |
| **pnpm deploy** | Its `.pnpm` tree uses Windows **junctions**, incl. a workspace self-reference that an unguarded recursive copy follows forever (filled a 931 GB disk). Dereferencing the junctions also breaks transitive module resolution (e.g. `zod-to-json-schema`). |
| **flat `npm install` ✅** | `npm install --omit=dev --legacy-peer-deps` in a standalone app dir → flat, junction-free, portable `node_modules`. |

`bundle-sidecar.mjs` assembles `dist/` + a trimmed `package.json`, runs that npm
install, and copies the `node` runtime to `coastal-core-<triple>`.

## Gotchas

- **`\\?\` path prefix:** Tauri's `resource_dir()` returns Windows
  extended-length paths (`\\?\C:\...`). Node mis-resolves those as an entry
  script (`lstat 'C:'`) and crashes — `sidecar.rs::clean_path` strips the prefix.
- **`--no-frozen-lockfile` in CI:** `packages/daemon` has an optional native dep
  (`node-portaudio`) that doesn't resolve into the lockfile; a frozen install
  hard-fails. The desktop build doesn't use it.
- **Window chrome:** currently OS-decorated. The web `TitleBar` only renders
  under Electron, so there's no double bar. A Tauri-backed `coastalShell` shim
  for a custom frameless title bar is a follow-up.

## Icon

`src-tauri/icons/icon-source-1024.png` is the canonical source. Regenerate the
set with `pnpm exec tauri icon src-tauri/icons/icon-source-1024.png`.

## Follow-ups

- `coastalShell` shim (frameless window controls), graceful sidecar-crash screen, tray.
- Code-signing (macOS notarization / Windows Authenticode) for warning-free installs.
- The manual gate before a release: install on a machine with **no Node/pnpm** and confirm launch.

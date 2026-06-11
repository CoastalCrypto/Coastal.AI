# Desktop Tauri — Phase 1 Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a single `coastal-core` Node SEA executable can run the Fastify backend with a real `better-sqlite3` query, and that a Tauri v2 window can spawn it as a sidecar and load real data from it — on Windows.

**Architecture:** Bundle `packages/core` with esbuild into one CJS file, inject it into the Node 22 binary via Node SEA to produce `coastal-core-<triple>`, shipping `better-sqlite3`'s native `.node` alongside. A new `packages/desktop` Tauri app picks a free port, spawns the sidecar, waits for a `CC_SIDECAR_READY <port>` stdout signal, then loads a page that fetches `/api/version` from the sidecar.

**Tech Stack:** Tauri v2 (Rust), Node 22 SEA, esbuild, postject, better-sqlite3, Fastify.

**Spec:** `docs/superpowers/specs/2026-06-11-coastal-desktop-tauri-design.md` (Phase 1).

**Two internal gates:**
- **Gate A** — the SEA sidecar binary runs standalone and serves a SQLite-backed endpoint.
- **Gate B** — Tauri spawns that sidecar and renders real data from it.

**Fallback rule (from spec):** If, after Task 3, the SEA binary cannot load `better-sqlite3` cleanly, STOP and switch to the "ship `node` + `dist` folder" bundling strategy before continuing. Record the outcome either way.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/main.ts` (modify) | Add `CC_PORT=0` support + print `CC_SIDECAR_READY <port>` after listen. |
| `packages/core/src/main.startup.test.ts` (create) | Test the startup contract. |
| `packages/core/scripts/bundle-sidecar.mjs` (create) | esbuild → CJS, then SEA blob → inject → `coastal-core-<triple>`, copy native `.node`. |
| `packages/core/sea-config.json` (create) | Node SEA config. |
| `packages/core/scripts/sidecar-smoke.test.mjs` (create) | Gate A: run the built binary, assert SQLite-backed endpoint returns 200. |
| `packages/desktop/` (create) | Tauri v2 app: `src-tauri/{main.rs,sidecar.rs,tauri.conf.json,Cargo.toml}`, minimal `index.html`. |

---

## Task 1: Sidecar startup contract in core

**Files:**
- Modify: `packages/core/src/main.ts:26-29`
- Test: `packages/core/src/main.startup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/main.startup.test.ts
import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

describe('core sidecar startup contract', () => {
  it('binds an OS-assigned port with CC_PORT=0 and prints CC_SIDECAR_READY <port>', async () => {
    const main = resolve(__dirname, '..', 'dist', 'main.js')
    const proc = spawn(process.execPath, [main], {
      env: { ...process.env, CC_PORT: '0', CC_HOST: '127.0.0.1' },
    })
    const port: number = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('no READY in 20s')), 20_000)
      proc.stdout.on('data', (b: Buffer) => {
        const m = b.toString().match(/CC_SIDECAR_READY (\d+)/)
        if (m) { clearTimeout(t); res(Number(m[1])) }
      })
      proc.stderr.on('data', (b: Buffer) => process.stderr.write(b))
    })
    expect(port).toBeGreaterThan(0)
    const r = await fetch(`http://127.0.0.1:${port}/api/version`)
    expect(r.status).toBe(200)
    proc.kill()
  }, 30_000)
})
```

- [ ] **Step 2: Build core, then run the test to verify it fails**

Run: `pnpm --filter @coastal-ai/core build && pnpm --filter @coastal-ai/core test -- main.startup`
Expected: FAIL — current `main.ts` prints `core running on ...` (no `CC_SIDECAR_READY`), and with `CC_PORT=0` logs port `0`.

- [ ] **Step 3: Implement the contract in main.ts**

Replace the listen block (currently lines 26-29) with:

```ts
const config = loadConfig()
const server = await buildServer()

await server.listen({ port: config.port, host: config.host })

// Resolve the actually-bound port (config.port may be 0 = OS-assigned).
const addr = server.server.address()
const boundPort = typeof addr === 'object' && addr ? addr.port : config.port
// Parseable readiness marker for the Tauri sidecar supervisor.
console.log(`CC_SIDECAR_READY ${boundPort}`)
console.log(`[coastal-ai] core running on ${config.host}:${boundPort}`)
```

Confirm `config.ts` already allows `CC_PORT=0`: the validator rejects `< 1`. Change `packages/core/src/config.ts:44` guard from `parsed < 1` to `parsed < 0` so `0` (OS-assigned) is valid:

```ts
if (isNaN(parsed) || parsed < 0 || parsed > 65535) {
```

- [ ] **Step 4: Rebuild and run the test to verify it passes**

Run: `pnpm --filter @coastal-ai/core build && pnpm --filter @coastal-ai/core test -- main.startup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/main.ts packages/core/src/config.ts packages/core/src/main.startup.test.ts
git commit -m "feat(core): add CC_PORT=0 + CC_SIDECAR_READY startup contract for sidecar use"
git push
```

---

## Task 2: esbuild bundle of core to a single CJS file

**Files:**
- Create: `packages/core/scripts/bundle-sidecar.mjs`
- Modify: `packages/core/package.json` (add `esbuild` devDep + `bundle:cjs` script)

- [ ] **Step 1: Add esbuild and the bundle script entry**

Run:
```bash
pnpm --filter @coastal-ai/core add -D esbuild postject
```

Add to `packages/core/package.json` scripts:
```json
"bundle:cjs": "node scripts/bundle-sidecar.mjs cjs",
"bundle:sidecar": "node scripts/bundle-sidecar.mjs all"
```

- [ ] **Step 2: Write the esbuild portion of the bundler script**

```js
// packages/core/scripts/bundle-sidecar.mjs
import { build } from 'esbuild'
import { mkdirSync, cpSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'sidecar-build')
mkdirSync(outDir, { recursive: true })

// Native addons cannot be bundled — keep external, ship alongside.
const NATIVE_EXTERNAL = ['better-sqlite3', 'bufferutil', 'utf-8-validate', 'ts-node']

async function bundleCjs() {
  await build({
    entryPoints: [resolve(root, 'src', 'main.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: resolve(outDir, 'core.cjs'),
    external: NATIVE_EXTERNAL,
    banner: { js: 'globalThis.require = require;' },
    logLevel: 'info',
  })
  // Ship the better-sqlite3 package (with its prebuilt .node) next to the binary.
  const bsqlSrc = resolve(root, 'node_modules', 'better-sqlite3')
  if (!existsSync(bsqlSrc)) throw new Error('better-sqlite3 not installed')
  cpSync(bsqlSrc, resolve(outDir, 'node_modules', 'better-sqlite3'), { recursive: true })
  console.log('[bundle] core.cjs + better-sqlite3 staged in', outDir)
}

const mode = process.argv[2] ?? 'cjs'
if (mode === 'cjs' || mode === 'all') await bundleCjs()
```

- [ ] **Step 3: Run the bundler and verify output exists**

Run: `pnpm --filter @coastal-ai/core build && pnpm --filter @coastal-ai/core bundle:cjs`
Expected: `packages/core/sidecar-build/core.cjs` exists and `sidecar-build/node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists.

- [ ] **Step 4: Smoke-run the CJS bundle directly with plain node**

Run: `cd packages/core/sidecar-build && CC_PORT=0 node core.cjs`
Expected: prints `CC_SIDECAR_READY <port>`. Ctrl-C to stop. (This validates the bundle before SEA injection — if better-sqlite3 fails to resolve here, fix module resolution before Task 3.)

- [ ] **Step 5: Add `sidecar-build/` to gitignore and commit**

```bash
echo "packages/core/sidecar-build/" >> .gitignore
git add packages/core/scripts/bundle-sidecar.mjs packages/core/package.json pnpm-lock.yaml .gitignore
git commit -m "feat(core): esbuild bundler staging core.cjs + native better-sqlite3 for sidecar"
git push
```

---

## Task 3: Node SEA injection → `coastal-core` binary (RISK GATE)

**Files:**
- Create: `packages/core/sea-config.json`
- Modify: `packages/core/scripts/bundle-sidecar.mjs` (add `sea` mode)

- [ ] **Step 1: Write the SEA config**

```json
// packages/core/sea-config.json
{
  "main": "sidecar-build/core.cjs",
  "output": "sidecar-build/sea-blob.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": false
}
```

- [ ] **Step 2: Add the SEA build steps to the bundler script**

Append to `bundle-sidecar.mjs`:

```js
import { execFileSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'

function targetTriple() {
  const a = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'win32') return `${a}-pc-windows-msvc`
  if (process.platform === 'darwin') return `${a}-apple-darwin`
  return `${a}-unknown-linux-gnu`
}

function buildSea() {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const binName = `coastal-core-${targetTriple()}${ext}`
  const binPath = resolve(outDir, binName)
  // 1. Generate the SEA blob from core.cjs.
  execFileSync(process.execPath, ['--experimental-sea-config', resolve(root, 'sea-config.json')], { stdio: 'inherit', cwd: root })
  // 2. Copy the running node binary to the target name.
  copyFileSync(process.execPath, binPath)
  // 3. Inject the blob with postject.
  execFileSync('npx', ['postject', binPath, 'NODE_SEA_BLOB', resolve(outDir, 'sea-blob.blob'),
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { stdio: 'inherit', shell: process.platform === 'win32' })
  console.log('[bundle] built', binPath)
}

if (mode === 'sea' || mode === 'all') buildSea()
```

- [ ] **Step 3: Build the SEA binary**

Run: `pnpm --filter @coastal-ai/core bundle:sidecar`
Expected: `packages/core/sidecar-build/coastal-core-x86_64-pc-windows-msvc.exe` exists.

- [ ] **Step 4: Run the binary directly — THE RISK GATE**

Run: `cd packages/core/sidecar-build && CC_PORT=0 ./coastal-core-x86_64-pc-windows-msvc.exe`
Expected: prints `CC_SIDECAR_READY <port>`.

**If `better-sqlite3` fails to load here** (e.g. cannot find `better_sqlite3.node`): the SEA-relative `require` is the problem. Try, in order: (a) prepend the sidecar `node_modules` to resolution via `globalThis.require` hook in `core.cjs` banner that sets `process.env.NODE_PATH` + `Module._initPaths()`; (b) load better-sqlite3 by absolute path derived from `process.execPath`. **If neither works within this task, STOP and invoke the spec's fallback** (ship `node` + folder), then revise Task 4-6 accordingly.

- [ ] **Step 5: Commit the SEA build path**

```bash
git add packages/core/sea-config.json packages/core/scripts/bundle-sidecar.mjs
git commit -m "feat(core): Node SEA injection producing coastal-core-<triple> sidecar binary"
git push
```

---

## Task 4: Gate A — sidecar smoke test

**Files:**
- Create: `packages/core/scripts/sidecar-smoke.test.mjs`

- [ ] **Step 1: Write the smoke test (runs the built binary)**

```js
// packages/core/scripts/sidecar-smoke.test.mjs
import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { readdirSync } from 'node:fs'

const dir = resolve(import.meta.dirname, '..', 'sidecar-build')
const bin = readdirSync(dir).find((f) => f.startsWith('coastal-core-'))

describe('Gate A: coastal-core SEA sidecar', () => {
  it('serves /api/version (SQLite-backed stack up) on an OS-assigned port', async () => {
    expect(bin, 'run `pnpm bundle:sidecar` first').toBeTruthy()
    const proc = spawn(resolve(dir, bin), [], { env: { ...process.env, CC_PORT: '0' } })
    const port = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('no READY')), 20_000)
      proc.stdout.on('data', (b) => {
        const m = b.toString().match(/CC_SIDECAR_READY (\d+)/)
        if (m) { clearTimeout(t); res(Number(m[1])) }
      })
    })
    const r = await fetch(`http://127.0.0.1:${port}/api/version`)
    expect(r.status).toBe(200)
    proc.kill()
  }, 30_000)
})
```

- [ ] **Step 2: Run Gate A**

Run: `pnpm --filter @coastal-ai/core exec vitest run scripts/sidecar-smoke.test.mjs`
Expected: PASS. **This is the go/no-go for SEA. Green = proceed to Tauri.**

- [ ] **Step 3: Commit**

```bash
git add packages/core/scripts/sidecar-smoke.test.mjs
git commit -m "test(core): Gate A smoke test for coastal-core SEA sidecar"
git push
```

---

## Task 5: Scaffold the Tauri desktop package

**Files:**
- Create: `packages/desktop/src-tauri/{Cargo.toml,tauri.conf.json,build.rs}`, `packages/desktop/src-tauri/src/main.rs`, `packages/desktop/index.html`, `packages/desktop/package.json`

- [ ] **Step 1: Init Tauri v2 (manual scaffold to fit the monorepo)**

Create `packages/desktop/package.json`:
```json
{
  "name": "@coastal-ai/desktop",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build"
  },
  "devDependencies": { "@tauri-apps/cli": "^2.0.0" }
}
```

Run: `pnpm --filter @coastal-ai/desktop add -D @tauri-apps/cli@^2`

- [ ] **Step 2: Create minimal frontend `packages/desktop/index.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8" /><title>Coastal.AI (spike)</title></head>
<body style="background:#050d1a;color:#cde;font-family:system-ui">
  <h1>Coastal.AI desktop spike</h1>
  <pre id="out">contacting core…</pre>
  <script>
    const port = new URLSearchParams(location.search).get('corePort')
    fetch(`http://127.0.0.1:${port}/api/version`)
      .then(r => r.json())
      .then(v => document.getElementById('out').textContent = 'core /api/version → ' + JSON.stringify(v))
      .catch(e => document.getElementById('out').textContent = 'ERROR: ' + e.message)
  </script>
</body></html>
```

- [ ] **Step 3: Create `tauri.conf.json`** referencing the sidecar as `externalBin`

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "CoastalAI",
  "version": "0.1.0",
  "identifier": "com.coastalcrypto.coastalai",
  "build": { "frontendDist": "../" },
  "app": {
    "windows": [{ "title": "Coastal.AI", "width": 1280, "height": 800, "decorations": false, "backgroundColor": "#050d1a" }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "externalBin": ["binaries/coastal-core"],
    "resources": []
  }
}
```

- [ ] **Step 4: Create `Cargo.toml`** with tauri 2 + tokio

```toml
[package]
name = "coastal-desktop"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tokio = { version = "1", features = ["full"] }
```

Create `build.rs`: `fn main() { tauri_build::build() }`.

- [ ] **Step 5: Stage the sidecar binary where Tauri expects it**

Tauri resolves `externalBin` names as `binaries/coastal-core-<triple><ext>`. Add a `predev`/`prebuild` copy step in `packages/desktop/package.json`:
```json
"presync": "node -e \"const{copyFileSync,mkdirSync,readdirSync}=require('fs');mkdirSync('src-tauri/binaries',{recursive:true});const d='../core/sidecar-build';for(const f of readdirSync(d))if(f.startsWith('coastal-core-'))copyFileSync(d+'/'+f,'src-tauri/binaries/'+f)\""
```
Run it: `pnpm --filter @coastal-ai/desktop presync` and confirm `src-tauri/binaries/coastal-core-<triple>.exe` exists. Also copy `sidecar-build/node_modules/better-sqlite3/...node` into `src-tauri/resources/` and add to `resources` in conf (only if Gate A required the `.node` external).

- [ ] **Step 6: Commit the scaffold**

```bash
echo "packages/desktop/src-tauri/target/" >> .gitignore
echo "packages/desktop/src-tauri/binaries/" >> .gitignore
git add packages/desktop .gitignore pnpm-lock.yaml
git commit -m "feat(desktop): scaffold Tauri v2 package with sidecar externalBin"
git push
```

---

## Task 6: Sidecar supervisor in Rust + Gate B

**Files:**
- Create: `packages/desktop/src-tauri/src/sidecar.rs`
- Create: `packages/desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Write `sidecar.rs` — free port + spawn + READY wait + kill-on-exit**

```rust
// packages/desktop/src-tauri/src/sidecar.rs
use std::net::TcpListener;
use tauri::async_runtime::Receiver;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Ask the OS for a free port by binding :0 and releasing it.
pub fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

/// Spawn the coastal-core sidecar on `port`; resolve once it prints CC_SIDECAR_READY.
pub async fn spawn_core(app: &tauri::AppHandle, port: u16) -> Result<(), String> {
    let (mut rx, _child): (Receiver<CommandEvent>, _) = app
        .shell()
        .sidecar("coastal-core")
        .map_err(|e| e.to_string())?
        .env("CC_PORT", port.to_string())
        .env("CC_HOST", "127.0.0.1")
        .spawn()
        .map_err(|e| e.to_string())?;
    // Tauri kills the child when `_child` is dropped at app exit.
    Box::leak(Box::new(_child));
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stdout(line) = event {
            let s = String::from_utf8_lossy(&line);
            if s.contains(&format!("CC_SIDECAR_READY {port}")) { return Ok(()) }
        }
    }
    Err("core exited before signalling ready".into())
}
```

- [ ] **Step 2: Write `main.rs` — pick port, spawn, load page with `?corePort=`**

```rust
// packages/desktop/src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod sidecar;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let port = sidecar::free_port();
            tauri::async_runtime::block_on(async {
                sidecar::spawn_core(&handle, port).await.expect("core failed to start");
            });
            let url = format!("index.html?corePort={port}");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
                .title("Coastal.AI").inner_size(1280.0, 800.0).decorations(false)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Build the sidecar, sync it, run Tauri dev — GATE B**

Run:
```bash
pnpm --filter @coastal-ai/core build && pnpm --filter @coastal-ai/core bundle:sidecar
pnpm --filter @coastal-ai/desktop presync
pnpm --filter @coastal-ai/desktop dev
```
Expected: a frameless window opens showing `core /api/version → {...}` with the real version payload. **This is Gate B.** Confirm in Task Manager that closing the window leaves **no orphaned `coastal-core` process**.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src-tauri/src/sidecar.rs packages/desktop/src-tauri/src/main.rs
git commit -m "feat(desktop): Rust sidecar supervisor (free-port, spawn, READY wait, kill-on-exit)"
git push
```

---

## Task 7: Produce a Windows installer (proves end-to-end packaging)

- [ ] **Step 1: Build the installer**

Run: `pnpm --filter @coastal-ai/core bundle:sidecar && pnpm --filter @coastal-ai/desktop presync && pnpm --filter @coastal-ai/desktop build`
Expected: an NSIS `.exe` installer under `packages/desktop/src-tauri/target/release/bundle/nsis/`.

- [ ] **Step 2: Install on a clean Windows path with NO node/pnpm on PATH and launch**

Manual gate: install, open `Start Menu → CoastalAI`, confirm the window shows the live `/api/version`. This is the **fully-standalone proof** for Phase 1.

- [ ] **Step 3: Record the spike outcome**

Append a "Phase 1 result" note to `docs/superpowers/specs/2026-06-11-coastal-desktop-tauri-design.md`: which bundling strategy won (SEA vs folder fallback), installer size, and any native-addon resolution fix used. Commit + push.

```bash
git add docs/superpowers/specs/2026-06-11-coastal-desktop-tauri-design.md
git commit -m "docs: record Phase 1 spike outcome (bundling strategy decision)"
git push
```

---

## Roadmap — Phases 2-5 (separate plans, written after the spike resolves bundling)

These are intentionally **not** expanded into tasks here: their exact steps depend on whether SEA or the folder fallback won in Task 3-4, and on the native-addon resolution fix discovered during the spike.

- **Phase 2 — Shell parity:** `PlatformBridge` interface in `packages/web` (tauri/electron/browser impls), frameless window controls via `@tauri-apps/api`, tray, graceful sidecar-crash error screen, restart policy.
- **Phase 3 — Installer wizard rework:** Ollama check + model-pull as Tauri commands; remove node/pnpm checks.
- **Phase 4 — Cross-platform + CI:** macOS x64/arm64 + Linux; GitHub Actions matrix building the sidecar per-OS via `tauri-action`.
- **Phase 5 — Updater + retire Electron:** Tauri updater plugin (minisign keypair), publish to GitHub releases, delete `packages/shell`.

---

## Self-Review Notes

- **Spec coverage:** Phase 1 of the spec is fully covered (Tasks 1-7); Phases 2-5 are explicitly deferred to follow-up plans with rationale (bundling outcome dependency). Syncthing replication is out of this spec by design.
- **Risk gate** (Task 3 Step 4 / Task 4) is a real engineering gate with a defined fallback, not a placeholder.
- **Type/name consistency:** `CC_SIDECAR_READY <port>` marker, `coastal-core-<triple>` binary name, and `?corePort=` query param are used consistently across core, the smoke test, Rust supervisor, and the HTML.

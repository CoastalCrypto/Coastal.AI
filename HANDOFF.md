# Coastal.AI — Handoff & TODO

_Living checklist. Tackled top-to-bottom. `[operator]` = needs you (hardware,
secrets, cost, manual test); everything else the agent can do._

## State (2026-06-18)

- **Two products, one engine** — the repo is now organized as two products over the
  shared `packages/` engine (see [`PRODUCTS.md`](PRODUCTS.md)):
  - **`apps/desktop`** — the Tauri desktop app (flat-npm sidecar bundle, dynamic port,
    kill-on-exit, Coastal AI / Digital Depths icon, graceful error screen, hardened CSP).
  - **`os/{base,kiosk,node}`** — the Coastal.AI OS (shared base + desktop ISO + BC-250 node).
- **CI is fully green** for the first time since 2026-06-14 (the engine `turbo build` had
  been building the desktop product; fixed by excluding `@coastal-ai/desktop` from `ci.yml`
  + `Dockerfile.smoke`, and skipping the sidecar-smoke gate when unbundled).
- **Pipelines:** `ci.yml` (engine), `release-desktop-app.yml` (tag `desktop-v*`),
  `release-os.yml` (tag `os-v*`), `release.yml` (engine `.deb`/apt).
- Electron `packages/shell` retired (Tauri at parity). AppImage closed out (`.deb` ships).
- Repo is clean: `master` only, no open PRs.
- Docs: `README.md`, `PRODUCTS.md`, `apps/desktop/README.md`, `os/README.md`.

---

## 1. Ship the desktop app (release loop)  ← in progress

- [x] Re-tag `desktop-v0.1.0` → release run builds + publishes installers. CI release machinery debugged through 4 issues: (1) missing `tauri` npm script, (2) `GITHUB_TOKEN` needed `contents: write`, (3) matrix runners raced to create the release → **decoupled** to build-artifacts + a single `publish` job, (4) macOS-Intel (`macos-13`) runners chronically unavailable → **dropped** (ship Windows + Linux + macOS Apple-Silicon; Intel-mac on demand later).
- [x] App icon updated to the **Coastal AI / Digital Depths** badge (operator art).
- [ ] [operator] Download the installer and **install-test on a machine with NO Node/pnpm** — confirm it launches, the UI loads, and (with Ollama) chat works.
- [ ] Publish the draft release once the install-test passes.

## 2. Distribution quality

- [ ] [operator] Acquire signing certs — **Windows Authenticode** + **Apple Developer ID** (cost/procurement).
- [ ] Wire signing into `release-desktop-app.yml` (env secrets) so installers are signed + macOS-notarized (no scary first-run warnings).
- [ ] Add the **Tauri auto-updater**: generate the minisign keypair (private key → CI secret), enable the updater plugin, publish `latest.json` from CI.

## 3. Hardening

- [x] Security pass on the new desktop surface — findings: sidecar is localhost-only/random-port ✅, no Tauri-API capabilities (least-privilege) ✅, error page is HTML-escaped ✅. **Fixed:** tightened CORS to only the real webview origins (dropped broad `http://localhost`).
- [x] Tighten the webview **CSP** — replaced `csp: null` with a least-privilege policy (`default-src 'self'`; scripts self-only; styles + Google Fonts; `connect-src` limited to the sidecar's `127.0.0.1:*` http/ws; `object-src 'none'`). Verified against the real built bundle (three.js, fonts, blob media) with `pnpm --filter @coastal-ai/desktop verify:csp` (Playwright harness, `scripts/verify-csp.mjs`) — zero violations. [operator] Re-run `verify:csp` after any new external dependency, and sanity-check the live app during install-test.
- [ ] [operator] Rotate the Gemini API key shared in chat.
- [ ] [operator] Move the `@21st-dev/magic` MCP key out of the plaintext command-line arg into an env var.

## 4. Desktop polish (deferred Phase 2–5)

- [ ] `coastalShell` window-controls shim → custom frameless title bar (vs current OS chrome).
- [ ] System tray (show/hide/quit).
- [ ] First-run/auth onboarding pass for the desktop app.

## 5. Feature threads (from the repo evaluation)

- [~] **Syncthing** notes-substrate replication — **library complete + verified** (spec `docs/superpowers/specs/2026-06-18-syncthing-replication-design.md`, plan `…/plans/2026-06-18-syncthing-replication.md`): Lamport-rev `NoteStore`, frontmatter codec, exporter/ingester, e2e bridge test, Ed25519-gated Syncthing REST provisioning, per-role bridge driver, `os/base/systemd/coastal-syncthing.service`, `syncthing` in both OS package lists. **Cluster-gated remainder** (needs first-boot cluster-join config + role detection, which don't exist yet): add `syncthingDeviceId` to the peer-registry, schedule `runWorkerTick`/`runCuratorTick` in the daemon by role, wire the Curator `keep` hook to `createCuratorDaemon`, manual 2-container E2E.
- [~] **openobserve** Monitor/Watchdog backend — **library complete + verified** (spec `…/specs/2026-06-19-openobserve-monitor-design.md`, plan `…/plans/2026-06-19-openobserve-monitor.md`): typed `openobserve-client` (ingest/query over injected fetch), pure `evaluateHealth` (heartbeats→alerts), `os/base/systemd/coastal-openobserve.service`. **Cluster-gated remainder**: emit per-node heartbeats, the Monitor query→alert loop, and fetching the openobserve binary into the image (not an apt package). Zombie reclaim already exists in `coordination/transitions/reclaim.ts`.
- [x] **OS light de-dup**: shared systemd units, apt lane, and VERSION now live in `os/base/` and both build scripts consume from there; verified green by `iso-build`. (Superseded by the two-product split, which moved the editions to `os/{base,kiosk,node}` — see `docs/superpowers/plans/2026-06-18-two-product-split.md`.)

## 6. Housekeeping

- [ ] Replace placeholder branding elsewhere if any; keep `icon-source-1024.png` as the canonical icon source.
- [ ] Consider `tesseract`/`sharp` adoption when the Designer(vision)/`video` pipeline is built.

## CI follow-ups

- [ ] Re-enable AppImage Linux target: `linuxdeploy` fails in CI with a swallowed `failed to run linuxdeploy`. **Confirmed (run 27762985002, 2026-06-18): neither `APPIMAGE_EXTRACT_AND_RUN=1` NOR `libfuse2` (both applied together) fixes it** — Tauri discards linuxdeploy's stderr so the root cause is opaque. Note: `appimage` must NOT sit before `deb` in `targets`, since its failure aborts the whole `tauri build` and the `.deb` never gets produced. Dropped from `targets`; `.deb` ships and covers the same distros. Next things to try: pin a specific `linuxdeploy`/`linuxdeploy-plugin-gtk` version, set `NO_STRIP=true`, or switch the Linux job to the `tauri-apps/tauri-action` which handles AppImage tooling. Low priority — `.deb` is sufficient.
- [ ] Re-add macOS-Intel (`macos-13`) when runner availability allows (currently dropped — chronic queue).
- [ ] Reconcile the apt-lane branding: `release.yml` and the published `apt` branch (`setup.sh`) still install via the **old** `CoastalCrypto/CoastalClaw_IO` lane + `coastalclaw-release.asc` key, while `packaging/publish-apt.sh` uses the new `Coastal.AI_IO` lane + `coastal-ai-release.asc`. Pick one lane/key and update the other. (The orphan local `coastalclaw-release.asc` was removed in the two-product split — it was unreferenced; the keys above are fetched from external github-pages URLs.)

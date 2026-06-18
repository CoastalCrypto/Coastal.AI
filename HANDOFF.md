# Coastal.AI — Handoff & TODO

_Living checklist. Tackled top-to-bottom. `[operator]` = needs you (hardware,
secrets, cost, manual test); everything else the agent can do._

## State (2026-06-13)

- **Desktop app** (Tauri shell + Node `core` sidecar) is **on `master`**, fully working:
  flat-npm sidecar bundle, dynamic port, kill-on-exit, real C-current icon,
  graceful error screen.
- **CI matrix** (`.github/workflows/desktop-release.yml`) builds Win/Linux/macOS;
  validated 3/4 green (macOS-x64 only waiting on a runner).
- Repo is clean: `master` only, no open PRs.
- Docs: root `README.md` (desktop path) + `packages/desktop/README.md` (architecture).

---

## 1. Ship the desktop app (release loop)  ← in progress

- [x] Re-tag `desktop-v0.1.0` → release run builds + publishes installers. CI release machinery debugged through 4 issues: (1) missing `tauri` npm script, (2) `GITHUB_TOKEN` needed `contents: write`, (3) matrix runners raced to create the release → **decoupled** to build-artifacts + a single `publish` job, (4) macOS-Intel (`macos-13`) runners chronically unavailable → **dropped** (ship Windows + Linux + macOS Apple-Silicon; Intel-mac on demand later).
- [x] App icon updated to the **Coastal AI / Digital Depths** badge (operator art).
- [ ] [operator] Download the installer and **install-test on a machine with NO Node/pnpm** — confirm it launches, the UI loads, and (with Ollama) chat works.
- [ ] Publish the draft release once the install-test passes.

## 2. Distribution quality

- [ ] [operator] Acquire signing certs — **Windows Authenticode** + **Apple Developer ID** (cost/procurement).
- [ ] Wire signing into `desktop-release.yml` (env secrets) so installers are signed + macOS-notarized (no scary first-run warnings).
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

- [ ] **Syncthing** notes-substrate replication (own spec) — unblocks the multi-agent OS replication decision.
- [ ] **openobserve** as the Monitor/Watchdog agent backend.
- [x] **OS light de-dup**: shared systemd units, apt lane, and VERSION now live in `os/base/` and both build scripts consume from there; verified green by `iso-build`. (Superseded by the two-product split, which moved the editions to `os/{base,kiosk,node}` — see `docs/superpowers/plans/2026-06-18-two-product-split.md`.)

## 6. Housekeeping

- [ ] Replace placeholder branding elsewhere if any; keep `icon-source-1024.png` as the canonical icon source.
- [ ] Consider `tesseract`/`sharp` adoption when the Designer(vision)/`video` pipeline is built.

## CI follow-ups

- [ ] Re-enable AppImage Linux target: `linuxdeploy` fails in CI with a swallowed `failed to run linuxdeploy`. **Confirmed (run 27762985002, 2026-06-18): neither `APPIMAGE_EXTRACT_AND_RUN=1` NOR `libfuse2` (both applied together) fixes it** — Tauri discards linuxdeploy's stderr so the root cause is opaque. Note: `appimage` must NOT sit before `deb` in `targets`, since its failure aborts the whole `tauri build` and the `.deb` never gets produced. Dropped from `targets`; `.deb` ships and covers the same distros. Next things to try: pin a specific `linuxdeploy`/`linuxdeploy-plugin-gtk` version, set `NO_STRIP=true`, or switch the Linux job to the `tauri-apps/tauri-action` which handles AppImage tooling. Low priority — `.deb` is sufficient.
- [ ] Re-add macOS-Intel (`macos-13`) when runner availability allows (currently dropped — chronic queue).

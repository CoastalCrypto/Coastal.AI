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

- [ ] Re-tag `desktop-v0.1.0` at current `master` (old tag predates icon + CI fixes) → CI publishes a draft release with installers.
- [ ] [operator] Download the installer and **install-test on a machine with NO Node/pnpm** — confirm it launches, the UI loads, and (with Ollama) chat works.
- [ ] Publish the draft release once the install-test passes.

## 2. Distribution quality

- [ ] [operator] Acquire signing certs — **Windows Authenticode** + **Apple Developer ID** (cost/procurement).
- [ ] Wire signing into `desktop-release.yml` (env secrets) so installers are signed + macOS-notarized (no scary first-run warnings).
- [ ] Add the **Tauri auto-updater**: generate the minisign keypair (private key → CI secret), enable the updater plugin, publish `latest.json` from CI.

## 3. Hardening

- [ ] Security pass on the new desktop surface (sidecar local HTTP server, CORS-to-webview, bundled auth flow, data-URL error page) via the `cso`/security-review skill.
- [ ] [operator] Rotate the Gemini API key shared in chat.
- [ ] [operator] Move the `@21st-dev/magic` MCP key out of the plaintext command-line arg into an env var.

## 4. Desktop polish (deferred Phase 2–5)

- [ ] `coastalShell` window-controls shim → custom frameless title bar (vs current OS chrome).
- [ ] System tray (show/hide/quit).
- [ ] First-run/auth onboarding pass for the desktop app.

## 5. Feature threads (from the repo evaluation)

- [ ] **Syncthing** notes-substrate replication (own spec) — unblocks the multi-agent OS replication decision.
- [ ] **openobserve** as the Monitor/Watchdog agent backend.
- [ ] **OS light de-dup**: execute `docs/superpowers/plans/2026-06-12-os-lineage-dedup.md` on Linux/CI (move shared systemd units to `coastal-os/base`, rewire build scripts, verify via `iso-build`).

## 6. Housekeeping

- [ ] Replace placeholder branding elsewhere if any; keep `icon-source-1024.png` as the canonical icon source.
- [ ] Consider `tesseract`/`sharp` adoption when the Designer(vision)/`video` pipeline is built.

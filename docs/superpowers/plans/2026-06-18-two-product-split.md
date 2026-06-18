# Two-Product Repo Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the repo so its two products (Desktop App, Coastal.AI OS) are explicit over one shared engine, with per-product version + release pipeline — no behavior change.

**Architecture:** Keep `packages/` as the shared pnpm/turbo engine. Move only `packages/desktop`→`apps/desktop` and consolidate `coastalos/` + `coastal-os/{base,image}`→`os/{kiosk,base,node}`. Phased, each phase pushed and CI-verified before the next so `master` never goes red.

**Tech Stack:** pnpm/turbo workspace, Tauri v2 (Rust), GitHub Actions (`ci.yml`, `desktop-release.yml`, `iso-build.yml`, `release.yml`), live-build/mmdebstrap (OS).

**Spec:** `docs/superpowers/specs/2026-06-18-two-product-split-design.md`

**Migration note:** Use `git mv` for every move (history follows files). This is a relocation/docs plan, so "tests" are verification commands and CI gates, not unit tests. Run every command from the repo root unless noted.

---

## Phase 0 — Prep (no moves, zero build impact)

### Task 0: Workspace glob, two-product docs, stray cleanup

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `README.md`
- Create: `PRODUCTS.md`
- Delete: `ruvector.db` (gitignored stray)

- [ ] **Step 1: Add `apps/*` to the workspace globs**

Edit `pnpm-workspace.yaml` to:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 2: Verify the lockfile stays clean with the new glob**

Run: `pnpm install --lockfile-only`
Expected: completes "Done"; `git diff --stat pnpm-lock.yaml` shows no or trivial change (no `apps/*` package exists yet).

- [ ] **Step 3: Create `PRODUCTS.md`**

```markdown
# Products in this repo

This monorepo builds **two products over one shared engine**.

| | Desktop App | Coastal.AI OS |
|---|---|---|
| Path | `apps/desktop/` | `os/` (`kiosk/` ISO, `node/` BC-250 image) |
| Engine | embedded as a local sidecar | installed via the apt lane |
| Shared UI | `packages/web` | `packages/web` (labwc kiosk) |
| Release | tag `desktop-v*` → `release-desktop-app.yml` | tag `os-v*` → `release-os.yml` |
| Version | `apps/desktop/src-tauri/tauri.conf.json` | `os/base/VERSION` |

**Shared engine** — the `packages/` pnpm/turbo workspace (`core`, `web`,
`daemon`, `architect`, the A2A multi-agent layer, optional verticals). Both
products are surfaces over this one engine. The `packer/`+`packaging/` AMI/`.deb`
path is a deployment of the engine, not a separate product.
```

- [ ] **Step 4: Add a short two-product section near the top of `README.md`**

Insert after the project title/intro (before the existing package table). Keep it to the table above plus one sentence; link to `PRODUCTS.md`.

- [ ] **Step 5: Delete the gitignored stray DB**

Run: `git status --porcelain ruvector.db` (expect empty — it's ignored), then `rm -f ruvector.db`
Expected: file gone; `git status` unaffected (it was never tracked).

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml README.md PRODUCTS.md
git commit -m "docs: make the two-product structure explicit (phase 0)"
git push origin master
```

Expected: `ci.yml` runs and stays green (no code touched).

---

## Phase 1 — OS consolidation → `os/{base,kiosk,node}`

### Task 1: Move the OS trees

**Files:**
- Move: `coastal-os/base` → `os/base`
- Move: `coastal-os/image` → `os/node`
- Move: `coastalos` → `os/kiosk`

- [ ] **Step 1: git mv the three trees**

```bash
mkdir -p os
git mv coastal-os/base os/base
git mv coastal-os/image os/node
git mv coastalos os/kiosk
rmdir coastal-os 2>/dev/null || true
```

Expected: `git status` shows renames; `coastal-os/` and `coastalos/` no longer exist.

- [ ] **Step 2: Do NOT commit yet** — consumers below would break. Continue to Task 2.

### Task 2: Fix the kiosk build script's REPO_ROOT depth + base path

**Files:**
- Modify: `os/kiosk/build/build.sh`

The script moved from depth-1 (`coastalos/build/`) to depth-2 (`os/kiosk/build/`),
so `REPO_ROOT` (computed as `SCRIPT_DIR/../..`) now resolves to `os/` instead of
the repo root. It needs one more `..`.

- [ ] **Step 1: Fix REPO_ROOT and BASE_DIR**

Find:
```sh
COASTALOS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BASE_DIR="${REPO_ROOT}/coastal-os/base"
```
Replace with:
```sh
KIOSK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
BASE_DIR="${REPO_ROOT}/os/base"
```

- [ ] **Step 2: Rename the remaining `COASTALOS_DIR` references to `KIOSK_DIR`**

Run: `grep -n "COASTALOS_DIR" os/kiosk/build/build.sh`
For each hit (the waybar/labwc/systemd copies), replace `COASTALOS_DIR` with `KIOSK_DIR`. There are no other meaning changes — same directory, clearer name.

- [ ] **Step 3: Syntax-check**

Run: `bash -n os/kiosk/build/build.sh`
Expected: no output (valid). The ISO output name stays `coastalos-${VERSION}.iso` (artifact name unchanged this phase).

- [ ] **Step 4: Verify the node build-image.sh needs no path edits**

`os/node/build-image.sh` resolves `BASE_DIR="$(cd "$SCRIPT_DIR/../base" && pwd)"`,
and `base/` moved alongside it (`os/node/../base` = `os/base`), so no edit is
needed — confirm only.
Run: `grep -n 'BASE_DIR\|SCRIPT_DIR/../base' os/node/build-image.sh && bash -n os/node/build-image.sh`
Expected: `BASE_DIR` still uses `$SCRIPT_DIR/../base`; syntax valid (no output from `-n`). The hardcoded `OUTPUT` default filename (`coastal-os-v0.0.1-bc250.img`) is a cosmetic string, not a path dependency — leave it.

### Task 3: Update the OS workflow + remaining script/tool references

**Files:**
- Modify: `.github/workflows/iso-build.yml`
- Modify: `scripts/smoke-test-docker.sh`
- Modify: `flash.sh`
- Modify: `packer/coastalos.pkr.hcl`

- [ ] **Step 1: Repoint the workflow paths**

In `.github/workflows/iso-build.yml`:
- `- 'coastalos/**'` → `- 'os/kiosk/**'` (and add `- 'os/base/**'`)
- `sudo bash coastalos/build/build.sh "$VERSION"` → `sudo bash os/kiosk/build/build.sh "$VERSION"`
- `bash coastalos/build/test/smoke-test.sh "$ISO"` → `bash os/kiosk/build/test/smoke-test.sh "$ISO"`

Leave every `coastalos-*.iso` glob unchanged (the ISO filename is not renamed this phase).

- [ ] **Step 2: Update the docker smoke-test Dockerfile path**

In `scripts/smoke-test-docker.sh`: `coastalos/build/test/Dockerfile.smoke` → `os/kiosk/build/test/Dockerfile.smoke`.

- [ ] **Step 3: Update flash.sh helper text**

In `flash.sh`: `bash coastalos/build/build.sh` → `bash os/kiosk/build/build.sh` (line 13 error message). The `coastalos-*.iso` globs stay (filename unchanged).

- [ ] **Step 4: Fix packer provisioner paths + the de-dup gap**

In `packer/coastalos.pkr.hcl`:
- `source = "${path.root}/../coastalos/build/hooks/post-install.sh"` → `"${path.root}/../os/kiosk/build/hooks/post-install.sh"`
- The `file` provisioner copying `"${path.root}/../coastalos/systemd/"` now only carries the desktop-only units. Repoint it to `"${path.root}/../os/kiosk/systemd/"` AND add a second `provisioner "file"` block copying `"${path.root}/../os/base/systemd/"` to the same destination, so the AMI also gets the shared server/daemon/architect units (closes the gap left by the earlier OS de-dup).

- [ ] **Step 5: Confirm no stale references remain**

Run: `grep -rn "coastalos\|coastal-os" --include=*.yml --include=*.sh --include=*.hcl . | grep -v node_modules | grep -v 'coastalos-\*\.iso' | grep -v '/dist/'`
Expected: only intentional hits (e.g., the `coastalos-${VERSION}.iso` output name in `os/kiosk/build/build.sh`, branding strings). No remaining `coastalos/` or `coastal-os/` *path* references.

- [ ] **Step 6: Commit and push (triggers the OS workflow)**

```bash
git add -A
git commit -m "refactor(os): consolidate editions under os/{base,kiosk,node} (phase 1)"
git push origin master
```

- [ ] **Step 7: Verify on Linux CI**

Run: `gh run list --workflow=iso-build.yml --limit 1` then `gh run watch <id> --exit-status`
Expected: `build-iso` job green (live-build + QEMU smoke). If red, read the log; the most likely cause is a missed `REPO_ROOT`/path edit in `os/kiosk/build/build.sh`.

---

## Phase 2 — Desktop app → `apps/desktop`

### Task 4: Move the desktop package

**Files:**
- Move: `packages/desktop` → `apps/desktop`

- [ ] **Step 1: git mv**

```bash
mkdir -p apps
git mv packages/desktop apps/desktop
```

Expected: `git status` shows the rename. Do not commit yet (paths below break first).

### Task 5: Fix the depth-sensitive relative paths

All these moved from depth-2 (`packages/desktop/...`) to depth-2 under a
different root (`apps/desktop/...`), so paths reaching back into `packages/`
(core, web) need one extra `..` plus the `packages` segment.

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/scripts/sync-sidecar.mjs`
- Modify: `apps/desktop/scripts/verify-csp.mjs`
- Modify: `apps/desktop/src-tauri/src/sidecar.rs`

- [ ] **Step 1: tauri.conf.json frontendDist**

Find: `"frontendDist": "../../web/dist",`
Replace: `"frontendDist": "../../../packages/web/dist",`
(`beforeBuildCommand` stays `"pnpm --filter web build"` — pnpm filters by package name, not path.)

- [ ] **Step 2: sync-sidecar.mjs core path**

Find: `const srcBuild = resolve(here, '..', '..', 'core', 'sidecar-build')`
Replace: `const srcBuild = resolve(here, '..', '..', '..', 'packages', 'core', 'sidecar-build')`
(`binDir`/`resDir` use `here, '..', 'src-tauri', ...` — within the package, unchanged.)

- [ ] **Step 3: verify-csp.mjs paths**

Find: `import playwright from '../../core/node_modules/playwright/index.js'`
Replace: `import playwright from '../../../packages/core/node_modules/playwright/index.js'`

Find: `const DIST = join(__dirname, '..', '..', 'web', 'dist')`
Replace: `const DIST = join(__dirname, '..', '..', '..', 'packages', 'web', 'dist')`
(`CONF = join(__dirname, '..', 'src-tauri', 'tauri.conf.json')` — within the package, unchanged.)

- [ ] **Step 4: sidecar.rs dev-fallback path for core_main**

Find:
```rust
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("core")
        .join("sidecar-build")
```
Replace:
```rust
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("core")
        .join("sidecar-build")
```
(`runtime_path`'s dev fallback uses `CARGO_MANIFEST_DIR.join("binaries")` — within `src-tauri`, unchanged. `build.rs` has no path refs.)

- [ ] **Step 5: Stage the sidecar and verify the CSP harness resolves moved paths**

```bash
pnpm --filter @coastal-ai/core build
pnpm --filter @coastal-ai/core bundle:sidecar
pnpm --filter @coastal-ai/desktop presync
pnpm --filter @coastal-ai/desktop verify:csp
```
Expected: `verify:csp` prints "✅ No CSP violations against the built web bundle." (proves the `web/dist` + `core/node_modules` relative paths resolve from the new location).

### Task 6: Update the desktop workflow paths + lockfile

**Files:**
- Modify: `.github/workflows/desktop-release.yml`
- Modify: `pnpm-lock.yaml` (regenerate)

- [ ] **Step 1: Repoint every `packages/desktop` path in the workflow**

In `.github/workflows/desktop-release.yml` replace all occurrences of `packages/desktop/` with `apps/desktop/`:
- cache `path:` (`packages/desktop/src-tauri/target`)
- cache key `hashFiles('packages/desktop/src-tauri/Cargo.lock')`
- the four artifact `path:` globs under `packages/desktop/src-tauri/target/release/bundle/...`

The `pnpm --filter @coastal-ai/desktop ...` invocations are name-based — leave them.

Run to confirm none remain: `grep -n "packages/desktop" .github/workflows/desktop-release.yml`
Expected: no output.

- [ ] **Step 2: Regenerate the lockfile**

Run: `pnpm install --lockfile-only`
Expected: "Done"; `@coastal-ai/desktop` still resolves (now under `apps/*`).

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "refactor(app): move desktop shell to apps/desktop (phase 2)"
git push origin master
```

- [ ] **Step 4: Verify the desktop build on all 3 OSes (build-only)**

```bash
gh workflow run desktop-release.yml --ref master
gh run list --workflow=desktop-release.yml --limit 1
gh run watch <id> --exit-status
```
Expected: windows-latest, macos-14, ubuntu-22.04 jobs all green; `publish` skipped (dispatch). If red, the most likely cause is a missed relative-path edit in Task 5.

### Task 7: Update active docs that name the desktop path

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `HANDOFF.md`

- [ ] **Step 1: Replace `packages/desktop` references in active docs**

Run: `grep -rn "packages/desktop" README.md CONTRIBUTING.md HANDOFF.md`
For each, change to `apps/desktop`. Do NOT touch `docs/superpowers/**` (historical records).

- [ ] **Step 2: Commit and push**

```bash
git add README.md CONTRIBUTING.md HANDOFF.md
git commit -m "docs: point active docs at apps/desktop (phase 2)"
git push origin master
```
Expected: `ci.yml` green.

---

## Phase 3 — Pipeline rename, per-product READMEs, relic cleanup

### Task 8: Rename the product release workflows + add tag triggers

**Files:**
- Rename: `.github/workflows/desktop-release.yml` → `release-desktop-app.yml`
- Rename: `.github/workflows/iso-build.yml` → `release-os.yml`

- [ ] **Step 1: git mv the workflow files**

```bash
git mv .github/workflows/desktop-release.yml .github/workflows/release-desktop-app.yml
git mv .github/workflows/iso-build.yml .github/workflows/release-os.yml
```

- [ ] **Step 2: Update the `name:` and add a tag trigger to each**

In `release-desktop-app.yml`: set `name: Release — Desktop App`. It already triggers on tag `desktop-v*` + `workflow_dispatch` — leave.

In `release-os.yml`: set `name: Release — Coastal.AI OS`. Add an `os-v*` tag trigger alongside the existing `push: branches: [master] paths: [os/kiosk/**, os/base/**]` and `workflow_dispatch`:
```yaml
on:
  push:
    branches: [master]
    paths:
      - 'os/kiosk/**'
      - 'os/base/**'
      - '.github/workflows/release-os.yml'
    tags:
      - 'os-v*'
  workflow_dispatch:
    # ... keep existing inputs ...
```

- [ ] **Step 3: Sanity-check YAML**

Run: `python -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['.github/workflows/release-desktop-app.yml','.github/workflows/release-os.yml']]; print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "ci: rename product release pipelines + add os-v* tag trigger (phase 3)"
git push origin master
```
Expected: `release-os.yml` triggers on the `os/**`-adjacent change → green (confirms the rename didn't break the trigger/paths).

### Task 9: Per-product READMEs

**Files:**
- Modify: `apps/desktop/README.md` (exists)
- Create: `os/README.md`

- [ ] **Step 1: Refresh `apps/desktop/README.md`**

Ensure it documents: what the product is (Tauri shell embedding the engine sidecar), how to dev (`pnpm --filter @coastal-ai/desktop dev`), how to build (`pnpm --filter @coastal-ai/desktop build`), how to verify CSP (`pnpm --filter @coastal-ai/desktop verify:csp`), where the version lives (`src-tauri/tauri.conf.json`), and the release trigger (tag `desktop-v*`).

- [ ] **Step 2: Create `os/README.md`**

```markdown
# Coastal.AI OS

A bootable OS that installs the engine, in two editions over a shared `base/`.

| Edition | Path | Build | Audience |
|---|---|---|---|
| Kiosk (desktop ISO) | `os/kiosk/` | `sudo bash os/kiosk/build/build.sh <ver>` (Linux, live-build) | a Coastal desktop machine |
| Node (BC-250 image) | `os/node/` | `sudo bash os/node/build-image.sh` (Linux, mmdebstrap) | headless cluster node |

- Shared infra (systemd units, apt lane, `VERSION`) lives in `os/base/` and is
  consumed by both editions.
- Version SSOT: `os/base/VERSION`. Release: tag `os-v*` → `release-os.yml`.
- CI verifies the kiosk ISO on every `os/**` change; the node image needs a
  Linux host (`mmdebstrap qemu-utils parted dosfstools kpartx`).
```

- [ ] **Step 3: Commit and push**

```bash
git add apps/desktop/README.md os/README.md
git commit -m "docs: per-product READMEs for desktop app and OS (phase 3)"
git push origin master
```

### Task 10: Remove the tracked legacy signing key if unreferenced

**Files:**
- Possibly delete: `coastalclaw-release.asc`

- [ ] **Step 1: Check for references**

Run: `grep -rn "coastalclaw-release\|coastalclaw" --include=*.sh --include=*.yml --include=*.md . | grep -v node_modules | grep -v docs/superpowers`
Also check the apt lane: `git show origin/apt:setup.sh | grep -i "coastalclaw\|\.asc" || true`

- [ ] **Step 2: Decide and act**

- If NO references: `git rm coastalclaw-release.asc` and commit `chore: remove legacy coastalclaw apt signing key (unreferenced)`.
- If referenced: leave it; add a one-line note to `HANDOFF.md` that the apt-signing key needs rotation/rename and stop. Do not break the published apt lane.

- [ ] **Step 3: Commit (only if removed) and push**

```bash
git add -A
git commit -m "chore: remove unreferenced legacy signing key (phase 3)"
git push origin master
```
Expected: `ci.yml` green; the split is complete.

---

## Final verification

- [ ] `gh run list --limit 6` — latest runs of `ci.yml`, `release-os.yml`, `release-desktop-app.yml` all green.
- [ ] `ls` shows `apps/ os/ packages/` and no `coastalos/ coastal-os/`.
- [ ] `grep -rn "packages/desktop\|coastalos/\|coastal-os/" --include=*.yml --include=*.sh --include=*.hcl --include=*.json . | grep -v node_modules | grep -v docs/superpowers | grep -v 'coastalos-\*\.iso'` returns nothing.
- [ ] `PRODUCTS.md`, `apps/desktop/README.md`, `os/README.md` exist and are accurate.

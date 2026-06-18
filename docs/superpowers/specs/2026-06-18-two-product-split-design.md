# Two-Product Repo Split — Design

> **Status:** approved 2026-06-18. Next step: implementation plan via the
> writing-plans skill, then a phased, CI-verified migration.

## Goal

Make the repo's reality explicit: it builds **two products over one shared
engine**. Give each product a clear home, README, version, and release pipeline,
while keeping the engine whole. This is a structural/clarity change — no new
features, no behavior change to either product.

## The two products + the shared engine

1. **Coastal.AI Desktop App** — a Tauri shell that embeds the engine as a local
   sidecar. Ships installers (NSIS / DMG / `.deb`) for Windows / macOS / Linux.
   No Node/pnpm required by the end user.
2. **Coastal.AI OS** — a bootable OS in two editions that *install* the engine:
   - **kiosk** — the labwc Wayland desktop ISO (live-build).
   - **node** — the headless BC-250 cluster-node image (mmdebstrap).
3. **Shared engine** — the existing pnpm/turbo workspace (`core`, `web`,
   `daemon`, `architect`, the A2A multi-agent layer, and optional verticals).
   Both products are surfaces over this one engine. The `packer`/`packaging`
   cloud-AMI/`.deb` path is a **deployment of the engine**, not a third product.

### Boundary decisions (resolved)

- **A2A / multi-agent packages** (`coordination`, `llm-client`, `mission-control`,
  `planner-agent`, `coding-agent`, `reviewing-agent`, `curator-agent`,
  `swarm-demos`) live in the **shared engine** — they are software the OS *runs*,
  not the OS itself.
- **`web`** stays in the engine — it is consumed by *both* the desktop app (Tauri
  loads its `dist`) and the OS kiosk (labwc displays it). One shared UI.
- The engine pnpm workspace is **not** physically scattered. It is cohesive and
  tightly coupled (shared imports, one tsconfig, one turbo graph); splitting it
  by ownership would break every cross-package path for no benefit.

## Target layout

```
packages/                 SHARED ENGINE (pnpm/turbo workspace — stays in place)
  core  web  daemon  architect  llm-client  coordination
  mission-control  planner-agent  coding-agent  reviewing-agent
  curator-agent  swarm-demos  trading-architect  video

apps/
  desktop/                PRODUCT 1 — Coastal.AI Desktop App
                          (← packages/desktop) + README

os/                       PRODUCT 2 — Coastal.AI OS
  base/                   shared OS infra (← coastal-os/base) — incl. VERSION
  kiosk/                  desktop ISO edition (← coastalos/)
  node/                   BC-250 node image  (← coastal-os/image)
  README

docs/ scripts/ packaging/ packer/ flash.sh   repo-wide (engine deployment + tooling)
```

Only three trees move: `packages/desktop` → `apps/desktop`; `coastalos/` →
`os/kiosk`; `coastal-os/{base,image}` → `os/{base,node}`. Everything else stays.

## Versioning & release pipelines

Independent semver per product, each with a single source of truth:

| Thing | Version SSOT | Release |
|-------|--------------|---------|
| Engine (`packages/`) | root `package.json` (`1.7.0-dev`) | `ci.yml` (test/lint) + existing `release.yml` (engine `.deb`/apt lane) |
| Desktop App | `apps/desktop/src-tauri/tauri.conf.json` → `version` (`0.1.0`) | tag `desktop-v*` → `release-desktop-app.yml` |
| Coastal.AI OS | `os/base/VERSION` (`0.0.1`) — already consumed by both build scripts | tag `os-v*` → `release-os.yml` (plus the existing push/dispatch triggers) |

- No separate `apps/desktop/VERSION` file — `tauri.conf.json`'s `version` is what
  Tauri builds from; a second file would only drift. The app README documents it.
- Workflow renames are names + path-filter changes only:
  `desktop-release.yml` → `release-desktop-app.yml`;
  `iso-build.yml` → `release-os.yml`. `ci.yml` stays repo-wide.

## Phased migration (master stays green at every step)

Each phase is one commit/PR, pushed, and **CI-verified before the next**.

### Phase 0 — Prep (no moves, zero build impact)
- Add `apps/*` to `pnpm-workspace.yaml` (alongside `packages/*`).
- Add the two-product map to the root `README.md` and a new `PRODUCTS.md`.
- Delete the gitignored stray `ruvector.db` (untracked — local only).

### Phase 1 — OS consolidation (verified by the OS/iso workflow)
- `git mv coastal-os/base os/base`, `coastal-os/image os/node`, `coastalos os/kiosk`.
- Update consumers:
  - OS workflow trigger `coastalos/**` → `os/kiosk/**` and the build-script path.
  - `os/kiosk/build/build.sh`: `BASE_DIR="${REPO_ROOT}/os/base"`.
  - `os/node/build-image.sh`: `BASE_DIR="$(cd "$SCRIPT_DIR/../base" && pwd)"` already
    resolves correctly post-move (`os/node/../base` = `os/base`) — verify only.
  - `os/kiosk/build/hooks/post-install.sh`, `os/kiosk/build/test/smoke-test.sh`.
  - `packer/coastalos.pkr.hcl`, `flash.sh`, `packaging/build-deb.sh` (exclude
    `coastalos` → `os`), `scripts/smoke-test-docker.sh`.
- Push → OS workflow runs on the `os/kiosk/**` change → green confirms.

### Phase 2 — Desktop app move (verified by desktop build-only dispatch)
- `git mv packages/desktop apps/desktop`.
- Fix relative paths (depth increases by one segment):
  - `apps/desktop/src-tauri/tauri.conf.json`: `frontendDist "../../web/dist"` →
    `"../../../packages/web/dist"`.
  - `apps/desktop/scripts/verify-csp.mjs`: `../../web/dist` → `../../../packages/web/dist`;
    `../../core/node_modules` → `../../../packages/core/node_modules`;
    `../../src-tauri/tauri.conf.json` ref stays relative to the script.
  - `apps/desktop/scripts/sync-sidecar.mjs`: core/web source paths.
  - `apps/desktop/src-tauri/build.rs` + `sidecar.rs` dev-fallback paths
    (`../../core/...` → `../../../packages/core/...`).
- `beforeBuildCommand` stays `pnpm --filter web build` (filter is by package name).
- Update `release-desktop-app.yml` artifact/checkout paths (`packages/desktop` →
  `apps/desktop`).
- Regenerate `pnpm-lock.yaml`.
- Push + `workflow_dispatch` (build-only) → green on Windows/macOS/Linux confirms.
- Re-run `pnpm --filter @coastal-ai/desktop verify:csp` to confirm the CSP harness
  still resolves the moved paths.

### Phase 3 — Pipeline rename + docs + relic cleanup
- Rename the two product workflows; add `desktop-v*` / `os-v*` tag triggers.
- Write `apps/desktop/README.md` (exists — refresh) and `os/README.md` (new),
  each describing build/run/release for that product.
- Update root `README.md`, `CONTRIBUTING.md`, `HANDOFF.md` path references.
- Remove the tracked `coastalclaw-release.asc` **only if** unreferenced by the apt
  lane / signing config (grep first; if referenced, leave + note).

## Invariants / non-goals

- **No behavior change** to either product; pure relocation + docs + version SSOT.
- **`git mv`** for every move so history follows the files.
- The pnpm workspace is **not** scattered; `packages/` remains the engine.
- Historical docs under `docs/superpowers/**` are records — **not** rewritten
  (only active docs: root `README`, `CONTRIBUTING`, `HANDOFF`).
- No separate-repo split now — this layout is the stepping stone if that's wanted
  later.

## Verification per phase

| Phase | Gate |
|-------|------|
| 0 | `pnpm install --lockfile-only` clean; repo builds unaffected |
| 1 | OS workflow (`release-os`/iso) green on Linux (live-build + QEMU smoke) |
| 2 | Desktop workflow green on Win/macOS/Linux; `verify:csp` green; lockfile clean |
| 3 | Docs link-check by eye; `ci.yml` green; tag-trigger dry sanity |

## Risks

- **Relative-path / CI-trigger edits** are the main failure mode → each caught by
  the per-phase CI gate before the next phase lands.
- **live-build is slow (~tens of min)** → acceptable; we already have a green
  baseline (run 27765392091) to diff against.
- **Node-image path has no CI** → its edits in Phase 1 are verified only by
  `bash -n` + careful review here; full verification needs a Linux host (tracked
  as an operator follow-up, consistent with the existing OS de-dup).

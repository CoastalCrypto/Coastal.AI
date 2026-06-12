# Coastal.AI OS — light de-dup migration plan

> **Approach:** "Light de-dup" (approved 2026-06-12) — extract a shared `base/`
> consumed by both editions; keep the two build paths (`coastal-os/image` node,
> `coastalos/` desktop) where they are. **Must be executed and verified on Linux**
> (live-build/mmdebstrap need root + Linux). The `iso-build` workflow validates
> the desktop path in CI on every `coastalos/**` change.

**Goal:** one source of truth for shared OS infra (version, apt lane, shared
systemd units) so the node and desktop editions stop diverging.

**Scaffold already in place (this session, safe — no build behavior changed):**
`coastal-os/base/{README.md,VERSION,apt/coastal-ai.list}`.

---

## Task 1 — Move the shared systemd units into base/

**Files:** `git mv coastalos/systemd/{coastal-daemon,coastal-server,coastal-architect}.service coastal-os/base/systemd/` and `coastal-architect.timer`.

- [ ] Create `coastal-os/base/systemd/` and move the 3 shared units + the timer there.
- [ ] Leave desktop-only units in `coastalos/systemd/`: `coastal-shell`, `coastal-vibevoice`, `coastal-web`, `coastal-vllm`, `coastal-airllm`, `coastal-infinity`.
- [ ] Commit. (No build runs yet — Task 2/3 rewire the consumers in the same PR.)

## Task 2 — Desktop build consumes base/ (coastalos/build/build.sh)

Currently (lines ~54-57) it copies `${COASTALOS_DIR}/systemd/*.service` and `*.timer`.

- [ ] Add a shared-base path and copy from both:
  ```sh
  BASE_DIR="${REPO_ROOT}/coastal-os/base"
  cp "${BASE_DIR}/systemd/"*.service config/includes.chroot/etc/systemd/system/
  cp "${BASE_DIR}/systemd/"*.timer   config/includes.chroot/etc/systemd/system/
  cp "${COASTALOS_DIR}/systemd/"*.service config/includes.chroot/etc/systemd/system/
  ```
- [ ] Set up the apt lane the node already has but the desktop lacks:
  ```sh
  mkdir -p config/includes.chroot/etc/apt/sources.list.d
  cp "${BASE_DIR}/apt/coastal-ai.list" config/includes.chroot/etc/apt/sources.list.d/
  ```
- [ ] If `VERSION` arg is unset, default it from `base/VERSION` instead of `dev`.

## Task 3 — Node build consumes base/ (coastal-os/image/build-image.sh)

Currently it hardcodes `COASTAL_OS_VERSION="0.0.1"` (line ~35) and writes the apt
lane inline via heredoc (lines ~176-180).

- [ ] Read version from base: `COASTAL_OS_VERSION="$(cat "$(dirname "$0")/../base/VERSION")"`.
- [ ] Replace the inline apt heredoc with a copy of `base/apt/coastal-ai.list` into the image's `/etc/apt/sources.list.d/`.
- [ ] Install the shared units: copy `base/systemd/*.service` + `*.timer` into the overlay (`$FILES_DIR` tree or directly), and `systemctl enable` `coastal-daemon`/`coastal-server`/`coastal-architect` alongside the existing `coastal-os-first-boot.service`.

## Task 4 — Verify

- [ ] **Desktop (CI):** push the branch; `iso-build.yml` runs live-build + the QEMU smoke test on Linux. Green = desktop edition still builds with units sourced from `base/`.
- [ ] **Node (Linux host):** `sudo bash coastal-os/image/build-image.sh` on an Ubuntu box with `mmdebstrap qemu-utils parted dosfstools kpartx`; confirm the image enables the shared units and carries `base/VERSION` + the apt lane.
- [ ] Update `packer/coastalos.pkr.hcl` / `flash.sh` / `packaging/build-deb.sh` only if they reference moved paths (they reference the build outputs, not the unit source dir — likely no change).

## Out of scope (this is the *light* path)

- No `editions/{node,desktop}` restructure, no renaming `coastalos/` → `coastal-os/editions/desktop`. That's the "full restructure" option, deferred.

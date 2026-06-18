# Coastal.AI OS — shared base

One OS, two **editions** (like Server vs Desktop). This `base/` directory is the
single source of truth for what both editions share; each edition's build script
consumes from here plus its own edition-specific overlay.

```
os/
  base/          ← shared (this dir): version, apt lane, shared systemd units
  node/          ← NODE edition build (mmdebstrap, headless BC-250 cluster node)
  kiosk/         ← KIOSK edition build (live-build USB ISO desktop)
```

## What's shared (lives here)

| Artifact | Why shared |
|---|---|
| `VERSION` | One OS lineage version for both editions. |
| `apt/coastal-ai.list` | The `origin/apt` package lane. Both editions install the same lane the same way (today only the node image sets it up — the desktop ISO should too). |
| `systemd/` | The units both editions run: `coastal-daemon`, `coastal-server`, `coastal-architect(.service/.timer)`. |

## What stays edition-specific

- **Node** (`os/node/`): `coastal-os-first-boot.service`, kisak Mesa PPA + gfx1013 Vulkan stack, `llama.cpp-bc250` inference path.
- **Kiosk** (`os/kiosk/`): labwc + waybar kiosk, `coastal-vibevoice` (TTS), and the host GPU inference engines (`coastal-vllm` / `coastal-airllm` / `coastal-infinity`). `coastal-web` is kiosk-default; the node can opt in.

## Migration status

Done. The shared systemd units live here and both build scripts (`os/kiosk/build/build.sh`,
`os/node/build-image.sh`) consume from `base/`. The kiosk/desktop path is verified on Linux by
the `iso-build` workflow; the node-image path needs a Linux host (`mmdebstrap`) to fully verify.

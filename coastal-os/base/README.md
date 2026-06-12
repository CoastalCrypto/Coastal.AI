# Coastal.AI OS — shared base

One OS, two **editions** (like Server vs Desktop). This `base/` directory is the
single source of truth for what both editions share; each edition's build script
consumes from here plus its own edition-specific overlay.

```
coastal-os/
  base/          ← shared (this dir): version, apt lane, shared systemd units
  image/         ← NODE edition build (mmdebstrap, headless BC-250 cluster node)
coastalos/       ← DESKTOP edition build (live-build USB ISO kiosk)
```

## What's shared (lives here)

| Artifact | Why shared |
|---|---|
| `VERSION` | One OS lineage version for both editions. |
| `apt/coastal-ai.list` | The `origin/apt` package lane. Both editions install the same lane the same way (today only the node image sets it up — the desktop ISO should too). |
| `systemd/` *(planned move)* | The units both editions run: `coastal-daemon`, `coastal-server`, `coastal-architect(.service/.timer)`. |

## What stays edition-specific

- **Node** (`coastal-os/image/`): `coastal-os-first-boot.service`, kisak Mesa PPA + gfx1013 Vulkan stack, `llama.cpp-bc250` inference path.
- **Desktop** (`coastalos/`): labwc + waybar kiosk, `coastal-shell`, `coastal-vibevoice` (TTS), and the host GPU inference engines (`coastal-vllm` / `coastal-airllm` / `coastal-infinity`). `coastal-web` is desktop-default; the node can opt in.

## Migration status

Scaffold only. The systemd-unit move + build-script rewiring is documented in
`docs/superpowers/plans/2026-06-12-os-lineage-dedup.md` and must be executed and
verified on Linux (live-build/mmdebstrap need root + Linux — the `iso-build`
workflow validates the desktop path in CI).

# CoastalOS — standalone desktop ISO

The bootable **desktop** edition of Coastal.AI: a live-build Linux ISO that
boots from USB into a kiosk session running the full Coastal.AI stack, with
nothing written to the host disk. This is **Path 3** in the
[root README](../README.md#-coastalos--standalone-os).

> **Not the cluster-node image.** The headless BC-250 **cluster-node**
> image — Ubuntu 24.04 + inference stack, for the 12-node chassis — lives
> in [`../coastal-os/`](../coastal-os/) (with a hyphen). Different hardware
> target, different build pipeline. Don't confuse the two.

## Layout

```
coastalos/
  build/        live-build config, image hooks, and smoke test
  systemd/      service units (Coastal.AI server, VibeVoice)
  vibevoice/    Python FastAPI TTS/ASR sidecar
  labwc/        Wayland kiosk autostart (desktop session)
```

## Build

Produced in CI by
[`.github/workflows/iso-build.yml`](../.github/workflows/iso-build.yml) and
packed via [`packer/coastalos.pkr.hcl`](../packer/coastalos.pkr.hcl). See the
[root README → CoastalOS](../README.md#-coastalos--standalone-os) for USB
flashing and boot instructions.

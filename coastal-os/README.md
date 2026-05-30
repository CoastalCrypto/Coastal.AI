# Coastal.AI OS

The bootable distribution of Coastal.AI. Same daemon as the host install,
deterministically packaged with the inference toolchain and cluster join
infrastructure preconfigured.

> Design rationale + phase plan: [`docs/handoff/2026-05-26-multi-agent-os-plan.md`](../docs/handoff/2026-05-26-multi-agent-os-plan.md)

## Version progression

Per the **OS version progression rule** (agreed 2026-05-26): every image
we ship is Coastal.AI OS at some version. We do not ship "Debian with
scripts" as a separate product.

| Version | Lands in | What's added |
|---|---|---|
| **v0.0.1** | Phase 0 (current) | Debian 12 base + Coastal branding + `llama.cpp-bc250` + `coastal-os-bench` + apt source pre-pointed at `origin/apt` |
| **v0.1** | Phase 3 | Bootstrap wizard, Ed25519 keypair gen, role picker, hardware-scan-driven model download, read-only root + overlayfs |
| **v1.0** | Phase 4 | Full 12-node cluster awareness, mission control UI integration, all role peer packages preinstalled by role |

## Directory layout

```
coastal-os/
  README.md                 This file
  scripts/
    coastal-os-bench        Phase 0 inference benchmark (bash)
    coastal-os-bench.json   Prompt corpus used by the benchmark
  docs/
    bios-reflash.md         BC-250 BIOS reflash for gfx1013 / PCIe bridge
    build-image.md          How to build a v0.0.1 NVMe image
  image/
    (Phase 0 prep #7 — Debian image build scaffolding lands here)
```

## Hardware target

Each BC-250 is treated as an independent node:

- AMD APU (Zen 2 + RDNA 2, ~24 CU)
- 16 GB GDDR6 shared between CPU and iGPU
- 1 GbE NIC
- M.2 NVMe boot media
- gfx1013 (community-modded BIOS required — see `docs/bios-reflash.md`)

Cluster reference: ASRock 12-bay BC-250 server chassis,
~1.5 kW peak / ~192 GB pooled VRAM, communicating over an internal
managed switch.

## How v0.0.1 is consumed

1. Build the NVMe image (or download from the `origin/apt` artifact lane once available)
2. `dd` to the BC-250's NVMe (single command, no installer needed)
3. Boot the BC-250 — SSH is enabled on first boot
4. Run `coastal-os-bench` to validate inference works at the expected speed

Phase 0 stops there. Phase 3 adds the bootstrap wizard that takes a fresh
v0.1 boot through keypair gen, role pick, model download, and cluster
join automatically.

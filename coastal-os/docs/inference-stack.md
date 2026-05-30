# BC-250 inference stack — what Coastal.AI OS v0.0.1 must include

**Audience:** anyone building or maintaining the v0.0.1 NVMe image.
**Source:** verified 2026-05-26 against `TechMakesArt/llama.cpp-bc250` (commit `a15e16f`) and `Kaden-Schutt/hipfire` (HEAD).

## Verdict (Phase 0 prep #6)

**`llama.cpp-bc250` is buildable today and is the recommended primary inference engine for Coastal.AI OS v0.0.1.**

- **Status:** snapshot fork — explicitly "not actively maintained" per the maintainer. That's a *feature* for us: the code is frozen at a known-good point, so it won't break.
- **Last sync with upstream:** based on `ggml-org/llama.cpp` commit `f772f6e43` (mid-April 2026). Upstream main is at `b4c0549` as of 2026-05-26 — the fork is intentionally not rebased.
- **Delta to upstream:** 3 surgical commits in `ggml/src/ggml-vulkan/` (Q4_K smin algebraic restructure, RDNA1 `rm_kq=4` tuning, fused MUL_MAT(gate)+MUL_MAT(up)+SWIGLU_SPLIT kernel for Q4_K). Plus docs. No conflicts with our usage.
- **Measured performance:** 54.99 tok/s decode on Qwen 3.5 9B Q4_K_M, single-stream, on a single BC-250 — **+48.6% over stock llama.cpp Vulkan**. Projects to ~2,100 aggregate tok/s on the 12-node cluster.

**Fallback (if llama.cpp-bc250 hits a snag):** `Kaden-Schutt/hipfire` (RDNA-native, Rust, 400 stars, pushed today). Single binary, Ollama-style UX, full RDNA1→RDNA4 family scope including APUs. Published numbers are on dGPUs (7900 XTX) so BC-250 perf parity needs in-bench verification — but it's the better bet for active maintenance and broader hardware coverage.

## The full stack (this is what v0.0.1 has to ship)

Inference doesn't work standalone. There are five layers that all have to be in place; missing any of them caps performance at ~1 tok/s (or worse, OOM on model load):

```
┌──────────────────────────────────────────────────────────────────┐
│ 5. INFERENCE ENGINE — llama.cpp-bc250 (primary) | hipfire        │
├──────────────────────────────────────────────────────────────────┤
│ 4. SMU GOVERNOR — filippor/cyan-skillfish-governor (smu branch)  │
│    Unlocks GPU clock past amdgpu's 1500 MHz pin to ~2300+ MHz.   │
│    ~30% of total tok/s gain. NON-OPTIONAL.                       │
├──────────────────────────────────────────────────────────────────┤
│ 3. KERNEL MEMORY TUNING — /etc/modprobe.d/ttm-gpu-memory.conf    │
│    options ttm pages_limit=4194304 page_pool_size=4194304        │
│    Without this, models > 5 GB fail to load (default GTT cap).   │
│    Also: REMOVE `amdgpu.gttsize=14336` from GRUB cmdline if      │
│    present — it actively hurts on modern kernels.                │
├──────────────────────────────────────────────────────────────────┤
│ 2. KERNEL + DRIVERS — Linux 6.8+ with Mesa 26.x                  │
│    Ubuntu 24.04 + kisak PPA is the community-tested path.        │
├──────────────────────────────────────────────────────────────────┤
│ 1. BIOS — community-patched with PCIe x16 + gfx1013 enable +     │
│    dynamic VRAM allocation. See docs/bios-reflash.md.            │
└──────────────────────────────────────────────────────────────────┘
```

**Every BC-250 node in the cluster needs all five layers.** Coastal.AI OS v0.0.1 should ship layers 2–5 preconfigured. Layer 1 (BIOS) is a one-time reflash per card, documented separately.

## Open design decision: Ubuntu 24.04 vs Debian 12

The handoff doc currently specifies **Debian 12 (Bookworm)** as the OS base. The community's tested stack is **Ubuntu 24.04 LTS** (with the `kisak/kisak-mesa` PPA). The implications:

| Option | Pros | Cons |
|---|---|---|
| **Debian 12** | Lighter, more conservative, what was in the handoff | Older kernel (6.1 LTS), older Mesa (22.x) — would need backports for gfx1013 + Mesa 26.x. The community SMU governor is packaged for Bazzite (dnf), not Debian — would need apt repackaging. |
| **Ubuntu 24.04 LTS** | Kernel 6.8 ships natively, kisak PPA gives Mesa 26.x out of the box, akandr/bc250 docs assume this path. Lower lift to a known-good state. | More opinionated than Debian, snap baggage (we'd strip it out for the image), Canonical-aligned (mild philosophy concern only). |

**Recommendation: pivot to Ubuntu 24.04 LTS for v0.0.1.** The community has done the BC-250 integration work on this base; replicating it on Debian 12 is wasted effort for v0.0.1's "prove the cluster works" goal. We can revisit the choice at v1.0 when the OS image is widely distributed and the base distro choice matters for our brand identity.

**Status:** open — pending user decision. Tracked as open design decision #8 (new) — append to handoff doc when settled.

## Recommended Phase 0 benchmark model

Use **Qwen 3.5 9B Q4_K_M** (`qwen3.5-9b-instruct-q4_k_m.gguf`) for the first BC-250 benchmark. Why:

- It's the model `TechMakesArt/llama.cpp-bc250` published its 54.99 tok/s number against — direct comparison validates the stack
- 9B Q4_K_M is ~6 GB on disk, fits comfortably in the BC-250's 16 GB shared memory with room for KV cache
- Sits at the upper bound of what we'd want a "specialist worker" agent to run; if 9B works, 7B will work better

Set `COASTAL_OS_BENCH_MODEL=/var/lib/coastal/models/qwen3.5-9b-instruct-q4_k_m.gguf` in `/etc/coastal/bench.env` so `coastal-os-bench` finds it automatically.

## Performance gate for the Phase 0 decision

Per the handoff doc:

| Result | Decision |
|---|---|
| ≥ 10 tok/s on 7B q4 (~50+ tok/s on 9B per fork numbers) | Green-light Phase 1 architecture as-is. Role map stands. |
| 5–10 tok/s on 7B q4 | Green-light, but flag heavy roles (Main / Planner on 13B q4) for later optimization or use a lighter model. |
| < 5 tok/s on 7B q4 | Stack is broken somewhere (most likely BIOS or SMU governor). Diagnose before proceeding. |

## Tracked open questions

Park answers here as they're resolved:

- [ ] **Ubuntu 24.04 vs Debian 12** for v0.0.1 (pending user decision)
- [ ] **Which canonical modded BIOS** (filename + SHA256) — Phase 0 prep #9
- [ ] **Does Bazzite's `cyan-skillfish-governor-smu` package work on Ubuntu 24.04**, or do we need to repackage as a `.deb`?
- [ ] **Does `hipfire` deliver BC-250 perf within 10% of `llama.cpp-bc250`?** Requires running both engines through `coastal-os-bench` on the same model.

## External references (community-canonical)

- [`TechMakesArt/llama.cpp-bc250`](https://github.com/TechMakesArt/llama.cpp-bc250) — the inference engine
- [`Kaden-Schutt/hipfire`](https://github.com/Kaden-Schutt/hipfire) — Rust RDNA-native alternative
- [`filippor/cyan-skillfish-governor`](https://github.com/filippor/cyan-skillfish-governor/tree/smu) — SMU governor (`smu` branch)
- [`akandr/bc250`](https://github.com/akandr/bc250) — community deployment notes
- [`elektricM/amd-bc250-docs`](https://github.com/elektricM/amd-bc250-docs) — community docs hub (BIOS + drivers)

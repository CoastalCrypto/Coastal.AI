# BC-250 BIOS reflash — gfx1013 PCIe bridge patches

**Audience:** anyone bringing up a Coastal.AI OS v0.0.1 node on a BC-250 card for the first time.
**Time:** 10–20 min per card, parallelizable across the chassis.
**Reversibility:** the flash is fully reversible. Keep your original BIOS dump as backup.

## Why this is required

Most BC-250 cards ship from the mining-vendor (typically Holochain / HoloPort) with a customized BIOS that does two things you don't want for inference:

1. **Forces PCIe link to x1.** Useful for mining (low data throughput) but starves inference, which moves significant data through the link during prompt processing and KV-cache eviction.
2. **Disables the iGPU entirely.** Mining used a separate dedicated path; the integrated RDNA 2 graphics unit (gfx1013) is hard-disabled in the vendor BIOS and not exposed to the OS.

For Coastal.AI inference, you need both: **PCIe at full width** and **gfx1013 visible to Linux**. The community-modded BIOS with the gfx1013 PCIe bridge patches restores both.

Without this reflash, even the best `llama.cpp-bc250` Vulkan path will get < 1 tok/s on a 7B model — the inference engine isn't broken, the hardware just isn't accessible to it.

## Pick the canonical modded BIOS

> **Action required (Phase 0 prep):** verify which BIOS revision is the current canonical with the BC-250 community before flashing. Sources:
> - `r/HomeServer` and `r/LocalLLaMA` BC-250 megathreads (most active discussion)
> - GitHub: `TechMakesArt/llama.cpp-bc250` issues tracker (the maintainer typically notes recommended BIOS)
> - GitHub: `Kaden-Schutt/hipfire` README + issues
>
> As of this writing, the typical recommendation is the **"PCIe x16 + gfx1013 enable"** BIOS dated 2025-Q3 or later. Pin the exact filename and SHA256 before the first flash; do **not** flash a random binary from a forum post without verifying its signature against the maintainer's expected hash.

## Prerequisites per card

1. **Console access to the card.** Either:
   - **BMC / IPMI** on the chassis with KVM-over-LAN (preferred — flash one card while booted on others, in parallel)
   - **USB-serial console cable** to the card's serial header
   - **Direct keyboard + monitor** on the card (slowest; sequential only)

2. **A working Linux environment on the card.** For a brand-new card still on the vendor BIOS:
   - Boot a Linux live USB (any modern distro with `flashrom` packaged — Ubuntu 24.04 LTS works)
   - Internet access for downloading `flashrom` if not already on the live media

3. **A copy of the modded BIOS binary** transferred to the live environment (USB stick, scp, or wget from a trusted mirror).

## Steps (do these for every BC-250 in the chassis)

### 1. Boot the live USB and install flashrom

```bash
sudo apt update && sudo apt install -y flashrom
flashrom --version    # confirm >= 1.3.0 (older versions don't recognize the BC-250 chipset)
```

### 2. Identify the SPI chip and dump the original BIOS

```bash
sudo flashrom --programmer internal --chip "AUTO"
# Note the detected chip name (e.g., MX25L12873F or similar 16MB SPI part).
```

Save a known-good backup of the current BIOS — this is your rollback:

```bash
sudo flashrom --programmer internal --chip <DETECTED_CHIP> --read original-bios.bin
sha256sum original-bios.bin > original-bios.bin.sha256
```

**Copy the backup off the card.** Store it on the chassis BMC or on the host doing the rack-up.

### 3. Verify the modded BIOS hash

```bash
sha256sum modded-bios.bin
# Compare to the published hash from the maintainer's release page.
# Do NOT proceed if they don't match.
```

### 4. Flash the new BIOS

```bash
sudo flashrom --programmer internal --chip <DETECTED_CHIP> \
  --write modded-bios.bin \
  --verify-only-this-region BIOS
```

Flashrom will read back the written content and verify byte-for-byte. The flash takes 60–120 seconds. **Do not power off the card during this step.**

### 5. Reboot and verify

```bash
sudo reboot
```

After reboot, verify the changes took effect:

```bash
# PCIe link width — should be x16 (or whatever the slot supports), not x1
lspci -vv -s $(lspci | grep -i amd | awk '{print $1}' | head -1) | grep LnkSta

# Look for the iGPU device — should see a gfx1013-class device exposed
lspci -nn | grep -i "VGA\|3D"
```

Once Coastal.AI OS v0.0.1 is on the card, the simpler proof is:

```bash
coastal-os-bench --quiet | jq .generation_tok_s
# Should report > 5 (12B q4) or > 10 (7B q4) — see "Expected performance" below.
```

## Expected performance after reflash

| Model class | Expected tok/s on a single BC-250 (with modded BIOS) |
|---|---|
| 3B q4 (Phi-3.5-mini)  | 25–35 |
| 7B q4 (Qwen2.5-Coder) | 10–15 |
| 13B q4 (Llama 3.1)    | 5–8 |

These are rough estimates for the Vulkan path via `llama.cpp-bc250`. The Rust `hipfire` path can be faster on some workloads. Anything significantly below these ranges indicates the BIOS reflash didn't take effect, the model isn't fully on the iGPU, or the PCIe link didn't come up at full width.

## Recovery if the flash bricked the card

If the card won't POST after the flash:

1. **Power cycle, NOT reset.** Some BC-250 boards have a secondary BIOS recovery slot; a full power cycle (cold start) sometimes triggers fallback to the backup.

2. **External SPI programmer.** Use a CH341A USB programmer + SOIC8 clip (~$15) to reflash the SPI chip directly while it's still on the board. Clip onto the chip, attach to a host PC, use `flashrom --programmer ch341a_spi --write original-bios.bin` to restore your backup.

3. **As a last resort**, the SPI chip can be desoldered and reflashed in a programmer socket, then resoldered. This requires hot-air rework skills.

Keep one card un-flashed on shelf as a known-good reference until at least one in-chassis card has been reflashed and benchmarked successfully.

## Open questions for the Phase 0 BC-250 community check

These should be answered before flashing the first card in the chassis:

- **Which BIOS revision is current canonical** (filename + SHA256)?
- **Is the chassis BMC's flash tool sufficient**, or is a Linux live USB strictly required?
- **Does the modded BIOS need to be applied per-card** or does the chassis BIOS govern all sleds?
- **Are there hardware-revision-specific modded BIOSes?** (Early BC-250 PCBs vs. later HoloPort revisions may differ.)

Park answers here in this file as a permanent reference once confirmed.

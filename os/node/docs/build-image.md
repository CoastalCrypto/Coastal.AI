# Building Coastal.AI OS v0.0.1 — NVMe image

**Audience:** anyone bringing the first BC-250 node online.
**Status:** alpha — recipe is documented end-to-end, but first end-to-end execution still needs to happen on a real BC-250 + Linux host.

## Prerequisites

- A **Linux build host** (Ubuntu 24.04 LTS recommended). On Windows, WSL2 with Ubuntu 24.04 works; on macOS, run inside a Linux VM.
- ~25 GB free disk on the build host
- A USB-to-M.2 NVMe adapter, OR a way to attach the BC-250's NVMe to the build host
- Required apt packages on the build host:
  ```bash
  sudo apt update
  sudo apt install -y mmdebstrap qemu-utils parted dosfstools kpartx jq
  ```

## Step 1 — clone the Coastal.AI repo

```bash
git clone https://github.com/CoastalCrypto/Coastal.AI.git
cd Coastal.AI
```

## Step 2 — copy `coastal-os-bench` into the image staging tree

The build script's `files/` overlay tree doesn't include the bench script (the script lives at `os/node/scripts/coastal-os-bench`). Copy it in before building:

```bash
mkdir -p os/node/files/opt/coastal/scripts
cp os/node/scripts/coastal-os-bench os/node/files/opt/coastal/scripts/
chmod +x os/node/files/opt/coastal/scripts/coastal-os-bench
```

## Step 3 — run the build

```bash
sudo os/node/build-image.sh --output ./coastal-os-v0.0.1-bc250.img
```

This:

1. Creates a 16 GB raw disk image
2. Partitions GPT — 512 MB ESP + remainder ext4 rootfs
3. Bootstraps Ubuntu 24.04 LTS (noble) into the rootfs via `mmdebstrap`
4. Installs base packages: kernel 6.8+, GRUB EFI, SSH, build toolchain, Vulkan
5. Overlays Coastal branding from `os/node/files/`
6. Adds the **kisak PPA** for Mesa 26.x (required for gfx1013)
7. Configures GRUB cmdline (removes deprecated `amdgpu.gttsize`)
8. Installs and enables the `coastal-os-first-boot` systemd unit
9. Pre-points apt at the `origin/apt` lane (URL placeholder until published)

Expected runtime: 10–25 min on a fast host, mostly bound by the apt fetch.

## Step 4 — drop a public SSH key into the image

The image creates a `coastal` user with a **locked password** (key-only login). Before flashing, add your pubkey:

```bash
# Mount the image
sudo losetup --show -fP coastal-os-v0.0.1-bc250.img
# (note the loop device name, e.g. /dev/loop0)
sudo mkdir -p /mnt/coastal
sudo mount /dev/loop0p2 /mnt/coastal
sudo mkdir -p /mnt/coastal/home/coastal/.ssh
sudo cp ~/.ssh/id_ed25519.pub /mnt/coastal/home/coastal/.ssh/authorized_keys
sudo chown -R 1000:1000 /mnt/coastal/home/coastal/.ssh
sudo chmod 700 /mnt/coastal/home/coastal/.ssh
sudo chmod 600 /mnt/coastal/home/coastal/.ssh/authorized_keys
sudo umount /mnt/coastal
sudo losetup -d /dev/loop0
```

Phase 3 (`v0.1`) replaces this manual step with the bootstrap wizard.

## Step 5 — flash the image to a BC-250's NVMe

Attach the NVMe via USB-to-M.2 adapter, identify the device:

```bash
lsblk      # find the NVMe — e.g. /dev/sdb (USB-attached) or /dev/nvme1n1
```

**Triple-check the target device — `dd` to the wrong one destroys data.**

```bash
sudo dd if=coastal-os-v0.0.1-bc250.img of=/dev/sdb bs=4M status=progress conv=fsync
sync
```

## Step 6 — install the NVMe and boot the BC-250

1. Install the flashed NVMe into a BC-250 sled.
2. Power on the chassis (or just that sled).
3. The first-boot service runs automatically — it:
   - Sets hostname based on the MAC suffix (`coastal-XXXX`)
   - Clones and builds the **cyan-skillfish-governor** against the actual gfx1013 SMU
   - Clones and builds **llama.cpp-bc250** against the local Vulkan stack
   - Symlinks `coastal-os-bench` into `/usr/local/bin`
   - Seals the first-boot guard (`/var/lib/coastal/.first-boot-complete`)
4. First boot takes 10–20 min on the BC-250 (most of it building llama.cpp). Watch via:
   ```bash
   ssh coastal@coastal-XXXX
   journalctl -u coastal-os-first-boot --no-pager -f
   ```

## Step 7 — bench

```bash
# On the BC-250 itself:
# Drop a 9B Q4_K_M model into /var/lib/coastal/models/
# (e.g. download from HuggingFace)
coastal-os-bench --quiet | jq .
```

Expected result (per `TechMakesArt/llama.cpp-bc250` published numbers):

```json
{
  "schema": "coastal-os-bench/v1",
  "model": "qwen3.5-9b-instruct-q4_k_m.gguf",
  "input_tokens": 2048,
  "output_tokens": 512,
  "generation_tok_s": 54.99,
  "prompt_processing_ms": 6692,
  "peak_vram_mb": 8000,
  ...
}
```

That's the Phase 0 gate cleared.

## What's NOT in v0.0.1 (lands in v0.1 / Phase 3)

- First-boot wizard (interactive setup; v0.0.1 uses pre-baked configs)
- Role picker (v0.0.1 has no role concept — all nodes are equal)
- Cluster auto-join (v0.0.1 nodes are standalone)
- Read-only root + overlayfs (v0.0.1 is fully writable)
- Model download automation (v0.0.1 expects you to drop the file in)
- Mission control UI integration

## Open issues to resolve during first BC-250 bring-up

These are the things the recipe can't be sure about without real hardware:

- [ ] **`cyan-skillfish-governor` build steps on Ubuntu 24.04.** The upstream is packaged for Bazzite (Fedora). The first-boot script tries `make` and `make install`; if the upstream layout differs, adjust accordingly and propose a `.deb` package upstream.
- [ ] **`llama.cpp-bc250` Vulkan build on the BC-250's exact Mesa version.** Should succeed with Mesa 26.x from kisak PPA; verify.
- [ ] **`rocm-smi` availability** — the bench script optionally samples power via `rocm-smi`. ROCm 6+ for gfx1013 may not be present in the base image; either install `rocm-smi-lib` separately or fall back to `/sys/class/drm/card0/device/hwmon/` parsing.
- [ ] **`origin/apt` lane URL** — currently placeholder in the apt source. Resolve when the lane publishes its first `.deb`.

Park answers here as they're confirmed.

## Iteration loop

The expected workflow for refining v0.0.1:

1. Build the image on the Linux host.
2. Flash, boot, watch the first-boot log.
3. Capture any failures.
4. Edit `build-image.sh` or `files/usr/local/sbin/coastal-os-first-boot` to fix.
5. Rebuild, re-flash, re-boot.
6. Once first-boot completes clean → run `coastal-os-bench` → record the number → call Phase 0 cleared.

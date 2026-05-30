#!/usr/bin/env bash
# build-image.sh — produce coastal-os-v0.0.1-bc250.img
#
# Runs on a Linux host (Ubuntu 24.04 recommended, WSL2 works). Produces
# a flashable raw NVMe image with Ubuntu 24.04 + Coastal branding +
# the gfx1013 inference stack scaffolding.
#
# This is the v0.0.1 image — minimal, single-purpose. v0.1 (Phase 3)
# adds the bootstrap wizard.
#
# Status: alpha. Reads cleanly as a recipe; first end-to-end execution
# needs to happen on a real BC-250 + Linux host. Until then, treat each
# stage as a documented step the user can run interactively to iterate.
#
# Usage:
#   sudo ./build-image.sh                           # builds to ./out/coastal-os-v0.0.1-bc250.img
#   sudo ./build-image.sh --output /path/to/foo.img
#   sudo ./build-image.sh --size-gb 32              # default 16
#
# Required on host:
#   mmdebstrap, qemu-utils, parted, e2fsprogs, dosfstools, kpartx
#   Install: sudo apt install -y mmdebstrap qemu-utils parted dosfstools kpartx
#
# Architecture: x86_64 only (BC-250 is x86_64).

set -euo pipefail

# ─── defaults ────────────────────────────────────────────────────────

OUTPUT="${OUTPUT:-./out/coastal-os-v0.0.1-bc250.img}"
SIZE_GB=16
DISTRO="ubuntu"
SUITE="noble"  # Ubuntu 24.04 LTS
MIRROR="http://archive.ubuntu.com/ubuntu"
COASTAL_OS_VERSION="0.0.1"
HOSTNAME_PATTERN="coastal-XXXX"  # XXXX replaced with mac-suffix at first boot

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILES_DIR="$SCRIPT_DIR/files"

# ─── argparse ────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)    OUTPUT="$2"; shift 2;;
    --size-gb)   SIZE_GB="$2"; shift 2;;
    --suite)     SUITE="$2"; shift 2;;
    -h|--help)
      sed -n '2,24p' "$0"
      exit 0;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

# ─── preflight ───────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root (uses mount, kpartx, debootstrap)." >&2
  exit 1
fi

for cmd in mmdebstrap qemu-img parted mkfs.ext4 mkfs.vfat kpartx; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    echo "Install: sudo apt install -y mmdebstrap qemu-utils parted dosfstools kpartx" >&2
    exit 1
  fi
done

if [[ ! -d "$FILES_DIR" ]]; then
  echo "Missing files directory: $FILES_DIR" >&2
  echo "This script expects coastal-os/image/files/ to exist alongside it." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"

log() { echo "[build-image] $*" >&2; }

# ─── 1. create raw image, partition, format ──────────────────────────

log "creating ${SIZE_GB}GB raw image at $OUTPUT"
qemu-img create -f raw "$OUTPUT" "${SIZE_GB}G" >/dev/null

log "partitioning (GPT: 512MB ESP + remainder rootfs)"
parted -s "$OUTPUT" mklabel gpt
parted -s "$OUTPUT" mkpart ESP fat32 1MiB 513MiB
parted -s "$OUTPUT" set 1 esp on
parted -s "$OUTPUT" mkpart primary ext4 513MiB 100%

log "attaching via kpartx for partition access"
LOOPDEV=$(losetup --show -fP "$OUTPUT")
trap 'losetup -d "$LOOPDEV" 2>/dev/null || true' EXIT

# Wait for partitions to appear
sleep 1
ESP_PART="${LOOPDEV}p1"
ROOT_PART="${LOOPDEV}p2"

mkfs.vfat -F32 -n COASTAL_ESP "$ESP_PART" >/dev/null
mkfs.ext4 -L coastal_root -q "$ROOT_PART"

# ─── 2. mount and bootstrap ──────────────────────────────────────────

MNT=$(mktemp -d)
trap 'umount -R "$MNT" 2>/dev/null || true; rm -rf "$MNT"; losetup -d "$LOOPDEV" 2>/dev/null || true' EXIT

mount "$ROOT_PART" "$MNT"
mkdir -p "$MNT/boot/efi"
mount "$ESP_PART" "$MNT/boot/efi"

log "bootstrapping $DISTRO $SUITE via mmdebstrap (this is the slow step)"
mmdebstrap \
  --variant=standard \
  --include="linux-image-generic,grub-efi-amd64,openssh-server,vim,curl,wget,ca-certificates,gnupg,lsb-release,git,build-essential,cmake,pkg-config,libvulkan-dev,vulkan-tools,mesa-vulkan-drivers,libcurl4-openssl-dev,dkms,jq" \
  --components=main,universe,multiverse,restricted \
  --architecture=amd64 \
  "$SUITE" \
  "$MNT" \
  "$MIRROR"

# ─── 3. overlay coastal-branded files into the rootfs ────────────────

log "overlaying Coastal branding + config files from $FILES_DIR"
cp -av "$FILES_DIR/." "$MNT/"

# ─── 4. configure inside the chroot ──────────────────────────────────

log "configuring inside chroot"
mount -t proc /proc "$MNT/proc"
mount --rbind /sys "$MNT/sys"
mount --rbind /dev "$MNT/dev"

cat > "$MNT/etc/hostname" <<EOF
$HOSTNAME_PATTERN
EOF

# Add kisak PPA for Mesa 26.x (required for gfx1013 perf)
chroot "$MNT" /bin/bash <<'CHROOT_EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# kisak PPA — Mesa 26.x stable on Ubuntu 24.04
apt install -y software-properties-common
add-apt-repository -y ppa:kisak/kisak-mesa
apt update
apt upgrade -y mesa-vulkan-drivers libvulkan1 vulkan-tools

# Enable systemd services
systemctl enable ssh
systemctl enable coastal-os-first-boot.service

# Set GRUB cmdline (REMOVE deprecated amdgpu.gttsize, ensure iommu=pt)
sed -i 's|amdgpu\.gttsize=[0-9]*||g' /etc/default/grub
if ! grep -q 'iommu=pt' /etc/default/grub; then
  sed -i 's|GRUB_CMDLINE_LINUX_DEFAULT="|GRUB_CMDLINE_LINUX_DEFAULT="iommu=pt |' /etc/default/grub
fi

# Install GRUB to the ESP
grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=coastal-os --removable
update-grub

# Create coastal user (passwordless sudo for v0.0.1; first-boot wizard rotates)
useradd -m -s /bin/bash -G sudo coastal
echo 'coastal ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/coastal
chmod 0440 /etc/sudoers.d/coastal

# Set root password to disabled (SSH key only — keys land at first boot)
passwd -l root
passwd -l coastal

# /var/lib/coastal layout
mkdir -p /var/lib/coastal/models /var/lib/coastal/logs
chown -R coastal:coastal /var/lib/coastal

# Apt source for the origin/apt lane (placeholder URL — replace when published)
cat > /etc/apt/sources.list.d/coastal-ai.list <<'APT_EOF'
# Coastal.AI apt lane — see https://github.com/CoastalCrypto/Coastal.AI/tree/apt
# deb [signed-by=/usr/share/keyrings/coastal-ai-archive-keyring.gpg] https://apt.coastal.ai/ubuntu noble main
APT_EOF

# Clean up apt caches to shrink the image
apt clean
rm -rf /var/lib/apt/lists/*
CHROOT_EOF

# ─── 5. unmount + finalize ───────────────────────────────────────────

log "unmounting + syncing"
umount -R "$MNT/proc" "$MNT/sys" "$MNT/dev" "$MNT/boot/efi" "$MNT" 2>/dev/null || true
sync
losetup -d "$LOOPDEV"
trap - EXIT

log "done — image at $OUTPUT"
log ""
log "Next steps:"
log "  1. dd this image to a BC-250 NVMe (use a USB-to-M.2 adapter on the build host,"
log "     or attach the NVMe directly):"
log "       sudo dd if=$OUTPUT of=/dev/nvmeXn1 bs=4M status=progress conv=fsync"
log "  2. Install the NVMe into a BC-250 sled"
log "  3. Power on — the first-boot service builds llama.cpp-bc250 and the SMU"
log "     governor against the actual gfx1013 hardware"
log "  4. SSH in as 'coastal' (key-only, drop your pubkey at /home/coastal/.ssh/authorized_keys"
log "     via cloud-init-style customization before flashing, OR via the first-boot"
log "     wizard once Phase 3 lands)"
log "  5. Run: coastal-os-bench --quiet | jq .generation_tok_s"

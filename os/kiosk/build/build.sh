#!/bin/bash
set -e

VERSION_ARG="${1:-}"

# Ensure live-build is installed
if ! command -v lb &> /dev/null; then
  echo "Error: live-build not installed. Run: sudo apt install live-build"
  exit 1
fi

# Capture absolute paths before any cd
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# This script lives at os/kiosk/build/, so REPO_ROOT is three levels up.
KIOSK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
BASE_DIR="${REPO_ROOT}/os/base"

# Default the version from the shared base/VERSION when no arg is given,
# so the node and desktop editions stamp the same version.
VERSION="${VERSION_ARG:-$(cat "${BASE_DIR}/VERSION" 2>/dev/null || echo dev)}"
echo "[build] Building CoastalOS ${VERSION}..."

WORKDIR="$(mktemp -d)"
cd "$WORKDIR"

# Configure live-build
lb config \
  --distribution noble \
  --archive-areas "main restricted universe multiverse" \
  --bootloader grub-efi \
  --binary-images iso \
  --iso-application "CoastalOS" \
  --iso-volume "CoastalOS-${VERSION}" \
  --bootappend-live "boot=live console=ttyS0,115200n8 console=tty0"

# Add package list
cp "${SCRIPT_DIR}/packages.list" config/package-lists/coastalos.list.chroot

# Add post-install hook (runs inside chroot)
mkdir -p config/hooks/live
cp "${SCRIPT_DIR}/hooks/post-install.sh" config/hooks/live/99-coastalos.hook.chroot
chmod +x config/hooks/live/99-coastalos.hook.chroot

# Add binary hook — patches grub.cfg to enable serial console for QEMU/CI
mkdir -p config/hooks/binary
cp "${SCRIPT_DIR}/hooks/grub-serial.hook.binary" config/hooks/binary/99-grub-serial.hook.binary
chmod +x config/hooks/binary/99-grub-serial.hook.binary

# Add labwc config
mkdir -p config/includes.chroot/tmp/labwc
cp "${KIOSK_DIR}/labwc/rc.xml"    config/includes.chroot/tmp/labwc/
cp "${KIOSK_DIR}/labwc/autostart" config/includes.chroot/tmp/labwc/

# Add waybar config
mkdir -p config/includes.chroot/opt/coastal-ai/coastalos/waybar
cp "${KIOSK_DIR}/waybar/config.jsonc" config/includes.chroot/opt/coastal-ai/coastalos/waybar/
cp "${KIOSK_DIR}/waybar/style.css"    config/includes.chroot/opt/coastal-ai/coastalos/waybar/

# Add systemd units: shared units (daemon/server/architect + timer) come from
# the shared base/, desktop-only units (shell/web/voice/vllm/airllm/infinity)
# from os/kiosk/. The only timer lives in base/, so there is no kiosk timer copy.
mkdir -p config/includes.chroot/etc/systemd/system
cp "${BASE_DIR}/systemd/"*.service      config/includes.chroot/etc/systemd/system/
cp "${BASE_DIR}/systemd/"*.timer        config/includes.chroot/etc/systemd/system/
cp "${KIOSK_DIR}/systemd/"*.service config/includes.chroot/etc/systemd/system/

# Apt lane (shared with the node edition) so coastal-ai package updates resolve.
mkdir -p config/includes.chroot/etc/apt/sources.list.d
cp "${BASE_DIR}/apt/coastal-ai.list" config/includes.chroot/etc/apt/sources.list.d/

# Build
lb build

# Find the ISO — live-build may name it binary.iso or live-image-amd64.iso
ISO_SRC="$(ls -1 *.iso 2>/dev/null | head -1)"
if [[ -z "$ISO_SRC" ]]; then
  echo "[build] ERROR: no ISO found in ${WORKDIR} after lb build"
  ls -la
  exit 1
fi

mv "$ISO_SRC" "${REPO_ROOT}/coastalos-${VERSION}.iso"
echo "[build] ISO ready: ${REPO_ROOT}/coastalos-${VERSION}.iso ($(du -h "${REPO_ROOT}/coastalos-${VERSION}.iso" | cut -f1))"

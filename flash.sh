#!/usr/bin/env bash
# flash.sh — Write CoastalOS ISO to a USB drive
# Usage: sudo ./flash.sh [iso-file] [device]
# Example: sudo ./flash.sh coastalos-0.3.0.iso /dev/sdb
set -euo pipefail

ISO="${1:-}"
DEVICE="${2:-}"

# Find latest ISO if not specified
if [ -z "$ISO" ]; then
  ISO=$(ls coastalos-*.iso 2>/dev/null | sort -V | tail -1 || true)
  [ -n "$ISO" ] || { echo "Error: no coastalos-*.iso found. Build one first with: bash os/kiosk/build/build.sh"; exit 1; }
  echo "Auto-selected ISO: $ISO"
fi

[ -f "$ISO" ] || { echo "Error: ISO not found: $ISO"; exit 1; }

# Detect USB drives if device not specified
if [ -z "$DEVICE" ]; then
  echo ""
  echo "Available removable drives:"
  echo "────────────────────────────────────────"
  lsblk -d -o NAME,SIZE,TRAN,MODEL | grep -v "loop\|sr\|NAME" || true
  echo "────────────────────────────────────────"
  echo ""
  read -rp "Enter target device (e.g. /dev/sdb) — ALL DATA WILL BE ERASED: " DEVICE
fi

# Safety checks
[ -b "$DEVICE" ] || { echo "Error: $DEVICE is not a block device. Aborting."; exit 1; }

# Warn if device looks like a system disk (heuristic: < 16GB)
SIZE_BYTES=$(blockdev --getsize64 "$DEVICE" 2>/dev/null || echo 0)
SIZE_GB=$((SIZE_BYTES / 1024 / 1024 / 1024))
ISO_BYTES=$(stat -c%s "$ISO")
[ "$ISO_BYTES" -lt "$SIZE_BYTES" ] || { echo "Error: ISO ($((ISO_BYTES/1024/1024))MB) is larger than device (${SIZE_GB}GB). Aborting."; exit 1; }

echo ""
echo "┌─────────────────────────────────────────────┐"
echo "│  CoastalOS USB Flash                        │"
echo "│  ISO:    $ISO"
echo "│  Device: $DEVICE  (${SIZE_GB}GB)"
echo "│                                             │"
echo "│  ⚠  ALL DATA ON $DEVICE WILL BE ERASED  ⚠  │"
echo "└─────────────────────────────────────────────┘"
echo ""
read -rp "Type YES (all caps) to flash: " CONFIRM
[ "$CONFIRM" = "YES" ] || { echo "Aborted."; exit 0; }

echo "[flash] Writing $ISO → $DEVICE ..."
dd if="$ISO" of="$DEVICE" bs=4M status=progress oflag=sync conv=fsync
sync

echo ""
echo "[flash] Done! Remove the USB drive and boot from it."

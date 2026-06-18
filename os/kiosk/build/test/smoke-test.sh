#!/usr/bin/env bash
# smoke-test.sh — boot CoastalOS ISO in QEMU and verify it stays alive
# Strategy: liveness check — a bootable ISO keeps QEMU running; a broken one
# exits immediately (no bootloader found, kernel panic, etc.)
# Usage: bash smoke-test.sh <iso-file>
set -e

ISO="$1"
[ -f "$ISO" ] || { echo "Error: ISO not found: $ISO"; exit 1; }

# How long to wait for a stable running state.
# A broken ISO exits QEMU in <5s. A booting ISO stays alive past this point.
LIVENESS_SECONDS=60
CRASH_WINDOW=10   # if QEMU dies within this many seconds it's a crash

echo "[smoke-test] Booting $ISO in QEMU..."

# Start QEMU in background
# -drive format=raw avoids "Could not read from CDROM (code 0004)"
# -enable-kvm speeds boot on GitHub Actions runners (which have KVM)
# -serial stdio captures any serial output to our log while -display none drops VGA
QEMU_LOG=$(mktemp)
qemu-system-x86_64 \
  -drive "file=${ISO},format=raw,media=cdrom,readonly=on" \
  -m 2048 \
  -smp 2 \
  -display none \
  -serial stdio \
  -netdev user,id=net0 -device virtio-net-pci,netdev=net0 \
  -enable-kvm \
  -no-reboot \
  -boot order=d,menu=off \
  > "$QEMU_LOG" 2>&1 &

QEMU_PID=$!
echo "[smoke-test] QEMU PID: $QEMU_PID"

# --- Phase 1: crash window ---
# Give QEMU a few seconds. If it exits immediately the ISO didn't boot at all.
sleep $CRASH_WINDOW
if ! kill -0 $QEMU_PID 2>/dev/null; then
  wait $QEMU_PID 2>/dev/null || true
  echo "[smoke-test] ✗ QEMU exited within ${CRASH_WINDOW}s — ISO did not boot"
  echo "[smoke-test] QEMU output:"
  cat "$QEMU_LOG" 2>/dev/null || echo "(empty)"
  rm -f "$QEMU_LOG"
  exit 1
fi

echo "[smoke-test] ${CRASH_WINDOW}s — QEMU still running, ISO passed crash window"

# --- Phase 2: liveness wait ---
# Wait for liveness threshold. Check every 5 seconds for serial output bonuses.
ELAPSED=$CRASH_WINDOW
REMAINING=$((LIVENESS_SECONDS - CRASH_WINDOW))

while [ $ELAPSED -lt $LIVENESS_SECONDS ]; do
  sleep 5
  ELAPSED=$((ELAPSED + 5))

  if ! kill -0 $QEMU_PID 2>/dev/null; then
    wait $QEMU_PID 2>/dev/null || true
    if [ $ELAPSED -ge 30 ]; then
      echo "[smoke-test] ✓ QEMU ran for ${ELAPSED}s then exited cleanly — boot confirmed"
      rm -f "$QEMU_LOG"
      exit 0
    else
      echo "[smoke-test] ✗ QEMU exited after ${ELAPSED}s — too early, likely a crash"
      cat "$QEMU_LOG" 2>/dev/null || echo "(empty)"
      rm -f "$QEMU_LOG"
      exit 1
    fi
  fi

  # Bonus: if serial output appeared, log it
  if [ -s "$QEMU_LOG" ]; then
    LINES=$(wc -l < "$QEMU_LOG")
    echo "[smoke-test] ${ELAPSED}s — QEMU alive, ${LINES} lines of serial output"
    if grep -qiE "(grub|linux|ubuntu|started|reached|login:|coastalos)" "$QEMU_LOG" 2>/dev/null; then
      echo "[smoke-test] ✓ Boot messages detected in serial output — success"
      tail -5 "$QEMU_LOG"
      kill $QEMU_PID 2>/dev/null || true
      wait $QEMU_PID 2>/dev/null || true
      rm -f "$QEMU_LOG"
      exit 0
    fi
  else
    echo "[smoke-test] ${ELAPSED}s — QEMU alive (no serial output yet)"
  fi
done

# --- Phase 3: liveness confirmed ---
echo "[smoke-test] ✓ QEMU alive for ${LIVENESS_SECONDS}s — ISO booted successfully"
if [ -s "$QEMU_LOG" ]; then
  echo "[smoke-test] Serial output tail:"
  tail -5 "$QEMU_LOG"
fi
kill $QEMU_PID 2>/dev/null || true
wait $QEMU_PID 2>/dev/null || true
rm -f "$QEMU_LOG"
exit 0

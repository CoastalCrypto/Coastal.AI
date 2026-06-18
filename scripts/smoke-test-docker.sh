#!/usr/bin/env bash
# smoke-test-docker.sh — build + boot Coastal.AI in Docker, verify the server starts
# Usage: bash scripts/smoke-test-docker.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="coastal-ai-smoke:local"
CONTAINER="cc-smoke-$$"
PORT=14747   # host port (mapped to 4747 inside container)
TIMEOUT=60   # seconds to wait for /health

cleanup() {
  docker rm -f "$CONTAINER" 2>/dev/null || true
}
trap cleanup EXIT

echo "[smoke] Building image from $REPO_ROOT..."
docker build \
  -f "$REPO_ROOT/os/kiosk/build/test/Dockerfile.smoke" \
  -t "$IMAGE" \
  "$REPO_ROOT"

echo "[smoke] Starting container..."
docker run -d \
  --name "$CONTAINER" \
  -p "${PORT}:4747" \
  "$IMAGE"

echo "[smoke] Waiting up to ${TIMEOUT}s for /health on :${PORT}..."
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if curl -sf "http://127.0.0.1:${PORT}/health" > /dev/null 2>&1; then
    echo "[smoke] ✓ /health responded after ${ELAPSED}s"
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  if [ $ELAPSED -ge $TIMEOUT ]; then
    echo "[smoke] ✗ /health did not respond within ${TIMEOUT}s"
    echo "--- container logs ---"
    docker logs "$CONTAINER" 2>&1 | tail -40
    exit 1
  fi
done

BASE="http://127.0.0.1:${PORT}"

echo -n "[smoke] GET /health ... "
HEALTH=$(curl -sf "$BASE/health")
echo "$HEALTH" | grep -q '"status":"ok"' && echo "✓" || { echo "✗ FAIL: $HEALTH"; exit 1; }

echo -n "[smoke] POST /api/chat ... "
# Use -s (no -f) so a 500 from a missing Ollama model doesn't fail the smoke
# test — the purpose here is to verify the server routes and responds, not
# that inference works (Ollama isn't running in the smoke container).
CHAT=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"ping","sessionId":"smoke-test"}')
CHAT_CODE=$(echo "$CHAT" | tail -1)
CHAT_BODY=$(echo "$CHAT" | head -1)
# Accept 2xx (inference worked) or 5xx (model unavailable) — reject only
# if the endpoint is completely missing (404) or server crashed (no body).
if [ -z "$CHAT_BODY" ]; then
  echo "✗ FAIL: no response body"; exit 1
elif [ "$CHAT_CODE" = "404" ]; then
  echo "✗ FAIL: 404 — endpoint missing"; exit 1
else
  echo "✓ (HTTP $CHAT_CODE)"
fi

echo -n "[smoke] GET /api/persona ... "
PERSONA=$(curl -sf "$BASE/api/persona")
echo "$PERSONA" | grep -q '"configured"' && echo "✓" || { echo "✗ FAIL: $PERSONA"; exit 1; }

echo ""
echo "[smoke] All checks passed."

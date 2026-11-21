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
# No admin session is available to this script, and every route but the
# PUBLIC_ROUTES allowlist now requires one at every bind address (see
# api/auth-policy.ts) — so the only correct response here is 401, proving
# the route is wired up and the deny-by-default gate is live. 404 (endpoint
# missing) or an empty body (server crashed) are real failures.
CHAT=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"ping","sessionId":"smoke-test"}')
CHAT_CODE=$(echo "$CHAT" | tail -1)
CHAT_BODY=$(echo "$CHAT" | head -1)
if [ -z "$CHAT_BODY" ]; then
  echo "✗ FAIL: no response body"; exit 1
elif [ "$CHAT_CODE" = "404" ]; then
  echo "✗ FAIL: 404 — endpoint missing"; exit 1
elif [ "$CHAT_CODE" != "401" ]; then
  echo "✗ FAIL: expected 401 (unauthenticated), got $CHAT_CODE — $CHAT_BODY"; exit 1
else
  echo "✓ (HTTP 401 — auth required, route reachable)"
fi

echo -n "[smoke] GET /api/persona ... "
# Same deny-by-default gate as above — unauthenticated, so 401 is the only
# correct response.
PERSONA=$(curl -s -w "\n%{http_code}" "$BASE/api/persona")
PERSONA_CODE=$(echo "$PERSONA" | tail -1)
PERSONA_BODY=$(echo "$PERSONA" | head -1)
if [ "$PERSONA_CODE" = "404" ]; then
  echo "✗ FAIL: 404 — endpoint missing"; exit 1
elif [ "$PERSONA_CODE" != "401" ]; then
  echo "✗ FAIL: expected 401 (unauthenticated), got $PERSONA_CODE — $PERSONA_BODY"; exit 1
else
  echo "✓ (HTTP 401 — auth required, route reachable)"
fi

echo ""
echo "[smoke] All checks passed."

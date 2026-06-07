#!/usr/bin/env bash
# Executable staging smoke checks. Requires CALADDIN_BASE_URL; CALADDIN_API_KEY for job routes.
set -euo pipefail

BASE="${CALADDIN_BASE_URL:-}"
API_KEY="${CALADDIN_API_KEY:-}"

if [[ -z "$BASE" ]]; then
  echo "FAIL: Set CALADDIN_BASE_URL (e.g. https://caladdin-staging.onrender.com)"
  exit 1
fi

BASE="${BASE%/}"
PASS=0
FAIL=0

check() {
  local name="$1"
  shift
  if "$@"; then
    echo "[PASS] $name"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] $name"
    FAIL=$((FAIL + 1))
  fi
}

health_ok() {
  local body status
  body=$(curl -sS -w "\n%{http_code}" "$BASE/health")
  status=$(echo "$body" | tail -n1)
  body=$(echo "$body" | sed '$d')
  [[ "$status" == "200" ]] && echo "$body" | grep -q '"status":"ok"'
}

auth_start_redirects() {
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/auth/start")
  [[ "$code" == "302" || "$code" == "301" ]]
}

static_root() {
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/")
  [[ "$code" == "200" || "$code" == "302" ]]
}

jobs_session_expiry() {
  if [[ -z "$API_KEY" ]]; then
    echo "SKIP: CALADDIN_API_KEY not set"
    return 0
  fi
  local status
  status=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/jobs/session-expiry" \
    -H "x-api-key: $API_KEY")
  [[ "$status" == "200" ]]
}

jobs_rejects_bad_key() {
  local status
  status=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/jobs/reminders" \
    -H "x-api-key: invalid-key-smoke-test")
  [[ "$status" == "401" ]]
}

csrf_blocks_unauthenticated_mutation() {
  local status
  status=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/voice" \
    -H "Content-Type: application/json" \
    -H "Cookie: caladdin_session=fake.session.token" \
    -d '{"utterance":"hello"}')
  [[ "$status" == "403" ]]
}

echo "Smoke test target: $BASE"
echo "---"

check "GET /health returns 200 ok" health_ok
check "GET /auth/start redirects" auth_start_redirects
check "GET / serves app" static_root
check "POST /jobs/session-expiry with API key" jobs_session_expiry
check "POST /jobs/reminders rejects bad API key" jobs_rejects_bad_key
check "POST /voice rejects missing CSRF when session present" csrf_blocks_unauthenticated_mutation

echo "---"
echo "Results: $PASS passed, $FAIL failed"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi

echo "All automated smoke checks passed."

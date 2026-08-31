#!/usr/bin/env bash
# Required-args + DB-connection failure contract for
# scripts/audit/booking-reconciliation.mjs.
#
# Asserts every documented "the CLI cannot proceed" path exits with the
# precise code and human-readable error documented in the --help text and
# scripts/audit/README.md → "CI interpretation":
#
#   exit 2 → usage / required-arg failures (no DB call)
#   exit 3 → infrastructure failure: psql missing or DB unreachable
#
# Exit 0/1/2 happy/drift/strict scenarios are covered by cli-exit-codes.sh;
# this file specifically pins the messages so a wording regression in the
# operator-facing errors is caught in CI.

set -u
SCRIPT="scripts/audit/booking-reconciliation.mjs"
fail=0
n=0

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Shared exit-code summary helper (buckets reuse $TMP).
# shellcheck source=_lib/exit-summary.sh
source "$(dirname "$0")/_lib/exit-summary.sh"
SUMMARY_TMP="$TMP"
summary_init

assert_exit_and_match() {
  local desc="$1" expected_code="$2" pattern="$3" actual_code="$4" out="$5"
  n=$((n+1))
  local ok=1
  if [ "$actual_code" != "$expected_code" ]; then
    echo "✗ [$n] $desc — expected exit $expected_code, got $actual_code"
    echo "----- output -----"; echo "$out"; echo "------------------"
    fail=$((fail+1))
    ok=0
  elif ! grep -qE -- "$pattern" <<<"$out"; then
    echo "✗ [$n] $desc — exit $expected_code OK but missing /$pattern/"
    echo "----- output -----"; echo "$out"; echo "------------------"
    fail=$((fail+1))
    # Bucket under the expected code with a missing-pattern note so the
    # summary makes the wording regression visible.
    summary_record "$expected_code" "$expected_code" "$desc (missing /$pattern/) ✗"
    return
  fi
  if [ "$ok" -eq 1 ]; then
    echo "✓ [$n] $desc (exit $actual_code, matched /$pattern/)"
  fi
  summary_record "$expected_code" "$actual_code" "$desc"
}


# ─────────────────────────────────────────────────────────────────────────
# Required-arg failures — exit 2 with a specific message
# ─────────────────────────────────────────────────────────────────────────

# 1) no booking id at all
out=$(node "$SCRIPT" 2>&1); code=$?
assert_exit_and_match "no args → exit 2 + 'missing booking id'" \
  2 "missing booking id" "$code" "$out"

# 2) --booking provided without a value
out=$(node "$SCRIPT" --booking 2>&1); code=$?
assert_exit_and_match "--booking with no value → exit 2 + 'requires a value'" \
  2 "--booking requires a value" "$code" "$out"

# 3) --expectations provided without a value
out=$(node "$SCRIPT" --expectations 2>&1); code=$?
assert_exit_and_match "--expectations with no value → exit 2 + 'requires a value'" \
  2 "--expectations requires a value" "$code" "$out"

# 4) malformed booking id (regex reject before any DB call)
out=$(node "$SCRIPT" bk-ma-00014 2>&1); code=$?
assert_exit_and_match "lowercase id → exit 2 + 'invalid booking id'" \
  2 "invalid booking id" "$code" "$out"

# 5) valid id format but no pinned snapshot (strict default)
out=$(node "$SCRIPT" BK-XX-99999 2>&1); code=$?
assert_exit_and_match "missing pin (strict) → exit 2 + path hint" \
  2 "expectations file not found.*BK-XX-99999\\.json" "$code" "$out"

# 6) unknown flag
out=$(node "$SCRIPT" --bogus 2>&1); code=$?
assert_exit_and_match "unknown flag → exit 2 + 'unknown argument'" \
  2 "unknown argument" "$code" "$out"

# ─────────────────────────────────────────────────────────────────────────
# DB connection failure — exit 3 with a human-readable diagnostic
# ─────────────────────────────────────────────────────────────────────────
# Scenario A: psql is missing from PATH entirely.
# We can't simply blank PATH (node itself must remain resolvable), so we
# build a sandbox PATH that contains only `node` and explicitly nothing
# else — psql lookup then fails inside execSync.

NODE_BIN=$(command -v node)
SANDBOX="$TMP/path-without-psql"
mkdir -p "$SANDBOX"
ln -sf "$NODE_BIN" "$SANDBOX/node"

# Use a pinned booking that has a real expectations file so the script
# gets past schema validation and actually attempts to call psql.
PINNED_ID="BK-MA-00014"
test -f "scripts/audit/expectations/${PINNED_ID}.json" || {
  echo "✗ pre-req: scripts/audit/expectations/${PINNED_ID}.json must exist"
  exit 1
}

out=$(PATH="$SANDBOX" "$NODE_BIN" "$SCRIPT" "$PINNED_ID" 2>&1); code=$?
assert_exit_and_match "psql missing from PATH → exit 3 + 'database connection failed'" \
  3 "database connection failed" "$code" "$out"
assert_exit_and_match "psql-missing error mentions SUPABASE_DB_URL / PGHOST remedy" \
  3 "SUPABASE_DB_URL.*PGHOST" "$code" "$out"

# Scenario B: psql is on PATH but every invocation fails (unreachable DB).
# Stub psql as a script that always exits 2 with a connection error on
# stderr — mimics `psql: error: connection to server ... failed`.
cat >"$SANDBOX/psql" <<'PSQL_STUB'
#!/bin/sh
echo "psql: error: connection to server at \"db.invalid\" failed: timeout" >&2
exit 2
PSQL_STUB
chmod +x "$SANDBOX/psql"

out=$(PATH="$SANDBOX" "$NODE_BIN" "$SCRIPT" "$PINNED_ID" 2>&1); code=$?
assert_exit_and_match "psql connection failure → exit 3 + 'database connection failed'" \
  3 "database connection failed" "$code" "$out"
assert_exit_and_match "exit-3 message surfaces underlying psql stderr line" \
  3 "psql: .*connection to server" "$code" "$out"

# Scenario C: exit 3 must NOT be confused with exit 1 (drift). A drift
# would imply the audit ran and disagreed; a connection failure means it
# never ran. Pin the contract that they are different integers.
n=$((n+1))
if [ "$code" = "1" ]; then
  echo "✗ [$n] exit 3 must be distinct from exit 1 (drift) — got 1"
  fail=$((fail+1))
  summary_record 3 1 "DB failure exit code must differ from drift"
else
  echo "✓ [$n] DB failure exit code ($code) is distinct from drift code (1)"
  summary_record "$code" "$code" "DB failure exit code ($code) is distinct from drift code (1)"
fi

# --- Summary by exit code ------------------------------------------------
# Rendered by the shared helper (see _lib/exit-summary.sh). This file's
# contract is exit 2 (usage) and exit 3 (infrastructure); 0/1 are listed
# for shape parity with the sibling suites so reviewers see at a glance
# which exit codes each test file does or does not exercise.
summary_print 0 1 2 3

if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n required-args / DB-connection assertion(s) failed."
  exit 1
fi
echo "✓ All $n required-args / DB-connection assertions passed."


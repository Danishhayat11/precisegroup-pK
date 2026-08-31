#!/usr/bin/env bash
# Exit-code contract for scripts/audit/booking-reconciliation.mjs.
#
# Verifies all three documented exit codes against representative scenarios
# without requiring a real database — `psql` is stubbed on PATH and returns
# fixtures keyed by the SQL the auditor issues.
#
#   • 0  → live totals match the pinned expectations (happy path)
#   • 0  → missing expectations file under --no-strict (warn-mode)
#   • 0  → missing expectations file under AUDIT_STRICT=0 (env warn-mode)
#   • 1  → live data drifts from the pinned expectations (diff printed)
#   • 2  → missing expectations file under default/strict mode
#   • 2  → invalid booking id format
#
# `--help` (exit 0) and other usage-error exit-2 paths are covered by
# cli-contract.sh; this file focuses on the runtime exit codes that depend
# on data comparison.

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

# --- Stub psql -----------------------------------------------------------
# The auditor calls:
#   psql -At -F"|" -c "SELECT ... FROM bookings WHERE booking_id='BK-...'"
#   psql -At -F"|" -c "SELECT ... FROM installment_ledger WHERE ..."
# The stub matches on the SQL substring and emits matching pipe-delimited rows.
# Set FIXTURE_VARIANT=ok|drift to switch the returned cached/ledger values.
cat >"$TMP/psql" <<'PSQL_STUB'
#!/usr/bin/env bash
# Extract the SQL passed via `-c "<sql>"` (last argument after -c).
sql=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-c" ]; then sql="$2"; shift 2; continue; fi
  shift
done

variant="${FIXTURE_VARIANT:-ok}"

case "$sql" in
  *"FROM bookings"*)
    # cash_received|remaining_balance|total_contract_value|current_overdue_count|total_overdue_amount
    if [ "$variant" = "drift" ]; then
      echo "999999|100|1000000|2|500"
    else
      echo "1000000|0|1000000|0|0"
    fi
    ;;
  *"FROM installment_ledger"*)
    # particulars|due_amount|paid_amount|due_date
    # Two installments fully paid → cash_received=1,000,000, remaining=0.
    echo "Installment 1|500000|500000|2024-01-01"
    echo "Installment 2|500000|500000|2024-02-01"
    ;;
  *) ;;
esac
PSQL_STUB
chmod +x "$TMP/psql"
export PATH="$TMP:$PATH"

# --- Pinned expectations fixture -----------------------------------------
FIX_DIR="$TMP/expectations"
mkdir -p "$FIX_DIR"
cat >"$FIX_DIR/BK-TS-00001.json" <<'JSON'
{
  "booking_id": "BK-TS-00001",
  "label": "Synthetic happy-path fixture",
  "expected": {
    "cash_received": 1000000,
    "remaining_balance": 0,
    "total_contract_value": 1000000,
    "installments_paid": 1000000,
    "possession_paid": 0,
    "down_payment_paid": 0,
    "current_overdue_count": 0,
    "total_overdue_amount": 0
  }
}
JSON


# --- Fixture pre-flight --------------------------------------------------
# Before exercising the CLI, prove the synthetic fixture itself is sound:
#   • schema-valid per expectations-schema.mjs
#   • cash_received = 1,000,000 (the "full split" the stub returns)
#   • down_payment + installments + possession sums to that 1,000,000
#   • installments_paid + possession_paid breakdown matches the stub's ledger
#     rows (two 500,000 installments, zero possession) so a drift in either
#     side of the test surfaces here instead of as a confusing CLI failure.
echo "── fixture pre-flight ──"
preflight=$(node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  import { validateExpectations } from './scripts/audit/expectations-schema.mjs';
  const path = '$FIX_DIR/BK-TS-00001.json';
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const { valid, errors } = validateExpectations(doc, { source: path, expectedBookingId: 'BK-TS-00001' });
  if (!valid) { console.error('schema:\n  • ' + errors.join('\n  • ')); process.exit(1); }
  const e = doc.expected;
  const assertEq = (name, a, b) => {
    if (a !== b) { console.error(name + ': expected ' + b + ', got ' + a); process.exit(1); }
  };
  assertEq('cash_received', e.cash_received, 1_000_000);
  assertEq('total_contract_value', e.total_contract_value, 1_000_000);
  assertEq('split sum', e.down_payment_paid + e.installments_paid + e.possession_paid, 1_000_000);
  assertEq('installments_paid (matches 2x 500k ledger rows)', e.installments_paid, 1_000_000);
  assertEq('possession_paid (no possession row in stub)', e.possession_paid, 0);
  assertEq('down_payment_paid (no DP row in stub)', e.down_payment_paid, 0);
  assertEq('remaining_balance', e.remaining_balance, 0);
  console.log('ok');
" 2>&1)
if [ "$preflight" != "ok" ]; then
  echo "✗ fixture pre-flight failed:"
  echo "$preflight"
  exit 1
fi
echo "✓ fixture pre-flight passed (1,000,000 split + installments/possession breakdown)"
echo

assert_exit() {
  local desc="$1" expected="$2" actual="$3" out="$4"
  n=$((n+1))
  if [ "$actual" != "$expected" ]; then
    echo "✗ [$n] $desc — expected exit $expected, got $actual"
    echo "----- output -----"; echo "$out"; echo "------------------"
    fail=$((fail+1))
  else
    echo "✓ [$n] $desc (exit $actual)"
  fi
  summary_record "$expected" "$actual" "$desc"
}

run() {
  # $1 = variant, rest = args. Captures combined stdout+stderr.
  local variant="$1"; shift
  FIXTURE_VARIANT="$variant" node "$SCRIPT" --expectations "$FIX_DIR/BK-TS-00001.json" "$@" 2>&1
}

# 1) exit 0 — happy path, live matches expectations
out=$(run ok); code=$?
assert_exit "happy path → exit 0" 0 "$code" "$out"

# 2) exit 1 — drift, cached bookings row disagrees with expectations
out=$(FIXTURE_VARIANT=drift node "$SCRIPT" --expectations "$FIX_DIR/BK-TS-00001.json" 2>&1); code=$?
assert_exit "live/cached drift → exit 1" 1 "$code" "$out"

# 3) exit 2 — missing expectations file under default (strict) mode
out=$(node "$SCRIPT" BK-XX-99999 2>&1); code=$?
assert_exit "missing expectations (strict) → exit 2" 2 "$code" "$out"

# 4) exit 0 — same missing file under --no-strict
out=$(node "$SCRIPT" BK-XX-99999 --no-strict 2>&1); code=$?
assert_exit "missing expectations (--no-strict) → exit 0" 0 "$code" "$out"
if ! grep -q "::warning" <<<"$out"; then
  echo "✗ [$n] expected ::warning annotation under --no-strict"
  echo "$out"
  fail=$((fail+1))
fi

# 5) exit 0 — same missing file under AUDIT_STRICT=0
out=$(AUDIT_STRICT=0 node "$SCRIPT" BK-XX-99999 2>&1); code=$?
assert_exit "missing expectations (AUDIT_STRICT=0) → exit 0" 0 "$code" "$out"

# 6) exit 2 — invalid booking id format (no DB call)
out=$(node "$SCRIPT" not-a-real-id 2>&1); code=$?
assert_exit "invalid booking id format → exit 2" 2 "$code" "$out"

# 7) exit 2 — explicit --strict overrides AUDIT_STRICT=0
out=$(AUDIT_STRICT=0 node "$SCRIPT" BK-XX-99999 --strict 2>&1); code=$?
assert_exit "--strict overrides AUDIT_STRICT=0 → exit 2" 2 "$code" "$out"

# --- Summary by exit code ------------------------------------------------
# Grouping is rendered by the shared helper so every audit test script
# emits an identical "── Exit-code summary ──" block (labels mirror
# scripts/audit/README.md → "CI interpretation").
summary_print 0 1 2

if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n exit-code assertion(s) failed."
  exit 1
fi
echo "✓ All $n exit-code assertions passed."

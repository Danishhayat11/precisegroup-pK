#!/usr/bin/env bash
# Negative-path + bucket-coverage tests for summary-format.sh.
#
# Complements _lib/summary-format.fail-artifact.sh (which proves the
# artifact layout for ONE broken-suite scenario) by sweeping the
# auto-discovery validator across the catalogue of contract violations
# it is supposed to catch. Each scenario builds a fresh isolated mirror
# of scripts/audit/tests/ containing exactly one broken fixture suite,
# runs summary-format.sh with SUMMARY_FORMAT_SKIP_PINNED=1 so only the
# auto-discovery layer is exercised, and asserts:
#
#   - summary-format.sh exits 1 (mismatch detected, not 0 or 2)
#   - FAILURES.md names the broken suite
#   - FAILURES.md carries the exact reason substring documented in the
#     record_failure() call inside summary-format.sh
#
# Scenarios covered:
#   1) Missing canonical bucket          — only 0/1 emitted, no exit 2
#                                          (bucket-coverage gate)
#   2) Canonical buckets out of order    — 2 printed before 1
#                                          (bucket-coverage ordering gate)
#   3) Malformed bucket body             — label present, body line is
#                                          neither ✓ / ✗ / (no scenarios)
#   4) Missing exit-summary header       — suite emits no header at all
#                                          (smoke-equivalent of fail-artifact;
#                                          kept here so all negative paths
#                                          live in one place)
#
# Lives under _lib/ so summary-format.sh's own auto-discovery does NOT
# pick this file up — same defence-in-depth rationale as the other
# meta-tests in this directory.

set -u

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
REAL_TESTS="$ROOT/scripts/audit/tests"

n=0
fail=0
pass()  { n=$((n+1)); echo "  ✓ [$n] $1"; }
xfail() { n=$((n+1)); fail=$((fail+1)); echo "  ✗ [$n] $1"; }

# Build an isolated fixture tree containing exactly one fixture suite.
# Echoes the fixture root on stdout. The caller is responsible for rm -rf
# after assertions finish.
mk_fixture() {
  local suite_basename="$1" suite_body="$2"
  local fix
  fix=$(mktemp -d -t summary-format-negative.XXXXXX)
  local fix_tests="$fix/scripts/audit/tests"
  local fix_lib="$fix_tests/_lib"
  mkdir -p "$fix_lib" "$fix/out"
  cp "$REAL_TESTS/_lib/exit-summary.sh"     "$fix_lib/exit-summary.sh"
  cp "$REAL_TESTS/_lib/suite-discovery.sh"  "$fix_lib/suite-discovery.sh"
  cp "$REAL_TESTS/summary-format.sh"        "$fix_tests/summary-format.sh"
  chmod +x "$fix_tests/summary-format.sh"
  printf '%s\n' "$suite_body" >"$fix_tests/$suite_basename"
  chmod +x "$fix_tests/$suite_basename"
  printf '%s' "$fix"
}

# Run the fixture's summary-format.sh and assert exit == 1 + reason in
# FAILURES.md. $1 = scenario label, $2 = fixture root, $3 = suite basename,
# $4 = expected reason substring (verbatim from record_failure call).
run_scenario() {
  local label="$1" fix="$2" suite="$3" reason="$4"
  local sf_log="$fix/summary-format.stdout.log"
  local rc
  set +e
  SUMMARY_FORMAT_SKIP_PINNED=1 \
  SUMMARY_FAILURE_DIR="$fix/out" \
    bash "$fix/scripts/audit/tests/summary-format.sh" >"$sf_log" 2>&1
  rc=$?
  set -e

  if [ "$rc" -eq 1 ]; then
    pass "$label — summary-format.sh exited 1 (mismatch detected)"
  else
    xfail "$label — summary-format.sh exited $rc (expected 1)"
    echo "    --- captured stdout+stderr (first 60 lines) ---"
    sed -n '1,60p' "$sf_log" | sed 's/^/    /'
  fi

  local failures="$fix/out/FAILURES.md"
  if [ ! -f "$failures" ]; then
    xfail "$label — FAILURES.md missing from artifact dir"
    return
  fi
  if grep -qF "scripts/audit/tests/$suite" "$failures"; then
    pass "$label — FAILURES.md names the broken suite ($suite)"
  else
    xfail "$label — FAILURES.md does not reference $suite"
  fi
  if grep -qF -- "$reason" "$failures"; then
    pass "$label — FAILURES.md carries the documented reason text"
  else
    xfail "$label — FAILURES.md missing reason substring: $reason"
    echo "    --- FAILURES.md (first 40 lines) ---"
    sed -n '1,40p' "$failures" | sed 's/^/    /'
  fi
}

echo "── summary-format.sh negative + bucket-coverage tests ──"

# ── Scenario 1: missing canonical bucket (no exit 2) ────────────────
FIX1=$(mk_fixture "missing-bucket-2.sh" "$(cat <<'SUITE'
#!/usr/bin/env bash
# Fixture: only emits buckets for exit 0 and 1. summary-format.sh's
# auto-discovery requires the canonical 0/1/2 triplet.
set -u
echo "── Exit-code summary ──"
echo "exit 0 — pass:"
echo "  ✓ scenario A"
echo "exit 1 — drift:"
echo "  ✓ scenario B"
SUITE
)")
run_scenario "missing canonical bucket" "$FIX1" "missing-bucket-2.sh" \
  "missing canonical bucket for exit 2 (auto-discovery requires 0/1/2 coverage)"
rm -rf "$FIX1"

# ── Scenario 2: canonical buckets emitted out of order ──────────────
FIX2=$(mk_fixture "out-of-order.sh" "$(cat <<'SUITE'
#!/usr/bin/env bash
# Fixture: emits 0, then 2, then 1 — violates required ascending order.
set -u
echo "── Exit-code summary ──"
echo "exit 0 — pass:"
echo "  ✓ scenario A"
echo "exit 2 — strict missing pin:"
echo "  ✓ scenario C"
echo "exit 1 — drift:"
echo "  ✓ scenario B"
SUITE
)")
run_scenario "buckets out of order" "$FIX2" "out-of-order.sh" \
  "canonical buckets 0/1/2 out of order"
rm -rf "$FIX2"

# ── Scenario 3: malformed bucket body (no ✓/✗/(no scenarios) line) ──
FIX3=$(mk_fixture "malformed-body.sh" "$(cat <<'SUITE'
#!/usr/bin/env bash
# Fixture: every bucket header is followed by a free-form line that
# matches none of the recognised body shapes.
set -u
echo "── Exit-code summary ──"
echo "exit 0 — pass:"
echo "  some unstructured prose that is not a recognised body line"
echo "exit 1 — drift:"
echo "  some unstructured prose that is not a recognised body line"
echo "exit 2 — strict missing pin:"
echo "  some unstructured prose that is not a recognised body line"
SUITE
)")
run_scenario "malformed bucket body" "$FIX3" "malformed-body.sh" \
  "bucket body missing/malformed"
rm -rf "$FIX3"

# ── Scenario 4: missing Exit-code summary header entirely ───────────
FIX4=$(mk_fixture "no-header.sh" "$(cat <<'SUITE'
#!/usr/bin/env bash
# Fixture: exits 0 but emits no header at all.
set -u
echo "this suite forgot to source the exit-summary helper"
SUITE
)")
run_scenario "missing Exit-code summary header" "$FIX4" "no-header.sh" \
  'expected exactly 1 "── Exit-code summary ──" line'
rm -rf "$FIX4"

# ── Scenario 5: mixed placeholder + ✓/✗ rows in one bucket ──────────
# Uses the shared bucket-fixtures helper so the byte layout this
# scenario asserts stays in lockstep with placeholder_only and
# records_only consumers — any future tweak to the placeholder line
# or ✓-row format only needs to be made in bucket-fixtures.sh.
# shellcheck disable=SC1091
source "$REAL_TESTS/_lib/bucket-fixtures.sh"
FIX5=$(mk_fixture "mixed-bucket.sh" "$(emit_mixed_bucket_suite 1)")
run_scenario "mixed placeholder + ✓ rows" "$FIX5" "mixed-bucket.sh" \
  "mixes placeholder + ✓/✗ rows"
rm -rf "$FIX5"


echo
if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n assertions failed"
  exit 1
fi
echo "✓ All $n assertions passed"

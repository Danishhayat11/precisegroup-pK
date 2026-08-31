#!/usr/bin/env bash
# Tests scripts/audit/ci/branch-escalate.sh: the documented branch-escalation
# wrapper for booking-reconciliation. Asserts that exit code 2 (missing pin)
# is a *warning* on a simulated feature branch and a *failure* on the
# default branch, with the matching ::warning / ::error annotations.
#
# No DB call: every assertion targets a booking id with no expectations file,
# so the auditor exits 2 before psql is invoked.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WRAPPER="$REPO_ROOT/scripts/audit/ci/branch-escalate.sh"
MISSING_ID="BK-XX-99999"   # no fixture in scripts/audit/expectations/
PASS=0
FAIL=0

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Shared exit-code summary helper (buckets reuse $TMP).
# shellcheck source=_lib/exit-summary.sh
source "$(dirname "$0")/_lib/exit-summary.sh"
SUMMARY_TMP="$TMP"
summary_init
# Branch-escalation buckets reflect *final* CI exit; relabel for clarity.
summary_set_label 0 "exit 0 — pass / warn-mode (feature-branch missing pin)"
summary_set_label 1 "exit 1 — drift / strict-on-default-branch escalation"
summary_set_label 2 "exit 2 — strict missing pin / invalid args (pre-escalation)"

# Sanity: confirm the id really is unpinned, otherwise the test is a lie.
if [ -f "$REPO_ROOT/scripts/audit/expectations/${MISSING_ID}.json" ]; then
  echo "✗ pre-flight: $MISSING_ID is pinned; pick another id"
  exit 2
fi

run_case() {
  local label="$1" ref="$2" expected_exit="$3" expected_grep="$4"
  local out status
  out="$(GITHUB_REF="$ref" BOOKING_ID="$MISSING_ID" bash "$WRAPPER" 2>&1)"
  status=$?
  if [ "$status" -eq "$expected_exit" ] && grep -qE "$expected_grep" <<<"$out"; then
    echo "✓ $label (exit=$status)"
    PASS=$((PASS + 1))
  else
    echo "✗ $label — expected exit=$expected_exit matching /$expected_grep/, got exit=$status"
    echo "---- output ----"; echo "$out"; echo "----------------"
    FAIL=$((FAIL + 1))
  fi
  summary_record "$expected_exit" "$status" "$label"
}

run_case "feature branch warns on missing pin (exit 2 → 0)" \
  "refs/heads/feature/audit-wrap" 0 "^::warning title=Audit not pinned"

run_case "another feature branch also warns" \
  "refs/heads/fix/BK-XX-99999" 0 "^::warning title=Audit not pinned"

run_case "main escalates missing pin to failure (exit 2 → 1)" \
  "refs/heads/main" 1 "^::error title=Audit not pinned"

# Custom default branch (e.g. trunk-based repos) should escalate there, not on main.
label="custom DEFAULT_BRANCH=release escalates on release/*"
out="$(GITHUB_REF=refs/heads/release DEFAULT_BRANCH=release BOOKING_ID="$MISSING_ID" bash "$WRAPPER" 2>&1)"
status=$?
if [ "$status" -eq 1 ] && grep -qE "^::error title=Audit not pinned" <<<"$out"; then
  echo "✓ $label (exit=$status)"
  PASS=$((PASS + 1))
else
  echo "✗ $label — expected exit=1, got exit=$status"
  echo "$out"
  FAIL=$((FAIL + 1))
fi
summary_record 1 "$status" "$label"

# Same custom default: a feature branch must still warn, not fail.
label="main warns when DEFAULT_BRANCH=release"
out="$(GITHUB_REF=refs/heads/main DEFAULT_BRANCH=release BOOKING_ID="$MISSING_ID" bash "$WRAPPER" 2>&1)"
status=$?
if [ "$status" -eq 0 ] && grep -qE "^::warning title=Audit not pinned" <<<"$out"; then
  echo "✓ $label (exit=$status)"
  PASS=$((PASS + 1))
else
  echo "✗ $label — expected exit=0, got exit=$status"
  echo "$out"
  FAIL=$((FAIL + 1))
fi
summary_record 0 "$status" "$label"

# --- Summary by exit code ------------------------------------------------
# Rendered by the shared helper (see _lib/exit-summary.sh); buckets reflect
# the *final* CI-handled exit code after the branch-escalate wrapper applies
# its policy.
summary_print 0 1 2

echo "branch-escalate: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] || exit 1

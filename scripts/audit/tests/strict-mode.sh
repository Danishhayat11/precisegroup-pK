#!/usr/bin/env bash
# Strict-mode contract for scripts/audit/booking-reconciliation.mjs.
#
# Pairs the CLI's exit semantics with the CI handling documented in
# README.md so a regression in either side breaks this test:
#
#   • --no-strict / AUDIT_STRICT=0  → exit 0 + `::warning` annotation
#   • default / --strict / AUDIT_STRICT=1 → exit 2 (missing-pin failure)
#   • --strict beats AUDIT_STRICT=0 (CLI flag wins over env)
#   • CI policy on `main`: exit 2 → fail (1).  On feature branches: warn (0).
#
# `psql` is not stubbed: every scenario here targets a booking id that has
# no pinned expectations file, so the script exits before any DB call.

set -u
SCRIPT="scripts/audit/booking-reconciliation.mjs"
MISSING_ID="BK-XX-99999"
fail=0
n=0

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Shared exit-code summary helper.
# shellcheck source=_lib/exit-summary.sh
source "$(dirname "$0")/_lib/exit-summary.sh"
SUMMARY_TMP="$TMP"
summary_init
# Override the exit-1 label to reflect this suite's CI-policy escalation.
summary_set_label 1 "exit 1 — drift detected / strict-on-main escalation"

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

assert_contains() {
  local desc="$1" needle="$2" haystack="$3"
  n=$((n+1))
  if grep -qF -- "$needle" <<<"$haystack"; then
    echo "✓ [$n] $desc (found \"$needle\")"
  else
    echo "✗ [$n] $desc — expected output to contain \"$needle\""
    echo "----- output -----"; echo "$haystack"; echo "------------------"
    fail=$((fail+1))
  fi
}

# Make sure no inherited env biases the result.
unset AUDIT_STRICT

# --- Warn-mode: --no-strict ---------------------------------------------
out=$(node "$SCRIPT" "$MISSING_ID" --no-strict 2>&1); code=$?
assert_exit   "--no-strict + missing pin → exit 0" 0 "$code" "$out"
assert_contains "--no-strict emits GitHub ::warning annotation" "::warning" "$out"

# --- Warn-mode: AUDIT_STRICT=0 ------------------------------------------
out=$(AUDIT_STRICT=0 node "$SCRIPT" "$MISSING_ID" 2>&1); code=$?
assert_exit   "AUDIT_STRICT=0 + missing pin → exit 0" 0 "$code" "$out"
assert_contains "AUDIT_STRICT=0 emits GitHub ::warning annotation" "::warning" "$out"

# --- Strict (default) ----------------------------------------------------
out=$(node "$SCRIPT" "$MISSING_ID" 2>&1); code=$?
assert_exit "default (strict) + missing pin → exit 2" 2 "$code" "$out"

# --- Strict (explicit flag) ---------------------------------------------
out=$(node "$SCRIPT" "$MISSING_ID" --strict 2>&1); code=$?
assert_exit "--strict + missing pin → exit 2" 2 "$code" "$out"

# --- Strict (env) --------------------------------------------------------
out=$(AUDIT_STRICT=1 node "$SCRIPT" "$MISSING_ID" 2>&1); code=$?
assert_exit "AUDIT_STRICT=1 + missing pin → exit 2" 2 "$code" "$out"

# --- Flag precedence -----------------------------------------------------
out=$(AUDIT_STRICT=0 node "$SCRIPT" "$MISSING_ID" --strict 2>&1); code=$?
assert_exit "--strict overrides AUDIT_STRICT=0 → exit 2" 2 "$code" "$out"
out=$(AUDIT_STRICT=1 node "$SCRIPT" "$MISSING_ID" --no-strict 2>&1); code=$?
assert_exit "--no-strict overrides AUDIT_STRICT=1 → exit 0" 0 "$code" "$out"

# --- CI policy simulation -----------------------------------------------
# Mirrors the matrix job in README.md: exit 2 must hard-fail on `main` but
# remain a soft warning on feature branches. This is the contract every
# downstream pipeline (GitHub Actions / GitLab CI) relies on.
ci_handle() {
  # $1 = branch ref, $2 = audit exit code → echo final CI exit code.
  local ref="$1" code="$2"
  case "$code" in
    0) echo 0 ;;
    1) echo 1 ;;                          # drift → always fail
    2) [ "$ref" = "main" ] && echo 1 || echo 0 ;;
    *) echo "$code" ;;
  esac
}

# Strict run on main: audit exits 2, CI must escalate to 1.
out=$(node "$SCRIPT" "$MISSING_ID" 2>&1); audit_code=$?
ci_code=$(ci_handle "main" "$audit_code")
assert_exit "CI on main: strict missing pin → fail (1)" 1 "$ci_code" "$out"

# Strict run on a feature branch: audit exits 2, CI warns (0).
ci_code=$(ci_handle "feature/x" "$audit_code")
assert_exit "CI on feature/x: strict missing pin → warn (0)" 0 "$ci_code" "$out"

# Warn-mode on main: audit exits 0, CI passes regardless of branch.
out=$(node "$SCRIPT" "$MISSING_ID" --no-strict 2>&1); audit_code=$?
ci_code=$(ci_handle "main" "$audit_code")
assert_exit "CI on main: --no-strict missing pin → pass (0)" 0 "$ci_code" "$out"

# --- Summary by exit code ------------------------------------------------
# Rendered by the shared helper (see _lib/exit-summary.sh) so the format
# stays identical across every audit test script. CI-policy assertions
# are bucketed by the *final* CI-handled code (warn→0, fail→1) so the
# table reflects the effective pipeline outcome, not the underlying
# audit exit.
summary_print 0 1 2

if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n strict-mode assertion(s) failed."
  exit 1
fi
echo "✓ All $n strict-mode assertions passed."


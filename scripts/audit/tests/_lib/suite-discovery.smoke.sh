#!/usr/bin/env bash
# Smoke test for scripts/audit/tests/_lib/suite-discovery.sh.
#
# Pins the contract of `discover_suites` — the shared helper every
# audit-test enumerator (summary-format.sh, cli-contract.sh self-
# regression, _lib/summary-format.meta.sh, run-all.sh drift guard)
# sources. A regression here would silently shift which scripts CI
# treats as "real" suites, so each behavior is asserted directly:
#
#   • Real-tree enumeration returns every known suite, sorted, as
#     repo-relative paths that exist on disk.
#   • Built-in exemptions (summary-format.sh, run-all.sh, anything
#     under _lib/) are never returned.
#   • Caller-supplied extra exempts are honored; an extra exempt for a
#     path that isn't a suite is a silent no-op (not an error).
#   • Works under `set -u` with NO positional args — the helper must
#     not trip on `"$@"` expansion or `${_exempt[$rel]:-}` lookups
#     when zero extras are passed. This is the failure mode a caller
#     hits the first time they invoke `discover_suites` from a
#     `set -euo pipefail` script with no per-tool exemptions.
#   • Fixture-tree override (via _AUDIT_TESTS_DIR) — empty dirs and
#     _lib/-only dirs both yield zero output; alphabetic sort is
#     enforced regardless of on-disk creation order.

set -u

HELPER="$(cd "$(dirname "$0")" && pwd)/suite-discovery.sh"
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
fail=0
n=0

pass() { n=$((n+1)); echo "  ✓ [$n] $1"; }
fail() { n=$((n+1)); echo "  ✗ [$n] $1"; fail=$((fail+1)); }

assert_eq() {
  # $1 = desc, $2 = expected, $3 = actual
  if [ "$2" = "$3" ]; then
    pass "$1"
  else
    fail "$1"
    echo "      expected: $(printf '%q' "$2")"
    echo "      actual:   $(printf '%q' "$3")"
  fi
}

assert_contains_line() {
  # $1 = desc, $2 = needle line, $3 = haystack (newline-separated)
  if grep -qxF -- "$2" <<<"$3"; then
    pass "$1"
  else
    fail "$1 — missing line: \"$2\""
  fi
}

assert_absent_line() {
  if grep -qxF -- "$2" <<<"$3"; then
    fail "$1 — unexpected line: \"$2\""
  else
    pass "$1"
  fi
}

# ─────────────────────────────────────────────────────────────────────
# Scenario A — enumeration against the real tests/ tree
# ─────────────────────────────────────────────────────────────────────
echo "── A) real-tree enumeration ──"

# shellcheck source=./suite-discovery.sh
. "$HELPER"

real_out=$(discover_suites)

# A1 — every known suite is returned.
for suite in \
    cli-contract.sh \
    cli-exit-codes.sh \
    strict-mode.sh \
    branch-escalate.sh \
    required-args-and-db.sh; do
  assert_contains_line "returns scripts/audit/tests/$suite" \
    "scripts/audit/tests/$suite" \
    "$real_out"
done

# A2 — built-in exemptions are NEVER returned.
for exempt in summary-format.sh run-all.sh; do
  assert_absent_line "built-in exempt: omits $exempt" \
    "scripts/audit/tests/$exempt" \
    "$real_out"
done

# A3 — nothing under _lib/ leaks through (maxdepth 1 rule).
n=$((n+1))
if grep -q "^scripts/audit/tests/_lib/" <<<"$real_out"; then
  fail "_lib/ helpers leaked into discover_suites output"
else
  pass "_lib/ helpers are never returned"
fi

# A4 — every returned path exists on disk as a regular file.
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  n=$((n+1))
  if [ -f "$REPO_ROOT/$rel" ]; then
    pass "$rel exists on disk"
  else
    fail "$rel was returned but does not exist on disk"
  fi
done <<<"$real_out"

# A5 — output is sorted (LC_ALL=C order, matching `sort` in the helper).
n=$((n+1))
expected_sorted=$(LC_ALL=C sort <<<"$real_out")
if [ "$real_out" = "$expected_sorted" ]; then
  pass "output is sorted in LC_ALL=C order"
else
  fail "output is NOT sorted"
fi

# ─────────────────────────────────────────────────────────────────────
# Scenario B — set -u + zero positional args
# ─────────────────────────────────────────────────────────────────────
# Regression for the canonical first-time caller: a `set -euo pipefail`
# script that sources the helper and calls `discover_suites` with no
# extra exempts. The helper's `for p in "$@"; do` loop and
# `${_exempt[$rel]:-}` lookups must NOT trip "unbound variable" under
# set -u. We invoke in a subshell so a regression here aborts the
# subshell only and the rest of the smoke test keeps running.
echo "── B) set -u + zero positional args ──"

n=$((n+1))
if out=$(set -u; discover_suites 2>&1); then
  if [ -n "$out" ] && [ "$out" = "$real_out" ]; then
    pass "discover_suites under set -u with no args returns same output"
  else
    fail "discover_suites under set -u returned different output"
    echo "      diff vs real_out:"
    diff <(printf '%s\n' "$real_out") <(printf '%s\n' "$out") | sed 's/^/        /'
  fi
else
  rc=$?
  fail "discover_suites aborted under set -u with no args (exit $rc)"
  printf '      stderr/stdout:\n%s\n' "$out" | sed 's/^/        /'
fi

# Also pin the same behavior under the stricter `set -euo pipefail`,
# which is what real callers (run-all.sh, summary-format.sh) use.
n=$((n+1))
if out=$(set -euo pipefail; discover_suites 2>&1); then
  pass "discover_suites under set -euo pipefail with no args succeeds"
else
  rc=$?
  fail "discover_suites failed under set -euo pipefail (exit $rc)"
  printf '      stderr/stdout:\n%s\n' "$out" | sed 's/^/        /'
fi

# ─────────────────────────────────────────────────────────────────────
# Scenario C — caller-supplied extra exempts
# ─────────────────────────────────────────────────────────────────────
echo "── C) caller-supplied extra exempts ──"

# C1 — extra exempt for a real suite removes it from the output AND
#      leaves every other suite intact.
extra_out=$(discover_suites "scripts/audit/tests/cli-contract.sh")
assert_absent_line "extra exempt removes cli-contract.sh" \
  "scripts/audit/tests/cli-contract.sh" \
  "$extra_out"
assert_contains_line "extra exempt keeps other suites (cli-exit-codes.sh)" \
  "scripts/audit/tests/cli-exit-codes.sh" \
  "$extra_out"

# C2 — extra exempt for a path that isn't a suite is a silent no-op.
n=$((n+1))
if noop_out=$(discover_suites "scripts/audit/tests/does-not-exist.sh" 2>&1); then
  if [ "$noop_out" = "$real_out" ]; then
    pass "extra exempt for non-existent path is a no-op"
  else
    fail "extra exempt for non-existent path mutated output"
  fi
else
  fail "discover_suites failed on extra exempt for non-existent path"
fi

# C3 — multiple extra exempts compose.
multi_out=$(discover_suites \
  "scripts/audit/tests/cli-contract.sh" \
  "scripts/audit/tests/strict-mode.sh")
assert_absent_line "multi-exempt drops cli-contract.sh" \
  "scripts/audit/tests/cli-contract.sh" \
  "$multi_out"
assert_absent_line "multi-exempt drops strict-mode.sh" \
  "scripts/audit/tests/strict-mode.sh" \
  "$multi_out"
assert_contains_line "multi-exempt keeps branch-escalate.sh" \
  "scripts/audit/tests/branch-escalate.sh" \
  "$multi_out"

# ─────────────────────────────────────────────────────────────────────
# Scenario D — fixture-tree override (_AUDIT_TESTS_DIR)
# ─────────────────────────────────────────────────────────────────────
# Re-point the helper's internal tests-dir at a synthetic tree so we
# can pin edge cases (empty dir, _lib-only dir, unsorted on-disk
# creation order) without depending on the live suite layout. The
# helper resolves $_AUDIT_TESTS_DIR once at source time, so plain
# reassignment is sufficient — no need to re-source.
echo "── D) fixture-tree override ──"

FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT
ORIG_TESTS_DIR="$_AUDIT_TESTS_DIR"

# D1 — empty dir → empty output, exit 0.
_AUDIT_TESTS_DIR="$FIX/empty"
mkdir -p "$_AUDIT_TESTS_DIR"
n=$((n+1))
if empty_out=$(discover_suites); then
  if [ -z "$empty_out" ]; then
    pass "empty tests dir → empty output"
  else
    fail "empty tests dir returned: $empty_out"
  fi
else
  fail "discover_suites failed on empty tests dir"
fi

# D2 — _lib-only dir → empty output (maxdepth 1 keeps helpers out).
_AUDIT_TESTS_DIR="$FIX/liblike"
mkdir -p "$_AUDIT_TESTS_DIR/_lib"
: >"$_AUDIT_TESTS_DIR/_lib/helper.sh"
n=$((n+1))
liblike_out=$(discover_suites)
if [ -z "$liblike_out" ]; then
  pass "_lib-only tree → empty output (maxdepth 1)"
else
  fail "_lib-only tree returned: $liblike_out"
fi

# D3 — unsorted on-disk creation order → alphabetic output.
_AUDIT_TESTS_DIR="$FIX/ordered"
mkdir -p "$_AUDIT_TESTS_DIR"
# Create in non-alphabetic order; the helper must still sort.
: >"$_AUDIT_TESTS_DIR/charlie.sh"
: >"$_AUDIT_TESTS_DIR/alpha.sh"
: >"$_AUDIT_TESTS_DIR/bravo.sh"
ordered_out=$(discover_suites)
expected_order=$'scripts/audit/tests/alpha.sh\nscripts/audit/tests/bravo.sh\nscripts/audit/tests/charlie.sh'
assert_eq "fixture dir output is alphabetically sorted" \
  "$expected_order" "$ordered_out"

# D4 — non-.sh files are ignored.
: >"$_AUDIT_TESTS_DIR/README.md"
: >"$_AUDIT_TESTS_DIR/notes.txt"
n=$((n+1))
ordered_out2=$(discover_suites)
if [ "$ordered_out2" = "$expected_order" ]; then
  pass "non-.sh files are ignored"
else
  fail "non-.sh files leaked into output: $ordered_out2"
fi

# Restore real tests dir so any later assertions stay sane.
_AUDIT_TESTS_DIR="$ORIG_TESTS_DIR"

# ─────────────────────────────────────────────────────────────────────
# Scenario E — --suite / --pattern / --exempt flag parsing
# ─────────────────────────────────────────────────────────────────────
echo "── E) --suite / --pattern / --exempt flags ──"

# E1 — --suite by bare basename narrows to exactly that suite.
e1_out=$(discover_suites --suite cli-contract)
assert_eq "--suite cli-contract returns only cli-contract.sh" \
  "scripts/audit/tests/cli-contract.sh" "$e1_out"

# E2 — --suite accepts basename.sh form too.
e2_out=$(discover_suites --suite cli-exit-codes.sh)
assert_eq "--suite cli-exit-codes.sh returns only that suite" \
  "scripts/audit/tests/cli-exit-codes.sh" "$e2_out"

# E3 — --suite accepts the full repo-relative path.
e3_out=$(discover_suites --suite scripts/audit/tests/strict-mode.sh)
assert_eq "--suite <repo-relpath> returns only that suite" \
  "scripts/audit/tests/strict-mode.sh" "$e3_out"

# E4 — multiple --suite flags union (and remain sorted).
e4_out=$(discover_suites --suite strict-mode --suite cli-contract)
expected_e4=$'scripts/audit/tests/cli-contract.sh\nscripts/audit/tests/strict-mode.sh'
assert_eq "multiple --suite flags union (sorted)" "$expected_e4" "$e4_out"

# E5 — --pattern matches by basename glob.
e5_out=$(discover_suites --pattern 'cli-*')
n=$((n+1))
if grep -q '^scripts/audit/tests/cli-contract\.sh$' <<<"$e5_out" \
   && grep -q '^scripts/audit/tests/cli-exit-codes\.sh$' <<<"$e5_out" \
   && ! grep -q '^scripts/audit/tests/strict-mode\.sh$' <<<"$e5_out"; then
  pass "--pattern 'cli-*' includes cli-* suites and excludes others"
else
  fail "--pattern 'cli-*' returned unexpected set: $e5_out"
fi

# E6 — --suite + --pattern union.
e6_out=$(discover_suites --suite strict-mode --pattern 'cli-contract*')
n=$((n+1))
if grep -q '^scripts/audit/tests/cli-contract\.sh$' <<<"$e6_out" \
   && grep -q '^scripts/audit/tests/strict-mode\.sh$' <<<"$e6_out" \
   && ! grep -q '^scripts/audit/tests/cli-exit-codes\.sh$' <<<"$e6_out"; then
  pass "--suite + --pattern union narrows correctly"
else
  fail "--suite + --pattern union returned unexpected set: $e6_out"
fi

# E7 — a --suite that doesn't exist is a silent no-op (empty output, no error).
n=$((n+1))
if e7_out=$(discover_suites --suite does-not-exist 2>&1); then
  if [ -z "$e7_out" ]; then
    pass "--suite for unknown name yields empty output (silent no-op)"
  else
    fail "--suite for unknown name returned: $e7_out"
  fi
else
  fail "--suite for unknown name exited non-zero"
fi

# E8 — --exempt is equivalent to a positional exempt path.
e8_out=$(discover_suites --exempt scripts/audit/tests/cli-contract.sh)
assert_absent_line "--exempt removes cli-contract.sh" \
  "scripts/audit/tests/cli-contract.sh" "$e8_out"
assert_contains_line "--exempt keeps other suites" \
  "scripts/audit/tests/cli-exit-codes.sh" "$e8_out"

# E9 — exemption ALWAYS wins, even if the same suite was named via --suite.
e9_out=$(discover_suites --suite cli-contract --exempt scripts/audit/tests/cli-contract.sh)
n=$((n+1))
if [ -z "$e9_out" ]; then
  pass "--exempt overrides --suite (exempt wins)"
else
  fail "--exempt did not override --suite: $e9_out"
fi

# E10 — built-in exempts can't be re-included via --suite (self-recursion guard).
e10_out=$(discover_suites --suite summary-format --suite run-all)
n=$((n+1))
if [ -z "$e10_out" ]; then
  pass "--suite cannot re-include built-in exempts (summary-format, run-all)"
else
  fail "--suite re-included built-in exempts: $e10_out"
fi

# E11 — unknown flag exits 2 with a diagnostic on stderr.
n=$((n+1))
if e11_out=$(discover_suites --bogus 2>&1); then
  fail "--bogus did not return non-zero"
else
  rc=$?
  if [ "$rc" -eq 2 ] && grep -q 'unknown flag: --bogus' <<<"$e11_out"; then
    pass "unknown flag returns exit 2 with diagnostic"
  else
    fail "unknown flag returned rc=$rc, out=$e11_out"
  fi
fi

# E12 — missing value for --suite errors (exit 2).
n=$((n+1))
if e12_out=$(discover_suites --suite 2>&1); then
  fail "--suite with no value did not return non-zero"
else
  rc=$?
  if [ "$rc" -eq 2 ] && grep -q -- '--suite requires a value' <<<"$e12_out"; then
    pass "--suite without value returns exit 2"
  else
    fail "--suite without value returned rc=$rc, out=$e12_out"
  fi
fi

# E13 — --suite=NAME form (equals syntax) also works.
e13_out=$(discover_suites --suite=cli-contract)
assert_eq "--suite=NAME equals-form narrows correctly" \
  "scripts/audit/tests/cli-contract.sh" "$e13_out"

# E14 — `--` end-of-flags marker: everything after is an exempt path,
#       even if it starts with --.
e14_out=$(discover_suites -- scripts/audit/tests/cli-contract.sh)
assert_absent_line "-- terminator: trailing arg is exempt" \
  "scripts/audit/tests/cli-contract.sh" "$e14_out"


echo
if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n suite-discovery smoke assertions failed."
  exit 1
fi
echo "✓ All $n suite-discovery smoke assertions passed."

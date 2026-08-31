#!/usr/bin/env bash
# Meta-tests for scripts/audit/tests/summary-format.sh.
#
# Pins TWO behaviours of the auto-discovery layer that are easy to
# regress and silent when they break:
#
#   1. Canonical render order — auto-discovered suites appear in
#      summary-format.sh's output in the same ascending order that the
#      shared `discover_suites` helper returns them (basename sort via
#      `find | sort`). A future refactor that swaps the sort for an
#      unsorted walk would produce non-deterministic CI logs; this
#      test fails fast before that ships.
#
#   2. Orchestrator / helper exclusion — neither run-all.sh,
#      summary-format.sh itself, nor anything under _lib/ is auto-
#      discovered. Including run-all.sh would self-recurse (it shells
#      out to summary-format.sh); including _lib/ would treat shared
#      libraries as suites and demand they emit an Exit-code summary.
#
# Lives under _lib/ so summary-format.sh's own auto-discovery does NOT
# pick this file up. That is defence-in-depth: the same _lib/ exclusion
# this test pins also keeps the test itself out of the discovered set,
# so adding the file cannot accidentally make summary-format.sh recurse
# into a meta-test.

set -u

THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
TESTS_DIR="$(cd "$THIS_DIR/.." && pwd)"

# shellcheck source=./suite-discovery.sh
. "$THIS_DIR/suite-discovery.sh"

fail=0
n=0
record() {
  local desc="$1" cond="$2"
  n=$((n+1))
  if eval "$cond"; then
    echo "  ✓ [$n] $desc"
  else
    echo "  ✗ [$n] $desc"
    fail=$((fail+1))
  fi
}

echo "── summary-format.sh meta-tests ──"

# One full run of summary-format.sh — every subsequent assertion
# inspects this captured log. The script exits 0 on success against the
# current tree (a precondition for the order/exclusion checks below to
# be meaningful: if it failed, the auto-discovery section may be
# truncated).
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT
bash "$TESTS_DIR/summary-format.sh" >"$LOG" 2>&1
sf_exit=$?
record "summary-format.sh exits 0 against the current tree" \
  '[ "$sf_exit" = "0" ]'

# ── Build the expected auto-discovered set ──────────────────────────
# It is exactly: discover_suites output, minus the suites pinned by
# Layer 1 (SUITES=( ... ) in summary-format.sh). The pinned set is
# extracted by parsing summary-format.sh itself rather than hard-coded
# here, so adding/removing a pin doesn't require touching this file.
declare -A PINNED=()
pinned_count=0
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  PINNED["$rel"]=1
  pinned_count=$((pinned_count+1))
done < <(
  awk '/^SUITES=\(/{f=1; next} f && /^\)/{exit} f' "$TESTS_DIR/summary-format.sh" \
    | sed -nE 's|^[[:space:]]*"(scripts/audit/tests/[^;"]+);.*|\1|p'
)
record "parsed at least one pinned suite from SUITES=( ... )" \
  '[ "$pinned_count" -gt 0 ]'

EXPECTED=()
while IFS= read -r rel; do
  [ -n "${PINNED[$rel]:-}" ] && continue
  EXPECTED+=("$rel")
done < <(discover_suites)

# ── (1) Canonical render order ──────────────────────────────────────
# Extract the order summary-format.sh actually walked from its
# "── checking <rel> (auto-discovered) ──" lines.
ACTUAL=()
while IFS= read -r rel; do
  [ -n "$rel" ] && ACTUAL+=("$rel")
done < <(
  grep -oE '── checking [^ ]+ \(auto-discovered\) ──' "$LOG" \
    | sed -E 's/^── checking (.+) \(auto-discovered\) ──$/\1/'
)

expected_joined="${EXPECTED[*]:-}"
actual_joined="${ACTUAL[*]:-}"
sorted_joined=$(printf '%s\n' "${ACTUAL[@]:-}" | LC_ALL=C sort | paste -sd' ' -)

record "auto-discovered set matches discover_suites (minus pinned)" \
  '[ "$expected_joined" = "$actual_joined" ]'
record "auto-discovered order is ascending (canonical LC_ALL=C sort)" \
  '[ "$sorted_joined" = "$actual_joined" ]'

# ── (2) Orchestrator / helper exclusion ─────────────────────────────
# These MUST never surface as auto-discovered suites — pinned at BOTH
# layers (the discover_suites helper itself, and the summary-format.sh
# render) so a regression in either is caught here.
for excluded in \
    "scripts/audit/tests/run-all.sh" \
    "scripts/audit/tests/summary-format.sh"; do
  record "summary-format.sh does NOT auto-discover: $excluded" \
    '! grep -qF "── checking '"$excluded"' (auto-discovered) ──" "$LOG"'
  record "discover_suites does NOT return: $excluded" \
    '! discover_suites | grep -qxF "'"$excluded"'"'
done

record "no _lib/ helper surfaces as an auto-discovered suite" \
  '! grep -qE "── checking scripts/audit/tests/_lib/[^ ]+ \(auto-discovered\) ──" "$LOG"'
record "discover_suites returns nothing under _lib/" \
  '! discover_suites | grep -q "^scripts/audit/tests/_lib/"'

# ── Footer sanity ────────────────────────────────────────────────────
# The footer summary in summary-format.sh ("── auto-discovery: N new
# suite(s) found beyond the M pinned + K exempt ──") must report the
# same auto-discovery count we computed. This guards against a refactor
# that prints stale numbers (e.g. forgetting to increment the counter
# inside the discovery loop).
record "footer reports ${#EXPECTED[@]} auto-discovered suite(s)" \
  'grep -qE "── auto-discovery: '"${#EXPECTED[@]}"' new suite\(s\) found beyond the '"$pinned_count"' pinned " "$LOG"'

echo
if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n summary-format.sh meta-test(s) failed."
  echo "  --- last 60 lines of captured summary-format.sh output ---"
  tail -60 "$LOG"
  exit 1
fi
echo "✓ All $n summary-format.sh meta-tests passed."

#!/usr/bin/env bash
# CLI contract tests for scripts/audit/booking-reconciliation.mjs.
#
# Verifies:
#   • --help / -h exit 0 and print Usage on stdout
#   • Missing booking id           → exit 2 + Usage on stderr
#   • Invalid booking id format    → exit 2 + Usage on stderr
#   • Missing expectations file    → exit 2 + helpful path hint
#   • Flag without value           → exit 2 + Usage on stderr
#   • Unknown flag                 → exit 2 + Usage on stderr
#
# No DB calls are made — every failing path exits before psql is invoked.
#
# Summary contract (do not regress — pinned by the self-regression
# assertions appended after summary_print below):
#
#   • MUST source scripts/audit/tests/_lib/exit-summary.sh via the
#     canonical relative path. No inlined copy. summary_init,
#     summary_record and summary_print must remain the sourced helpers
#     (no local shadowing) so the rendered block is byte-identical to
#     every other audit suite.
#   • MUST render exactly one "── Exit-code summary ──" block via
#     summary_print 0 1 2, covering all three canonical buckets in
#     ascending order:
#       – exit 0  → the --help / -h scenarios as ✓ rows
#       – exit 1  → "(no scenarios exercised this code)" placeholder
#                   (this suite never drives drift / strict-on-default
#                   branch escalation)
#       – exit 2  → the six invalid-arg scenarios as ✓ rows
#   • MUST be auto-discovered by summary-format.sh — i.e. listed by
#     _lib/suite-discovery.sh's discover_suites — and MUST NOT appear
#     in summary-format.sh's EXEMPT array. The block is rendered
#     unconditionally so reviewers grepping CI logs see the same
#     heading across every audit suite.
#
# Example invocation (no DB required):
#
# >>> CLI_CONTRACT_EXAMPLE_FULL BEGIN (auto-generated, do not edit)
#   $ bash scripts/audit/tests/cli-contract.sh
#   ✓ [1] --help prints usage and exits 0
#   ... (8 scenarios) ...
#   ── Exit-code summary ──
#   exit 0 — pass / warn-mode:
#     ✓ --help prints usage and exits 0
#     ✓ -h prints usage and exits 0
#   exit 1 — drift detected:
#     (no scenarios exercised this code)
#   exit 2 — strict missing pin / invalid args:
#     ✓ missing booking id exits 2 with usage
#     ✓ invalid booking id format exits 2
#     ✓ missing expectations file exits 2 with path hint
#     ✓ --booking without value exits 2
#     ✓ --expectations without value exits 2
#     ✓ unknown flag exits 2
#   ── self-regression: helper delegation + auto-discovery (no EXEMPT) ──
#     ✓ [self/1..11] ...
#   ✓ All 19 CLI contract assertions passed.
# >>> CLI_CONTRACT_EXAMPLE_FULL END
#
# Regenerate the block above with:
#   bash scripts/audit/tests/_lib/regenerate-cli-contract-example.sh
# (or `--check` for a non-mutating drift gate). The same generator
# rewrites the matching fenced block in scripts/audit/tests/_lib/README.md
# so the two stay byte-for-byte in sync.
#
# The 0/1/2 bucket block above is the canonical shape every audit suite
# emits via summary_print 0 1 2 — exit 1 here renders the placeholder
# line because this suite never drives a drift scenario.
#
# Concrete invalid-arg drill-down: this second example zooms in on the
# bucket-1-stays-placeholder / bucket-2-captures-many-rows shape, which
# is the most common audit-suite render in practice (any CLI that only
# defends valid input shape and never drifts produces it). The same
# `summary_print 0 1 2` call still renders all three canonical buckets
# in ascending order — bucket 1 is the placeholder, bucket 2 fans out:
#
#   $ bash scripts/audit/tests/cli-contract.sh 2>&1 \
#       | sed -n '/── Exit-code summary ──/,/^── self-regression/p' \
#       | sed '$d'
#   ── Exit-code summary ──
#   exit 0 — pass / warn-mode:
#     ✓ --help prints usage and exits 0
#     ✓ -h prints usage and exits 0
#   exit 1 — drift detected:
#     (no scenarios exercised this code)        ← placeholder, never mixed with ✓/✗
#   exit 2 — strict missing pin / invalid args:
#     ✓ missing booking id exits 2 with usage            ← invalid-arg #1
#     ✓ invalid booking id format exits 2                ← invalid-arg #2
#     ✓ missing expectations file exits 2 with path hint ← invalid-arg #3
#     ✓ --booking without value exits 2                  ← invalid-arg #4
#     ✓ --expectations without value exits 2             ← invalid-arg #5
#     ✓ unknown flag exits 2                             ← invalid-arg #6
#
# Reviewer checklist for this shape:
#   • bucket 1 body is exactly one line: the placeholder string with two
#     leading spaces — never a ✓ or ✗ row (summary-format.sh rejects mixed
#     buckets with "bucket for exit 1 mixes placeholder + ✓/✗ rows").
#   • bucket 2 carries N ✓ rows in registration order — adding a 7th
#     invalid-arg scenario means updating the "six invalid-arg scenarios"
#     claim in the contract block above, which cli-contract.docs.sh pins.

set -u
source "$(dirname "$0")/_lib/exit-summary.sh"
summary_init

SCRIPT="scripts/audit/booking-reconciliation.mjs"
fail=0
n=0

# assert records the scenario under its *expected* exit code via
# summary_record, so a broken contract row still shows up in the bucket
# it was supposed to cover (matching cli-exit-codes.sh's convention).
assert() {
  local desc="$1" expected_code="$2" expected_stream="$3" expected_pat="$4"
  local actual_code="$5" actual_out="$6"
  n=$((n+1))
  summary_record "$expected_code" "$actual_code" "$desc"
  if [ "$actual_code" != "$expected_code" ]; then
    echo "✗ [$n] $desc — expected exit $expected_code, got $actual_code"
    echo "----- output -----"; echo "$actual_out"; echo "------------------"
    fail=$((fail+1))
    return
  fi
  if ! grep -qE "$expected_pat" <<<"$actual_out"; then
    echo "✗ [$n] $desc — exit $expected_code OK but missing /$expected_pat/ on $expected_stream"
    echo "----- output -----"; echo "$actual_out"; echo "------------------"
    fail=$((fail+1))
    return
  fi
  echo "✓ [$n] $desc"
}

run_capture_stdout() { "$@" 2>/dev/null; }    # we only care about stdout
run_capture_stderr() { "$@" 2>&1 1>/dev/null; } # only stderr (drop stdout)

# 1) --help → exit 0, Usage on stdout
out=$(run_capture_stdout node "$SCRIPT" --help); code=$?
assert "--help prints usage and exits 0" 0 stdout "^Usage:" "$code" "$out"

# 2) -h → same
out=$(run_capture_stdout node "$SCRIPT" -h); code=$?
assert "-h prints usage and exits 0" 0 stdout "^Usage:" "$code" "$out"

# 3) no args → exit 2, Usage on stderr
out=$(run_capture_stderr node "$SCRIPT"); code=$?
assert "missing booking id exits 2 with usage" 2 stderr "missing booking id|Usage:" "$code" "$out"

# 4) invalid id format → exit 2 + invalid-id error
out=$(run_capture_stderr node "$SCRIPT" not-a-real-id); code=$?
assert "invalid booking id format exits 2" 2 stderr "invalid booking id" "$code" "$out"

# 5) valid format but no snapshot → exit 2 + path hint
out=$(run_capture_stderr node "$SCRIPT" BK-XX-99999); code=$?
assert "missing expectations file exits 2 with path hint" 2 stderr "expectations file not found|scripts/audit/expectations/BK-XX-99999.json" "$code" "$out"

# 6) flag without value → exit 2 + Usage
out=$(run_capture_stderr node "$SCRIPT" --booking); code=$?
assert "--booking without value exits 2" 2 stderr "requires a value|Usage:" "$code" "$out"

out=$(run_capture_stderr node "$SCRIPT" --expectations); code=$?
assert "--expectations without value exits 2" 2 stderr "requires a value|Usage:" "$code" "$out"

# 7) unknown flag → exit 2 + Usage
out=$(run_capture_stderr node "$SCRIPT" --bogus); code=$?
assert "unknown flag exits 2" 2 stderr "unknown argument|Usage:" "$code" "$out"

# Render the canonical summary block. This suite only exercises codes 0
# and 2 (no drift scenarios), but we still print bucket 1 so the
# placeholder line appears — summary-format.sh's auto-discovery layer
# requires every suite to cover the canonical 0/1/2 buckets and verifies
# the "(no scenarios exercised this code)" placeholder for unused codes.
summary_print 0 1 2


# ─────────────────────────────────────────────────────────────────────
# Self-regression: this suite MUST delegate to _lib/exit-summary.sh and
# MUST be picked up by summary-format.sh's auto-discovery layer WITHOUT
# an EXEMPT allowlist entry. A refactor that inlines a local summary
# implementation, drops the `source` line, or adds cli-contract.sh to
# EXEMPT would silently bypass the canonical bucket-format contract —
# these assertions fail fast before that can ship.
#
# Runs AFTER summary_print so the rendered summary block stays the last
# thing emitted before the pass/fail tally; the trailing blank line that
# summary_print prints terminates summary-format.sh's per-bucket body
# scan, so the self-regression output below cannot pollute any bucket.
# ─────────────────────────────────────────────────────────────────────
self_n=0; self_fail=0
self_assert() {
  local desc="$1" cond="$2"
  self_n=$((self_n+1))
  if eval "$cond"; then
    echo "  ✓ [self/$self_n] $desc"
  else
    echo "  ✗ [self/$self_n] $desc"
    self_fail=$((self_fail+1))
  fi
}

echo "── self-regression: helper delegation + auto-discovery (no EXEMPT) ──"

TESTS_DIR="$(dirname "$0")"
HELPER="$TESTS_DIR/_lib/exit-summary.sh"
SF="$TESTS_DIR/summary-format.sh"

# 1) The three helper entrypoints are functions sourced from the shared
#    library — not local re-implementations shadowing the same names.
self_assert "summary_init / summary_record / summary_print are sourced functions" \
  '[ "$(type -t summary_init)"   = "function" ] && \
   [ "$(type -t summary_record)" = "function" ] && \
   [ "$(type -t summary_print)"  = "function" ]'

# 2) The shared helper file exists AND this script sources it by the
#    canonical path. A refactor that copy-pastes the helper body inline
#    would pass (1) but fail (2), which is exactly the regression we
#    want to catch.
self_assert "_lib/exit-summary.sh exists on disk" \
  '[ -f "$HELPER" ]'
self_assert "cli-contract.sh sources _lib/exit-summary.sh by path" \
  'grep -qE "^source \"\\\$\(dirname \"\\\$0\"\)/_lib/exit-summary\.sh\"$" "$0"'

# 3) summary-format.sh must NOT list this suite in its EXEMPT array.
#    Extract the EXEMPT=( ... ) block and confirm cli-contract.sh isn't
#    inside it. (A bare `grep cli-contract` against the whole file would
#    false-match the comment header, so we scope to the array body.)
self_assert "summary-format.sh exists" '[ -f "$SF" ]'
self_assert "summary-format.sh EXEMPT array does NOT list cli-contract.sh" \
  '! awk "/^EXEMPT=\(/{f=1} f{print} /^\)/{if(f){exit}}" "$SF" \
       | grep -q "cli-contract\\.sh"'

# 4) The shared suite-discovery helper MUST return this suite, which
#    proves auto-discovery picks it up (defence in depth beyond the
#    EXEMPT check: a future change to discover_suites' built-in
#    exemptions would also be caught here).
# shellcheck source=./_lib/suite-discovery.sh
. "$TESTS_DIR/_lib/suite-discovery.sh"
self_assert "discover_suites returns scripts/audit/tests/cli-contract.sh" \
  'discover_suites | grep -qx "scripts/audit/tests/cli-contract.sh"'

# 5) Re-render the bucket outputs in an isolated subshell with a known
#    fixture (one pass at exit 0, one pass at exit 2, no drift) and pin
#    the EXACT shape summary-format.sh expects: header present exactly
#    once; canonical buckets 0/1/2 in ascending order; the unused code
#    renders the placeholder line; the exercised codes render ✓ rows
#    naming the seeded scenarios.
SELF_LOG=$(mktemp)
(
  set -u
  # Fresh state so this suite's earlier summary_record calls don't bleed in.
  unset SUMMARY_TMP
  source "$HELPER"
  summary_init
  summary_record 0 0 "self-fixture/help-exits-0"
  summary_record 2 2 "self-fixture/invalid-id-exits-2"
  summary_print 0 1 2
) >"$SELF_LOG" 2>&1

self_assert "fixture render emits exactly one Exit-code summary header" \
  '[ "$(grep -cF "── Exit-code summary ──" "$SELF_LOG")" = "1" ]'

self_assert "fixture render emits canonical 0/1/2 bucket headers in order" \
  'grep -oE "^exit [0-9]+ — .+:$" "$SELF_LOG" \
     | sed -E "s/^exit ([0-9]+) .*/\1/" \
     | paste -sd, - | grep -qx "0,1,2"'

self_assert "exit 0 bucket records the seeded help scenario as ✓" \
  'awk "/^exit 0 — /{f=1; next} /^exit [0-9]+ — /{f=0} f" "$SELF_LOG" \
     | grep -qE "^  ✓ self-fixture/help-exits-0$"'

self_assert "exit 1 bucket renders the placeholder (no drift exercised)" \
  'awk "/^exit 1 — /{f=1; next} /^exit [0-9]+ — /{f=0} f" "$SELF_LOG" \
     | grep -qxF "  (no scenarios exercised this code)"'

self_assert "exit 2 bucket records the seeded invalid-id scenario as ✓" \
  'awk "/^exit 2 — /{f=1; next} /^exit [0-9]+ — /{f=0} f" "$SELF_LOG" \
     | grep -qE "^  ✓ self-fixture/invalid-id-exits-2$"'

rm -f "$SELF_LOG"

# Fold self-regression results into the overall tally so a single
# failure flips the suite's exit code without needing a second branch.
n=$((n + self_n))
fail=$((fail + self_fail))


if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n CLI contract assertion(s) failed."
  exit 1
fi
echo "✓ All $n CLI contract assertions passed."

#!/usr/bin/env bash
# Regression test: intentionally trigger a summary-format mismatch and
# assert that the artifact directory uploaded to CI as
# `summary-format-failures` contains:
#
#   - FAILURES.md                  (markdown index)
#   - index.html                   (browser-renderable index)
#   - <broken-suite-basename>.log  (captured stdout+stderr)
#
# WHY THIS LIVES UNDER _lib/
# --------------------------
# Anything dropped into scripts/audit/tests/ at top level is auto-discovered
# by summary-format.sh (Layer 2). This regression test is itself a meta-test
# on summary-format.sh, so we deliberately keep it under _lib/ — the same
# place where suite-discovery.sh structurally excludes helpers via
# `find -maxdepth 1`. Putting it here means running it does NOT pollute the
# auto-discovery set during the very next CI step.
#
# HOW THE FIXTURE WORKS
# ---------------------
# We build a self-contained mirror of scripts/audit/tests/ under a tmp dir:
#
#   $FIX/
#     scripts/audit/tests/
#       _lib/exit-summary.sh        (copied from the real helper)
#       _lib/suite-discovery.sh     (copied — its `discover_suites` resolves
#                                    paths via BASH_SOURCE, so it walks the
#                                    fixture tree, not the real repo)
#       summary-format.sh           (copied — its ROOT is computed from
#                                    `dirname "$0"`, so it also roots into
#                                    the fixture)
#       bad-suite.sh                (intentionally broken — exits 0 but
#                                    emits no "── Exit-code summary ──"
#                                    header, so the auto-discovery layer
#                                    must record a failure)
#
# We then run the fixture's summary-format.sh with
# SUMMARY_FORMAT_SKIP_PINNED=1 (so Layer 1's pinned SUITES — which still
# reference the real cli-exit-codes.sh / strict-mode.sh / etc. paths — are
# bypassed; we are intentionally testing only the artifact-emission path)
# and SUMMARY_FAILURE_DIR pointing at $FIX/out. The expectation is:
#
#   - exit code 1 (mismatch detected)
#   - $FIX/out/FAILURES.md exists, references scripts/audit/tests/bad-suite.sh,
#     and includes the documented "no Exit-code summary" reason text
#   - $FIX/out/index.html exists, is a valid <html>...</html> doc, links to
#     bad-suite.sh.log, and references scripts/audit/tests/bad-suite.sh
#   - $FIX/out/bad-suite.sh.log exists and is non-empty (the captured
#     stdout+stderr of the broken suite)

set -u

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
REAL_TESTS="$ROOT/scripts/audit/tests"

FIX=$(mktemp -d -t summary-format-fail-artifact.XXXXXX)
trap 'rm -rf "$FIX"' EXIT

FIX_TESTS="$FIX/scripts/audit/tests"
FIX_LIB="$FIX_TESTS/_lib"
FIX_OUT="$FIX/out"
mkdir -p "$FIX_LIB" "$FIX_OUT"

# Copy the helpers + the script under test. Use `cp` (not symlinks) so the
# fixture is a true isolated mirror — symlinks would leak BASH_SOURCE back
# to the real repo and `discover_suites` would walk the real tests dir.
cp "$REAL_TESTS/_lib/exit-summary.sh"     "$FIX_LIB/exit-summary.sh"
cp "$REAL_TESTS/_lib/suite-discovery.sh"  "$FIX_LIB/suite-discovery.sh"
cp "$REAL_TESTS/summary-format.sh"        "$FIX_TESTS/summary-format.sh"
chmod +x "$FIX_TESTS/summary-format.sh"

# The deliberately-broken suite. It exits 0 but emits no Exit-code summary
# block, so the auto-discovery layer must classify it as a contract
# violation with reason "expected exactly 1 \"── Exit-code summary ──\" line".
cat >"$FIX_TESTS/bad-suite.sh" <<'BAD'
#!/usr/bin/env bash
# Intentionally broken fixture suite used by summary-format.fail-artifact.sh
# to verify that summary-format.sh records a failure AND uploads the
# expected artifact contents. Do NOT add the exit-summary helper here.
set -u
echo "this suite intentionally emits no '── Exit-code summary ──' block"
exit 0
BAD
chmod +x "$FIX_TESTS/bad-suite.sh"

n=0
fail=0
pass() { n=$((n+1)); echo "  ✓ [$n] $1"; }
xfail() { n=$((n+1)); fail=$((fail+1)); echo "  ✗ [$n] $1"; }
assert_contains() {
  local file="$1" needle="$2" desc="$3"
  if grep -qF -- "$needle" "$file"; then
    pass "$desc"
  else
    xfail "$desc — needle not found in $file: $needle"
    echo "    --- $file (first 60 lines) ---"
    sed -n '1,60p' "$file" | sed 's/^/    /'
  fi
}

echo "── fixture: $FIX ──"

# Run the fixture's summary-format.sh and capture both stdout+stderr and
# the exit code. SUMMARY_FORMAT_SKIP_PINNED bypasses the Layer 1 pinned
# loop (which still references real repo paths and would error otherwise).
SF_LOG="$FIX/summary-format.stdout.log"
set +e
SUMMARY_FORMAT_SKIP_PINNED=1 \
SUMMARY_FAILURE_DIR="$FIX_OUT" \
  bash "$FIX_TESTS/summary-format.sh" >"$SF_LOG" 2>&1
SF_EXIT=$?
set -e

echo "── summary-format.sh exit: $SF_EXIT ──"

# 1) Mismatch must be detected → exit 1 (not 0, not 2).
if [ "$SF_EXIT" -eq 1 ]; then
  pass "summary-format.sh exited 1 on intentional mismatch"
else
  xfail "summary-format.sh exited $SF_EXIT — expected 1 (intentional mismatch)"
  echo "    --- captured stdout+stderr ---"
  sed -n '1,80p' "$SF_LOG" | sed 's/^/    /'
fi

# 2) Artifact dir must exist and not be cleaned up on failure.
if [ -d "$FIX_OUT" ]; then
  pass "artifact dir survived (not removed on failure path)"
else
  xfail "artifact dir $FIX_OUT was removed — should persist on failure"
fi

# 3) FAILURES.md must exist and reference the broken suite + reason.
if [ -f "$FIX_OUT/FAILURES.md" ]; then
  pass "FAILURES.md present in artifact dir"
  assert_contains "$FIX_OUT/FAILURES.md" \
    "scripts/audit/tests/bad-suite.sh" \
    "FAILURES.md references the broken suite path"
  assert_contains "$FIX_OUT/FAILURES.md" \
    "── Exit-code summary ──" \
    "FAILURES.md mentions the missing 'Exit-code summary' header in the reason"
  assert_contains "$FIX_OUT/FAILURES.md" \
    "bad-suite.sh.log" \
    "FAILURES.md links to the per-suite log filename"
else
  xfail "FAILURES.md missing from artifact dir"
fi

# 4) index.html must exist, be a real HTML document, and reference the suite.
if [ -f "$FIX_OUT/index.html" ]; then
  pass "index.html present in artifact dir"
  assert_contains "$FIX_OUT/index.html" "<!doctype html>" \
    "index.html opens with a doctype"
  assert_contains "$FIX_OUT/index.html" "</html>" \
    "index.html closes its <html> root"
  assert_contains "$FIX_OUT/index.html" "summary-format.sh failures" \
    "index.html carries the failure-page title"
  assert_contains "$FIX_OUT/index.html" "scripts/audit/tests/bad-suite.sh" \
    "index.html references the broken suite path"
  assert_contains "$FIX_OUT/index.html" 'href="bad-suite.sh.log"' \
    "index.html links to the per-suite log file"
  assert_contains "$FIX_OUT/index.html" 'href="FAILURES.md"' \
    "index.html links to FAILURES.md"
else
  xfail "index.html missing from artifact dir"
fi

# 5) Per-suite log must exist, be non-empty, AND wrap the captured suite
#    stdout+stderr in the documented banner so reviewers get reason +
#    metadata + verbatim suite output in a single file.
LOG="$FIX_OUT/bad-suite.sh.log"
if [ -s "$LOG" ]; then
  pass "bad-suite.sh.log present and non-empty"
  assert_contains "$LOG" \
    "this suite intentionally emits no" \
    "bad-suite.sh.log preserves the broken suite's verbatim stdout"
  assert_contains "$LOG" \
    "summary-format.sh — captured failure" \
    "bad-suite.sh.log carries the capture banner"
  assert_contains "$LOG" \
    "Suite:         scripts/audit/tests/bad-suite.sh" \
    "bad-suite.sh.log banner names the failing suite"
  assert_contains "$LOG" \
    "Suite exit:    0" \
    "bad-suite.sh.log banner records the suite's actual exit code"
  assert_contains "$LOG" \
    "Reason:" \
    "bad-suite.sh.log banner includes the validator's diagnostic reason"
  assert_contains "$LOG" \
    "──────── BEGIN suite stdout+stderr ────────" \
    "bad-suite.sh.log marks the start of the verbatim suite output"
  assert_contains "$LOG" \
    "──────── END suite stdout+stderr ────────" \
    "bad-suite.sh.log marks the end of the verbatim suite output"
else
  xfail "bad-suite.sh.log missing or empty in artifact dir"
fi

# 6) The captured CI stdout must point a reviewer at the artifact + name
#    every artifact file explicitly (so log forensics doesn't depend on
#    knowing the layout by heart).
assert_contains "$SF_LOG" "FAILURES.md" \
  "summary-format stdout names FAILURES.md in the failure tail"
assert_contains "$SF_LOG" "index.html" \
  "summary-format stdout names index.html in the failure tail"
assert_contains "$SF_LOG" "<suite-basename>.log" \
  "summary-format stdout names the per-suite log pattern in the failure tail"
assert_contains "$SF_LOG" "summary-format-failures" \
  "summary-format stdout names the actions/upload-artifact artifact name"

# 7) Defence in depth: nothing OUTSIDE $FIX_OUT/ should have been written.
#    (Guards against an env-variable mishandling regression that ignores
#    SUMMARY_FAILURE_DIR and writes into $ROOT/.summary-format-failures.)
if [ -e "$FIX/scripts/audit/tests/.summary-format-failures" ]; then
  xfail "fixture's tests/ dir contains a stray .summary-format-failures — \
SUMMARY_FAILURE_DIR override was ignored"
else
  pass "no stray .summary-format-failures dir created outside the override"
fi

# 8) Lifecycle contract: a SUCCESSFUL summary-format.sh run must always
#    clean up FAIL_DIR via its EXIT trap, leaving no on-disk residue.
#    Replace the intentionally broken suite with a well-formed one,
#    re-run against the same fixture, and assert the artifact dir is gone.
cat >"$FIX_TESTS/bad-suite.sh" <<'GOOD'
#!/usr/bin/env bash
set -u
. "$(dirname "$0")/_lib/exit-summary.sh"
summary_init
summary_set_label 0 "exit 0 — pass"
summary_set_label 1 "exit 1 — drift detected"
summary_set_label 2 "exit 2 — invalid args"
summary_record 0 0 "fixture suite: green path"
summary_print 0 1 2
GOOD
chmod +x "$FIX_TESTS/bad-suite.sh"

SF_LOG_GREEN="$FIX/summary-format.stdout.green.log"
set +e
SUMMARY_FORMAT_SKIP_PINNED=1 \
SUMMARY_FAILURE_DIR="$FIX_OUT" \
  bash "$FIX_TESTS/summary-format.sh" >"$SF_LOG_GREEN" 2>&1
SF_EXIT_GREEN=$?
set -e

echo "── summary-format.sh (green re-run) exit: $SF_EXIT_GREEN ──"

if [ "$SF_EXIT_GREEN" -eq 0 ]; then
  pass "summary-format.sh exits 0 on green re-run"
else
  xfail "summary-format.sh exited $SF_EXIT_GREEN on green re-run — expected 0"
  sed -n '1,80p' "$SF_LOG_GREEN" | sed 's/^/    /'
fi

if [ ! -e "$FIX_OUT" ]; then
  pass "FAIL_DIR removed by EXIT trap on green run (no on-disk residue)"
else
  xfail "FAIL_DIR $FIX_OUT survived a green run — EXIT trap cleanup regressed"
  ls -la "$FIX_OUT" | sed 's/^/    /'
fi

echo
if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n fail-artifact assertions failed."
  echo "  Fixture preserved at: $FIX (will be removed on EXIT)"
  echo "  Re-run with: SUMMARY_FORMAT_SKIP_PINNED=1 SUMMARY_FAILURE_DIR=<dir> \\"
  echo "    bash scripts/audit/tests/summary-format.sh"
  exit 1
fi
echo "✓ All $n fail-artifact assertions passed."

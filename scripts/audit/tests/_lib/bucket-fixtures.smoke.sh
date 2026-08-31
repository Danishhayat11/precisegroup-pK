#!/usr/bin/env bash
# Smoke test for _lib/bucket-fixtures.sh.
#
# Pins two contracts so consumers can trust the helpers without
# re-deriving the bucket-body grammar in every test:
#
#   1) Each emit_* produces a syntactically valid suite that, when
#      executed, prints the exact line shapes summary-format.sh
#      classifies as "placeholder", "records", or "mixed".
#   2) Running summary-format.sh against each fixture in an isolated
#      mirror produces the documented outcome:
#        - placeholder_only → contract holds (exit 0, no FAILURES)
#        - records_only     → contract holds (exit 0, no FAILURES)
#        - mixed            → contract violation (exit 1, FAILURES
#                             names the "mixes placeholder + ✓/✗" reason)
#
# If you change bucket-fixtures.sh, update assertions here in the same
# edit — the smoke test is the single source of truth for what each
# fixture is supposed to look like on disk.

set -u

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
REAL_TESTS="$ROOT/scripts/audit/tests"

# shellcheck disable=SC1091
source "$REAL_TESTS/_lib/bucket-fixtures.sh"

n=0
fail=0
pass()  { n=$((n+1)); echo "  ✓ [$n] $1"; }
xfail() { n=$((n+1)); fail=$((fail+1)); echo "  ✗ [$n] $1"; }

echo "── _lib/bucket-fixtures.sh smoke tests ──"

# ── Part 1: emitted suite shape ──────────────────────────────────────
out_placeholder=$(emit_placeholder_only_suite)
out_records=$(emit_records_only_suite)
out_mixed=$(emit_mixed_bucket_suite)
out_mixed_2=$(emit_mixed_bucket_suite 2)

# Every fixture must carry the canonical header exactly once.
for label in placeholder_only:"$out_placeholder" records_only:"$out_records" mixed:"$out_mixed"; do
  kind="${label%%:*}"; body="${label#*:}"
  hdr=$(grep -cF "── Exit-code summary ──" <<<"$body" || true)
  if [ "$hdr" = "1" ]; then
    pass "$kind — header appears exactly once"
  else
    xfail "$kind — header count = $hdr (expected 1)"
  fi
done

# Placeholder-only: every canonical bucket body is the literal placeholder line.
placeholder_count=$(grep -cF -- "$BUCKET_PLACEHOLDER_LINE" <<<"$out_placeholder" || true)
if [ "$placeholder_count" = "3" ]; then
  pass "placeholder_only — three placeholder bodies emitted"
else
  xfail "placeholder_only — placeholder count = $placeholder_count (expected 3)"
fi
if grep -qE '^echo "  ✓' <<<"$out_placeholder"; then
  xfail "placeholder_only — leaked a ✓ row into a placeholder fixture"
else
  pass "placeholder_only — no ✓ rows leaked in"
fi

# Records-only: every canonical bucket has a ✓ row, no placeholder line.
records_count=$(grep -cE '^echo "  ✓' <<<"$out_records" || true)
if [ "$records_count" = "3" ]; then
  pass "records_only — three ✓ rows emitted"
else
  xfail "records_only — ✓ row count = $records_count (expected 3)"
fi
if grep -qF -- "$BUCKET_PLACEHOLDER_LINE" <<<"$out_records"; then
  xfail "records_only — leaked a placeholder line into a records-only fixture"
else
  pass "records_only — no placeholder line leaked in"
fi

# Mixed (default code=1): exactly one bucket contains BOTH shapes.
if grep -qF -- "$BUCKET_PLACEHOLDER_LINE" <<<"$out_mixed" \
   && grep -qE '^echo "  ✓' <<<"$out_mixed"; then
  pass "mixed (default) — placeholder + ✓ rows both present"
else
  xfail "mixed (default) — missing placeholder or ✓ rows"
fi

# Mixed code=2 must splice the placeholder into the exit-2 bucket, not exit-1.
if grep -q $'exit 2 — strict missing pin:\\\\n  ✓' <<<"$out_mixed_2" 2>/dev/null; then :; fi
# Easier: run the fixture and look at the order.
tmp_mixed2=$(mktemp)
printf '%s\n' "$out_mixed_2" >"$tmp_mixed2"
chmod +x "$tmp_mixed2"
mixed2_run=$(bash "$tmp_mixed2")
rm -f "$tmp_mixed2"
# Extract the body that immediately follows "exit 2 — ...:". It must
# contain both the ✓ row and the placeholder line back-to-back.
mixed2_tail=$(awk '/^exit 2 — /{flag=1; next} /^exit [0-9]+ — /{flag=0} flag' <<<"$mixed2_run")
if grep -qE '^  ✓' <<<"$mixed2_tail" && grep -qF -- "$BUCKET_PLACEHOLDER_LINE" <<<"$mixed2_tail"; then
  pass "mixed (code=2) — splices into the exit-2 bucket"
else
  xfail "mixed (code=2) — exit-2 bucket does not contain both shapes"
  echo "    --- exit-2 body ---"
  printf '%s\n' "$mixed2_tail" | sed 's/^/    /'
fi

# Invalid code argument must be rejected with a non-zero return.
set +e
emit_mixed_bucket_suite 9 >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ]; then
  pass "mixed — invalid code argument rejected (rc=$rc)"
else
  xfail "mixed — invalid code argument silently accepted"
fi

# fixture_kinds enumerates the three canonical shapes, in order.
kinds_out=$(fixture_kinds | tr '\n' ' ')
if [ "$kinds_out" = "placeholder_only records_only mixed " ]; then
  pass "fixture_kinds — enumerates placeholder_only / records_only / mixed in order"
else
  xfail "fixture_kinds — got '$kinds_out'"
fi

# ── Part 2: end-to-end behaviour against summary-format.sh ───────────
# Build an isolated mirror so summary-format.sh's auto-discovery only
# sees the one fixture we drop in.
mk_mirror() {
  local kind="$1" suite_basename="$2" code="${3:-1}"
  local fix fix_tests fix_lib
  fix=$(mktemp -d -t bucket-fixtures-smoke.XXXXXX)
  fix_tests="$fix/scripts/audit/tests"
  fix_lib="$fix_tests/_lib"
  mkdir -p "$fix_lib" "$fix/out"
  cp "$REAL_TESTS/_lib/exit-summary.sh"    "$fix_lib/exit-summary.sh"
  cp "$REAL_TESTS/_lib/suite-discovery.sh" "$fix_lib/suite-discovery.sh"
  cp "$REAL_TESTS/summary-format.sh"       "$fix_tests/summary-format.sh"
  chmod +x "$fix_tests/summary-format.sh"
  write_bucket_fixture "$kind" "$fix_tests/$suite_basename" "$code"
  printf '%s' "$fix"
}

run_validator() {
  local fix="$1"
  local sf_log="$fix/summary-format.stdout.log"
  set +e
  SUMMARY_FORMAT_SKIP_PINNED=1 \
  SUMMARY_FAILURE_DIR="$fix/out" \
    bash "$fix/scripts/audit/tests/summary-format.sh" >"$sf_log" 2>&1
  echo $?
  set -e
}

# placeholder_only → contract holds.
FIX_P=$(mk_mirror placeholder_only "placeholder-only.sh")
rc_p=$(run_validator "$FIX_P")
if [ "$rc_p" = "0" ]; then
  pass "placeholder_only end-to-end — summary-format.sh exited 0"
else
  xfail "placeholder_only end-to-end — exited $rc_p (expected 0)"
  sed -n '1,40p' "$FIX_P/summary-format.stdout.log" | sed 's/^/    /'
fi
if [ ! -f "$FIX_P/out/FAILURES.md" ]; then
  pass "placeholder_only end-to-end — no FAILURES.md written"
else
  xfail "placeholder_only end-to-end — unexpected FAILURES.md"
fi
rm -rf "$FIX_P"

# records_only → contract holds.
FIX_R=$(mk_mirror records_only "records-only.sh")
rc_r=$(run_validator "$FIX_R")
if [ "$rc_r" = "0" ]; then
  pass "records_only end-to-end — summary-format.sh exited 0"
else
  xfail "records_only end-to-end — exited $rc_r (expected 0)"
  sed -n '1,40p' "$FIX_R/summary-format.stdout.log" | sed 's/^/    /'
fi
if [ ! -f "$FIX_R/out/FAILURES.md" ]; then
  pass "records_only end-to-end — no FAILURES.md written"
else
  xfail "records_only end-to-end — unexpected FAILURES.md"
fi
rm -rf "$FIX_R"

# mixed → contract violation, with the documented reason text.
FIX_M=$(mk_mirror mixed "mixed-bucket.sh" 1)
rc_m=$(run_validator "$FIX_M")
if [ "$rc_m" = "1" ]; then
  pass "mixed end-to-end — summary-format.sh exited 1 (violation detected)"
else
  xfail "mixed end-to-end — exited $rc_m (expected 1)"
  sed -n '1,60p' "$FIX_M/summary-format.stdout.log" | sed 's/^/    /'
fi
if [ -f "$FIX_M/out/FAILURES.md" ] \
   && grep -qF "mixes placeholder + ✓/✗ rows" "$FIX_M/out/FAILURES.md"; then
  pass "mixed end-to-end — FAILURES.md carries the documented reason"
else
  xfail "mixed end-to-end — FAILURES.md missing or wrong reason"
  [ -f "$FIX_M/out/FAILURES.md" ] && sed -n '1,40p' "$FIX_M/out/FAILURES.md" | sed 's/^/    /'
fi
rm -rf "$FIX_M"

echo
if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n bucket-fixtures smoke assertions failed"
  exit 1
fi
echo "✓ All $n bucket-fixtures smoke assertions passed"

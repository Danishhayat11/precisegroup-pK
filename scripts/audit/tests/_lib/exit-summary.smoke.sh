#!/usr/bin/env bash
# Smoke test for scripts/audit/tests/_lib/exit-summary.sh.
#
# Exercises the helper directly (no auditor, no psql, no DB) and pins:
#   • the "── Exit-code summary ──" header is emitted exactly once
#   • buckets render in the order passed to summary_print (0, 1, 2)
#   • passing rows render as "  ✓ <desc>"
#   • failing rows render as "  ✗ <desc> (got exit N)" under the *expected*
#     code, not the actual one — the summary must reflect the contract row
#     that broke
#   • empty buckets render the literal "(no scenarios exercised this code)"
#   • summary_set_label overrides reach the rendered output
#   • tricky label values (empty, whitespace-only, multi-line) are passed
#     through verbatim while the 0 → 1 → 2 bucket order is preserved
#
# Pure-bash; no `node` or other deps required.

set -u

HELPER="$(cd "$(dirname "$0")" && pwd)/exit-summary.sh"
HEADER="── Exit-code summary ──"
fail=0
n=0

assert_contains() {
  # $1 = desc, $2 = needle (single-line), $3 = haystack
  n=$((n+1))
  if grep -qF -- "$2" <<<"$3"; then
    echo "✓ [$n] $1"
  else
    echo "✗ [$n] $1 — missing: \"$2\""
    fail=$((fail+1))
  fi
}

# Whole-line match — required for blank/whitespace heading lines where
# `grep -F` would otherwise treat embedded newlines as alternation.
assert_line() {
  # $1 = desc, $2 = exact line, $3 = haystack
  n=$((n+1))
  if grep -qxF -- "$2" <<<"$3"; then
    echo "✓ [$n] $1"
  else
    echo "✗ [$n] $1 — missing exact line: \"$2\""
    fail=$((fail+1))
  fi
}

assert_count() {
  # $1 = desc, $2 = expected count, $3 = needle, $4 = haystack
  n=$((n+1))
  local got
  got=$(grep -cF -- "$3" <<<"$4" || true)
  if [ "$got" = "$2" ]; then
    echo "✓ [$n] $1 (count=$got)"
  else
    echo "✗ [$n] $1 — expected count $2, got $got for \"$3\""
    fail=$((fail+1))
  fi
}

assert_order() {
  # $1 = desc, then needles in expected order, last arg = haystack.
  # Each needle is matched line-by-line as a substring (single-line only).
  local desc="$1"; shift
  local args=("$@")
  local haystack="${args[-1]}"
  unset 'args[-1]'
  n=$((n+1))
  local last=0 needle pos
  for needle in "${args[@]}"; do
    pos=$(awk -v s="$needle" 'index($0,s){print NR; exit}' <<<"$haystack")
    if [ -z "$pos" ] || [ "$pos" -le "$last" ]; then
      echo "✗ [$n] $desc — \"$needle\" out of order (pos=${pos:-none}, last=$last)"
      fail=$((fail+1))
      return
    fi
    last="$pos"
  done
  echo "✓ [$n] $desc"
}

# ── Scenario A: all-pass, default labels, codes 0/1/2 ───────────────────
SCEN_A=$(
  # shellcheck source=_lib/exit-summary.sh
  source "$HELPER"
  summary_init
  summary_record 0 0 "scenario-a-pass-zero"
  summary_record 1 1 "scenario-a-pass-one"
  summary_record 2 2 "scenario-a-pass-two"
  summary_print 0 1 2
)

echo "── Scenario A: all-pass with default labels ──"
assert_count    "header appears exactly once"  1 "$HEADER" "$SCEN_A"
assert_contains "default label for exit 0" "exit 0 — pass / warn-mode:" "$SCEN_A"
assert_contains "default label for exit 1" "exit 1 — drift detected:" "$SCEN_A"
assert_contains "default label for exit 2" "exit 2 — strict missing pin / invalid args:" "$SCEN_A"
assert_contains "pass row formatted with ✓"  "  ✓ scenario-a-pass-zero" "$SCEN_A"
assert_contains "pass row for exit 1"        "  ✓ scenario-a-pass-one"  "$SCEN_A"
assert_contains "pass row for exit 2"        "  ✓ scenario-a-pass-two"  "$SCEN_A"
assert_order "buckets render in print order 0 → 1 → 2" \
  "$HEADER" \
  "exit 0 — pass / warn-mode:" \
  "  ✓ scenario-a-pass-zero" \
  "exit 1 — drift detected:" \
  "  ✓ scenario-a-pass-one" \
  "exit 2 — strict missing pin / invalid args:" \
  "  ✓ scenario-a-pass-two" \
  "$SCEN_A"

# ── Scenario B: failing row buckets under EXPECTED code with "(got exit N)" ─
SCEN_B=$(
  # shellcheck source=_lib/exit-summary.sh
  source "$HELPER"
  summary_init
  summary_record 1 0 "expected-one-got-zero"   # contract row for exit 1
  summary_print 0 1 2
)

echo
echo "── Scenario B: failing row attribution ──"
assert_contains "failing row filed under EXPECTED code (exit 1 bucket)" \
  "  ✗ expected-one-got-zero (got exit 0)" "$SCEN_B"
# It must NOT appear under the actual code's bucket.
n=$((n+1))
if awk '
  /exit 0 — pass \/ warn-mode:/ { in0=1; next }
  /^exit / { in0=0 }
  in0 && /expected-one-got-zero/ { found=1 }
  END { exit found ? 1 : 0 }
' <<<"$SCEN_B"; then
  echo "✓ [$n] failing row does NOT leak into actual-code bucket (exit 0)"
else
  echo "✗ [$n] failing row leaked into the exit-0 bucket"
  fail=$((fail+1))
fi
assert_contains "empty exit-2 bucket renders placeholder" \
  "  (no scenarios exercised this code)" "$SCEN_B"

# ── Scenario C: summary_set_label override reaches output ────────────────
SCEN_C=$(
  # shellcheck source=_lib/exit-summary.sh
  source "$HELPER"
  summary_init
  summary_set_label 1 "exit 1 — custom override for smoke test"
  summary_record 1 1 "scenario-c-row"
  summary_print 0 1 2
)

echo
echo "── Scenario C: summary_set_label override ──"
assert_contains "overridden label appears verbatim" \
  "exit 1 — custom override for smoke test:" "$SCEN_C"
# Confirm the default label for that code is *gone* from the output.
n=$((n+1))
if grep -qF -- "exit 1 — drift detected:" <<<"$SCEN_C"; then
  echo "✗ [$n] default exit-1 label still present after override"
  fail=$((fail+1))
else
  echo "✓ [$n] default exit-1 label fully replaced by override"
fi

# ── Scenario D: custom print order is honored ───────────────────────────
SCEN_D=$(
  # shellcheck source=_lib/exit-summary.sh
  source "$HELPER"
  summary_init
  summary_record 0 0 "d-zero"
  summary_record 2 2 "d-two"
  summary_print 2 0 1
)

echo
echo "── Scenario D: print order honored ──"
assert_order "summary_print 2 0 1 renders buckets in that order" \
  "exit 2 — strict missing pin / invalid args:" \
  "exit 0 — pass / warn-mode:" \
  "exit 1 — drift detected:" \
  "$SCEN_D"

# ── Scenario E: empty label override still renders bucket in 0/1/2 order ─
SCEN_E=$(
  # shellcheck source=_lib/exit-summary.sh
  source "$HELPER"
  summary_init
  summary_set_label 1 ""
  summary_record 0 0 "e-zero"
  summary_record 1 1 "e-one"
  summary_record 2 2 "e-two"
  summary_print 0 1 2
)

echo
echo "── Scenario E: empty label override (falls back to 'exit 1') ──"
# Documented quirk: summary_print uses ${SUMMARY_LABELS[$code]:-exit $code},
# so an empty-string override is indistinguishable from "unset" and falls
# back to the generic "exit <code>" heading. The bucket body still renders
# in 0/1/2 order — that's the contract we pin here.
assert_line "empty override falls back to generic 'exit 1:' heading" \
  "exit 1:" "$SCEN_E"
n=$((n+1))
if grep -qF -- "exit 1 — drift detected:" <<<"$SCEN_E"; then
  echo "✗ [$n] default exit-1 label leaked through empty override"
  fail=$((fail+1))
else
  echo "✓ [$n] empty override fully suppresses default exit-1 label"
fi
assert_contains "exit-1 row still recorded under empty-labelled bucket" \
  "  ✓ e-one" "$SCEN_E"
assert_order "bucket order 0 → (empty→'exit 1:') → 2 preserved" \
  "$HEADER" \
  "exit 0 — pass / warn-mode:" \
  "  ✓ e-zero" \
  "exit 1:" \
  "  ✓ e-one" \
  "exit 2 — strict missing pin / invalid args:" \
  "  ✓ e-two" \
  "$SCEN_E"
# Fallback heading must sit between the exit-0 row and the exit-1 row.
n=$((n+1))
if awk '
  /^  ✓ e-zero$/                  { seen_zero=1; next }
  seen_zero && /^exit 1:$/        { seen_heading=1; next }
  seen_heading && /^  ✓ e-one$/   { ok=1 }
  END { exit ok ? 0 : 1 }
' <<<"$SCEN_E"; then
  echo "✓ [$n] 'exit 1:' fallback heading sits between exit-0 and exit-1 rows"
else
  echo "✗ [$n] fallback heading not positioned between buckets"
  fail=$((fail+1))
fi

# ── Scenario F: whitespace-only label preserved verbatim ────────────────
WS_LABEL="   "   # three spaces, no trailing colon (helper appends ":")
SCEN_F=$(
  # shellcheck source=_lib/exit-summary.sh
  source "$HELPER"
  summary_init
  summary_set_label 1 "   "
  summary_record 0 0 "f-zero"
  summary_record 1 1 "f-one"
  summary_record 2 2 "f-two"
  summary_print 0 1 2
)

echo
echo "── Scenario F: whitespace-only label ──"
assert_line "whitespace label rendered verbatim with ':' suffix" \
  "${WS_LABEL}:" "$SCEN_F"
n=$((n+1))
# Make sure whitespace was NOT trimmed to a bare ":" line.
if grep -qxF -- ":" <<<"$SCEN_F"; then
  echo "✗ [$n] whitespace label was collapsed to bare ':'"
  fail=$((fail+1))
else
  echo "✓ [$n] whitespace label retained its spaces (no trim)"
fi
assert_contains "exit-1 row still files under whitespace-labelled bucket" \
  "  ✓ f-one" "$SCEN_F"
assert_order "bucket order 0 → (whitespace) → 2 preserved" \
  "$HEADER" \
  "  ✓ f-zero" \
  "${WS_LABEL}:" \
  "  ✓ f-one" \
  "exit 2 — strict missing pin / invalid args:" \
  "  ✓ f-two" \
  "$SCEN_F"

# ── Scenario G: multi-line label preserved across embedded newlines ─────
ML_LINE1="exit 1 — drift detected"
ML_LINE2="    (see scripts/audit/README.md → CI interpretation)"
SCEN_G=$(
  # shellcheck source=_lib/exit-summary.sh
  source "$HELPER"
  summary_init
  summary_set_label 1 "$(printf '%s\n%s' \
    "exit 1 — drift detected" \
    "    (see scripts/audit/README.md → CI interpretation)")"
  summary_record 0 0 "g-zero"
  summary_record 1 1 "g-one"
  summary_record 2 2 "g-two"
  summary_print 0 1 2
)

echo
echo "── Scenario G: multi-line label ──"
assert_line "first line of multi-line label rendered verbatim" \
  "$ML_LINE1" "$SCEN_G"
# The helper appends ":" to the label as a single echo, so only the LAST
# line of a multi-line label should carry the trailing colon.
assert_line "trailing ':' attaches to the LAST line only" \
  "${ML_LINE2}:" "$SCEN_G"
n=$((n+1))
if grep -qxF -- "${ML_LINE1}:" <<<"$SCEN_G"; then
  echo "✗ [$n] trailing ':' incorrectly attached to first label line"
  fail=$((fail+1))
else
  echo "✓ [$n] first label line is colon-free (no premature suffix)"
fi
# Bucket ordering must survive the embedded newline.
assert_order "bucket order 0 → (multi-line) → 2 preserved across newlines" \
  "$HEADER" \
  "exit 0 — pass / warn-mode:" \
  "  ✓ g-zero" \
  "$ML_LINE1" \
  "${ML_LINE2}:" \
  "  ✓ g-one" \
  "exit 2 — strict missing pin / invalid args:" \
  "  ✓ g-two" \
  "$SCEN_G"
# Exit-1 row must not slip into a neighbouring bucket.
n=$((n+1))
if awk -v ml1="$ML_LINE1" '
  /^exit 0 — pass \/ warn-mode:$/ { in0=1; next }
  $0 == ml1                       { in0=0 }
  /^exit 2 — strict/              { in0=0 }
  in0 && /g-one/                  { found=1 }
  END { exit found ? 1 : 0 }
' <<<"$SCEN_G"; then
  echo "✓ [$n] multi-line exit-1 row did not leak into the exit-0 bucket"
else
  echo "✗ [$n] multi-line exit-1 row leaked into the exit-0 bucket"
  fail=$((fail+1))
fi
# Both label lines must appear on consecutive lines (no bucket body wedged).
n=$((n+1))
if awk -v l1="$ML_LINE1" -v l2="${ML_LINE2}:" '
  prev && NR == prev+1 && $0 == l2 { ok=1 }
  $0 == l1 { prev=NR }
  END { exit ok ? 0 : 1 }
' <<<"$SCEN_G"; then
  echo "✓ [$n] multi-line label lines render on consecutive lines"
else
  echo "✗ [$n] multi-line label lines were split apart"
  fail=$((fail+1))
fi

echo
if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n exit-summary smoke assertions failed."
  exit 1
fi
echo "✓ All $n exit-summary smoke assertions passed."

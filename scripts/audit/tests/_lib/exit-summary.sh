#!/usr/bin/env bash
# Shared helpers for audit CLI test scripts.
#
# Every test script in scripts/audit/tests/ ends with a "── Exit-code
# summary ──" block grouping each scenario under its expected exit code,
# with labels aligned to scripts/audit/README.md → "CI interpretation".
# Keeping that block identical across files matters: CI reviewers grep
# the same headings to answer "which scenario produced exit N?".
#
# Usage:
#
#   source "$(dirname "$0")/_lib/exit-summary.sh"
#   summary_init                       # creates $SUMMARY_TMP + trap
#   summary_record <expected> <actual> <desc>   # call from your asserter
#   # optionally override labels before printing:
#   #   summary_set_label 3 "exit 3 — infrastructure failure"
#   summary_print 0 1 2                # codes to render, in order
#
# `summary_record` files the scenario under <expected> when it fails
# (annotated with the actual code) and under <actual> when it passes,
# matching the convention established in cli-exit-codes.sh so a broken
# contract row still shows up in the row it was supposed to cover.

# Default labels — mirror scripts/audit/README.md "CI interpretation".
# A test script may override any entry via `summary_set_label CODE "..."`
# before calling summary_print (e.g. branch-escalate.sh annotates exit 1
# as "drift / strict-on-default-branch escalation").
declare -gA SUMMARY_LABELS=(
  [0]="exit 0 — pass / warn-mode"
  [1]="exit 1 — drift detected"
  [2]="exit 2 — strict missing pin / invalid args"
  [3]="exit 3 — infrastructure failure (psql missing / DB unreachable)"
)

summary_init() {
  SUMMARY_TMP="${SUMMARY_TMP:-$(mktemp -d)}"
  # Compose with any caller-supplied EXIT trap rather than clobbering it.
  local existing
  existing=$(trap -p EXIT | sed -E "s/^trap -- '(.*)' EXIT$/\1/")
  if [ -n "$existing" ]; then
    # shellcheck disable=SC2064
    trap "rm -rf \"$SUMMARY_TMP\"; $existing" EXIT
  else
    # shellcheck disable=SC2064
    trap "rm -rf \"$SUMMARY_TMP\"" EXIT
  fi
}

summary_set_label() {
  # $1 = exit code, $2 = label
  SUMMARY_LABELS[$1]="$2"
}

summary_record() {
  # $1 = expected exit, $2 = actual exit, $3 = scenario description
  local expected="$1" actual="$2" desc="$3"
  : "${SUMMARY_TMP:?summary_init must be called before summary_record}"
  if [ "$actual" = "$expected" ]; then
    printf '  ✓ %s\n' "$desc" >>"$SUMMARY_TMP/bucket.$actual"
  else
    # File under the *expected* code so the table still reflects which
    # contract row broke, annotated with the actual code observed.
    printf '  ✗ %s (got exit %s)\n' "$desc" "$actual" >>"$SUMMARY_TMP/bucket.$expected"
  fi
}

summary_print() {
  # Args: the exit codes to render, in display order. Defaults to 0 1 2.
  : "${SUMMARY_TMP:?summary_init must be called before summary_print}"
  local codes=("$@")
  [ ${#codes[@]} -gt 0 ] || codes=(0 1 2)
  echo
  echo "── Exit-code summary ──"
  local code label
  for code in "${codes[@]}"; do
    label="${SUMMARY_LABELS[$code]:-exit $code}"
    echo "$label:"
    if [ -s "$SUMMARY_TMP/bucket.$code" ]; then
      cat "$SUMMARY_TMP/bucket.$code"
    else
      echo "  (no scenarios exercised this code)"
    fi
  done
  echo
}

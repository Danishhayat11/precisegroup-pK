#!/usr/bin/env bash
# Wraps scripts/audit/booking-reconciliation.mjs with the branch-escalation
# logic documented in scripts/audit/README.md → "Shell snippet (fail on
# drift, warn on missing pin)".
#
# Final exit code by audit exit:
#   0 → 0 (notice)
#   1 → 1 (drift, always fail)
#   2 → 1 on the default branch, 0 + ::warning elsewhere (missing pin)
#   3 → 3 (infra failure, surface as-is)
#   * → propagate
#
# Inputs (all via env so the wrapper is identical in every CI provider):
#   BOOKING_ID     — required, e.g. BK-MA-00014
#   GITHUB_REF     — branch ref (defaults to refs/heads/main if unset)
#   DEFAULT_BRANCH — branch that escalates exit 2 → 1 (default: main)
#
# Extra CLI args after `--` are forwarded to booking-reconciliation.mjs.
set -u

: "${BOOKING_ID:?BOOKING_ID is required}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
REF="${GITHUB_REF:-refs/heads/${DEFAULT_BRANCH}}"
BRANCH="${REF#refs/heads/}"

# Forward any args after a literal `--` to the auditor.
extra=()
seen_dash=0
for a in "$@"; do
  if [ "$seen_dash" -eq 1 ]; then extra+=("$a"); fi
  if [ "$a" = "--" ]; then seen_dash=1; fi
done

set +e
node scripts/audit/booking-reconciliation.mjs "$BOOKING_ID" "${extra[@]}"
status=$?
set -e

case "$status" in
  0)
    echo "::notice title=Audit OK::$BOOKING_ID matches pinned expectations (branch=$BRANCH)"
    exit 0
    ;;
  1)
    echo "::error title=Audit drift::$BOOKING_ID live totals differ from pinned snapshot"
    exit 1
    ;;
  2)
    if [ "$BRANCH" = "$DEFAULT_BRANCH" ]; then
      echo "::error title=Audit not pinned::$BOOKING_ID has no expectations file on $DEFAULT_BRANCH — pin the contract before merge"
      exit 1
    fi
    echo "::warning title=Audit not pinned::$BOOKING_ID has no expectations file (branch=$BRANCH, non-blocking)"
    exit 0
    ;;
  3)
    echo "::error title=Audit infra failure::psql missing or DB unreachable"
    exit 3
    ;;
  *)
    echo "::error title=Audit unknown failure::$BOOKING_ID exited with $status"
    exit "$status"
    ;;
esac

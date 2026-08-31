#!/usr/bin/env bash
# Single entrypoint to run every audit exit-summary check in a deterministic
# order, failing fast on the first non-zero exit. Intended for local pre-push
# sanity checks AND as a one-line CI invocation when you don't need per-step
# annotations in the GitHub Actions UI.
#
# Order matters and mirrors .github/workflows/security.yml → audit-cli-contract:
#
#   1. exit-summary.smoke.sh           — pins the shared helper itself first,
#                                        so a broken helper surfaces as a
#                                        helper bug, not as cascading
#                                        "missing label" failures across
#                                        every downstream suite.
#   2. cli-contract.sh                 — argv-only surface: --help, missing /
#                                        invalid / unknown flags. No psql
#                                        stub needed; pins the CLI contract
#                                        before any exit-code stubs run.
#   3. cli-exit-codes.sh               — happy-path / drift / missing-pin /
#                                        invalid-id scenarios (exit 0/1/2).
#   4. strict-mode.sh                  — --no-strict + AUDIT_STRICT + CI
#                                        escalation on main.
#   5. branch-escalate.sh              — feature-branch warn vs default-branch
#                                        fail wrapper.
#   6. required-args-and-db.sh         — required-arg failures (exit 2) and
#                                        infrastructure failures (exit 3).
#   7. summary-format.sh               — global guard: every audit test script
#                                        (pinned + auto-discovered) emits the
#                                        documented "── Exit-code summary ──"
#                                        block. Runs after the per-suite
#                                        checks because it shells out to each
#                                        of the above suites.
#   8. _lib/summary-format.meta.sh     — meta-test on summary-format.sh's
#                                        auto-discovery layer: pins canonical
#                                        render order and confirms run-all.sh
#                                        / summary-format.sh / _lib/ helpers
#                                        stay excluded. Runs after step 7 so
#                                        it validates the same render that
#                                        step just produced.
#   9. _lib/summary-format.fail-artifact.sh — regression test that
#                                        intentionally triggers a
#                                        summary-format mismatch in an
#                                        isolated fixture tree and asserts
#                                        the .summary-format-failures/
#                                        artifact contains FAILURES.md,
#                                        index.html, and per-suite .log
#                                        files. Runs last so the fixture
#                                        can't influence the real
#                                        auto-discovery layer above.

#
# Fails fast on the first non-zero exit (set -e). On failure, the trap prints
# which step broke so CI logs answer "which suite failed?" without scrolling.
#
# Usage:
#   bash scripts/audit/tests/run-all.sh           # run everything, fail fast
#   bash scripts/audit/tests/run-all.sh --list    # list ordered steps, exit 0

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TESTS_DIR="$ROOT/scripts/audit/tests"

# Shared suite-selection rules. Sourced (rather than re-implemented) so
# the curated STEPS array below can't drift from what summary-format.sh,
# cli-contract.sh, and _lib/summary-format.meta.sh see. `discover_suites`
# returns every top-level scripts/audit/tests/*.sh that isn't a built-in
# exempt (run-all.sh itself + summary-format.sh) or under _lib/.
# shellcheck source=./_lib/suite-discovery.sh
. "$TESTS_DIR/_lib/suite-discovery.sh"

# Step name | script path (relative to repo root). Keep in canonical order.
# Top-level suites (non-_lib paths) MUST match `discover_suites` exactly —
# the drift check below enforces this so a newly added suite can't be
# silently omitted from the local fail-fast runner.
STEPS=(
  "helper smoke (exit-summary.sh contract)|scripts/audit/tests/_lib/exit-summary.smoke.sh"
  "suite-discovery smoke (enumeration + set -u + fixtures)|scripts/audit/tests/_lib/suite-discovery.smoke.sh"
  "bucket fixtures smoke (placeholder / records / mixed shapes)|scripts/audit/tests/_lib/bucket-fixtures.smoke.sh"
  "cli-contract docs vs render (bucket layout drift gate)|scripts/audit/tests/_lib/cli-contract.docs.sh"
  "cli-contract example snippet parity (header + README ⇔ live render)|scripts/audit/tests/_lib/cli-contract.example.sh"



  "CLI contract (argv: help / invalid / unknown)|scripts/audit/tests/cli-contract.sh"
  "CLI exit codes (0 / 1 / 2 scenarios)|scripts/audit/tests/cli-exit-codes.sh"
  "strict mode (warn vs fail + CI-on-main)|scripts/audit/tests/strict-mode.sh"
  "branch escalation (feature warn vs main fail)|scripts/audit/tests/branch-escalate.sh"
  "required args + DB connection (exit 2 / 3)|scripts/audit/tests/required-args-and-db.sh"
  "summary-format guard (pinned + auto-discovered)|scripts/audit/tests/summary-format.sh"
  "summary-format meta (auto-discovery order + exclusions)|scripts/audit/tests/_lib/summary-format.meta.sh"
  "summary-format fail-artifact (intentional mismatch + artifact contents)|scripts/audit/tests/_lib/summary-format.fail-artifact.sh"
)

# Drift guard: every top-level suite that `discover_suites` returns MUST
# appear in STEPS, and every top-level (non-_lib) path in STEPS MUST be
# something `discover_suites` returns. _lib/* helper-smoke scripts are
# curated separately and excluded from the comparison by construction
# (suite-discovery's `-maxdepth 1` rule keeps them out of `discovered`).
# `summary-format.sh` is a built-in exempt of `discover_suites` but is
# orchestrated here, so it's added to the discovered set before diffing.
_run_all_drift_check() {
  local discovered steps_top
  discovered=$(
    {
      discover_suites
      echo "scripts/audit/tests/summary-format.sh"
    } | sort -u
  )
  steps_top=$(
    for step in "${STEPS[@]}"; do
      local path="${step#*|}"
      case "$path" in
        scripts/audit/tests/_lib/*) ;;
        *) printf '%s\n' "$path" ;;
      esac
    done | sort -u
  )
  if [ "$discovered" != "$steps_top" ]; then
    echo "✗ run-all.sh STEPS drifted from discover_suites output:" >&2
    echo "  --- discover_suites (∪ summary-format.sh) ---" >&2
    printf '  %s\n' $discovered >&2
    echo "  --- STEPS top-level (non-_lib) entries ---" >&2
    printf '  %s\n' $steps_top >&2
    echo "  Add/remove entries in STEPS so the two sets match." >&2
    exit 2
  fi
}
_run_all_drift_check


if [ "${1:-}" = "--list" ] || [ "${1:-}" = "-l" ]; then
  echo "Audit exit-summary checks (run order):"
  i=1
  for step in "${STEPS[@]}"; do
    echo "  $i. ${step%%|*}  →  ${step#*|}"
    i=$((i+1))
  done
  exit 0
fi


CURRENT_STEP=""
on_err() {
  local code=$?
  echo
  echo "✗ FAILED: $CURRENT_STEP (exit $code)"
  echo "  See output above for the first failing assertion."
  exit "$code"
}
trap on_err ERR

total=${#STEPS[@]}
i=0
for step in "${STEPS[@]}"; do
  i=$((i+1))
  name="${step%%|*}"
  script="${step#*|}"
  CURRENT_STEP="[$i/$total] $name ($script)"
  echo
  echo "═══ $CURRENT_STEP ═══"
  bash "$ROOT/$script"
done

echo
echo "✓ All $total audit exit-summary checks passed."

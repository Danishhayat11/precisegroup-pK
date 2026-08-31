#!/usr/bin/env bash
# Reusable bucket-shape fixtures for the audit test suite.
#
# `summary-format.sh` classifies every canonical 0/1/2 bucket as one of:
#   - "placeholder" — body is the literal "  (no scenarios exercised this code)" line.
#   - "records"     — body has one or more "  ✓ ..." / "  ✗ ..." rows.
#   - "mixed"       — body has BOTH (a contract violation; emitted as a hard fail).
#
# Multiple test scripts need to spin up tiny fake suites that exercise
# each of those shapes in isolation (negative tests, fail-artifact tests,
# new auto-discovery features, etc.). This file centralises those
# fixtures so every consumer agrees on the exact byte layout the
# validator expects to see.
#
# Public API (source this file, then call any of):
#
#   emit_placeholder_only_suite           # all three canonical codes empty
#   emit_records_only_suite               # all three with ✓ rows
#   emit_mixed_bucket_suite [code]        # default: code=1 mixes placeholder + ✓
#
# Each emit_* writes a complete, runnable bash script to stdout that
# prints the canonical "── Exit-code summary ──" block when executed.
# The suites are intentionally self-contained — they do NOT source
# `exit-summary.sh` — so the fixture works in any sandbox without
# needing the helper on the PATH.
#
# Convenience wrappers:
#
#   write_bucket_fixture <kind> <path> [code]
#     kind = placeholder_only | records_only | mixed
#     Writes the emitted suite to <path> and chmod +x it. For "mixed",
#     <code> selects which bucket mixes shapes (defaults to 1).
#
#   fixture_kinds
#     Echo the canonical kind names, one per line, for iteration.
#
# Consumers (negative tests, fail-artifact tests, future regression
# suites) should prefer these helpers over hand-rolling heredocs so
# that a change to the canonical bucket body format (e.g. relabelling
# the placeholder string) only needs to be made in ONE place.

# Guard against double-sourcing.
if [ "${__BUCKET_FIXTURES_SOURCED:-0}" = "1" ]; then
  return 0 2>/dev/null || true
fi
__BUCKET_FIXTURES_SOURCED=1

# The literal placeholder line `summary-format.sh` recognises. Kept in
# one place so a future rewording only edits this constant — every
# fixture and assertion picks the change up automatically.
BUCKET_PLACEHOLDER_LINE="  (no scenarios exercised this code)"

# ── emit_placeholder_only_suite ──────────────────────────────────────
# All three canonical buckets are present but empty (placeholder body).
# Equivalent to a real suite that sourced exit-summary.sh and called
# summary_print 0 1 2 without ever recording a scenario.
emit_placeholder_only_suite() {
  cat <<SUITE
#!/usr/bin/env bash
# Fixture: every canonical bucket is a placeholder. Mirrors a real
# suite that wired in exit-summary.sh but never ran a scenario.
set -u
echo "── Exit-code summary ──"
echo "exit 0 — pass:"
echo "${BUCKET_PLACEHOLDER_LINE}"
echo "exit 1 — drift:"
echo "${BUCKET_PLACEHOLDER_LINE}"
echo "exit 2 — strict missing pin:"
echo "${BUCKET_PLACEHOLDER_LINE}"
SUITE
}

# ── emit_records_only_suite ──────────────────────────────────────────
# Every canonical bucket has at least one ✓ row. Mirrors a fully
# exercised suite (e.g. cli-exit-codes.sh on a healthy run).
emit_records_only_suite() {
  cat <<'SUITE'
#!/usr/bin/env bash
# Fixture: every canonical bucket carries ✓ records. Mirrors a
# fully exercised suite with no placeholder bodies.
set -u
echo "── Exit-code summary ──"
echo "exit 0 — pass:"
echo "  ✓ scenario A — clean pass"
echo "exit 1 — drift:"
echo "  ✓ scenario B — drift detected"
echo "exit 2 — strict missing pin:"
echo "  ✓ scenario C — strict missing pin"
SUITE
}

# ── emit_mixed_bucket_suite [code] ───────────────────────────────────
# One bucket (default: exit 1) contains BOTH a ✓ record AND the
# placeholder line — the precise shape `summary-format.sh` rejects
# with "bucket for exit <N> mixes placeholder + ✓/✗ rows".
emit_mixed_bucket_suite() {
  local mix_code="${1:-1}"
  case "$mix_code" in
    0|1|2) : ;;
    *)
      echo "emit_mixed_bucket_suite: code must be 0, 1, or 2 (got: $mix_code)" >&2
      return 2
      ;;
  esac
  # Bucket headers verbatim — `summary-format.sh` parses `^exit N — .+:$`.
  local label_0="exit 0 — pass:"
  local label_1="exit 1 — drift:"
  local label_2="exit 2 — strict missing pin:"
  local body_0="  ✓ scenario A — clean pass"
  local body_1="  ✓ scenario B — drift detected"
  local body_2="  ✓ scenario C — strict missing pin"
  # Splice the placeholder line into the chosen bucket, immediately
  # after its ✓ row, so the validator sees both shapes back-to-back.
  case "$mix_code" in
    0) body_0="${body_0}"$'\n'"${BUCKET_PLACEHOLDER_LINE}" ;;
    1) body_1="${body_1}"$'\n'"${BUCKET_PLACEHOLDER_LINE}" ;;
    2) body_2="${body_2}"$'\n'"${BUCKET_PLACEHOLDER_LINE}" ;;
  esac
  cat <<SUITE
#!/usr/bin/env bash
# Fixture: bucket for exit ${mix_code} mixes a ✓ row and the
# placeholder line — exercises summary-format.sh's "mixed" guard.
set -u
echo "── Exit-code summary ──"
echo "${label_0}"
echo "${body_0}"
echo "${label_1}"
echo "${body_1}"
echo "${label_2}"
echo "${body_2}"
SUITE
}

# ── write_bucket_fixture <kind> <path> [code] ────────────────────────
# Convenience: dump the emitted suite to disk and mark it executable.
write_bucket_fixture() {
  local kind="${1:?kind required (placeholder_only|records_only|mixed)}"
  local path="${2:?path required}"
  local code="${3:-1}"
  case "$kind" in
    placeholder_only) emit_placeholder_only_suite       >"$path" ;;
    records_only)     emit_records_only_suite           >"$path" ;;
    mixed)            emit_mixed_bucket_suite "$code"   >"$path" ;;
    *)
      echo "write_bucket_fixture: unknown kind '$kind'" >&2
      return 2
      ;;
  esac
  chmod +x "$path"
}

# ── fixture_kinds ────────────────────────────────────────────────────
# Canonical list, for iteration in smoke tests / consumers that want
# to sweep every fixture shape without hard-coding the names twice.
fixture_kinds() {
  printf '%s\n' placeholder_only records_only mixed
}

#!/usr/bin/env bash
# End-to-end test for `run-print-modal-layout-metrics.sh --summary-mode overwrite`.
#
# Runs the real runner script twice, each time producing a distinct fake
# layout-metrics JSON record, and verifies that:
#
#   1. The Markdown summary file is REPLACED (not accumulated) between runs.
#   2. Only the second run's record appears in the final file.
#   3. The first run's unique marker is absent from the final file.
#
# Playwright is not actually invoked — a shim `bunx` on PATH stands in for
# preflight `--list` / `install --dry-run` and writes a fake JSON record
# where the runner expects real Playwright output. The real render script
# (.github/scripts/render-layout-metrics-summary.sh) runs unmodified so we
# exercise the true tee/overwrite pipeline in the runner.

set -u

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." &>/dev/null && pwd)"
RUNNER="$REPO_ROOT/scripts/testing/run-print-modal-layout-metrics.sh"

if [ ! -x "$RUNNER" ]; then
  echo "❌ Runner script not found or not executable: $RUNNER" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# --- Build a `bunx` shim that impersonates the two `bunx playwright ...`
# invocations the runner needs (list + install --dry-run + real test run).
# The real run is signalled by the presence of the spec path in argv; we
# read the run marker from the SHIM_RUN_ID env var and write it as
# `.caseLabel` inside a fake JSON record under $SHIM_SUMMARY_DIR.
SHIM_BIN="$TMP/bin"
mkdir -p "$SHIM_BIN"
cat >"$SHIM_BIN/bunx" <<'SHIM'
#!/usr/bin/env bash
set -u
# Only intercept `playwright` — pass anything else through to real bunx.
if [ "${1:-}" != "playwright" ]; then
  exec /usr/bin/env -u PATH bash -c 'PATH="$REAL_PATH" exec bunx "$@"' _ "$@"
fi
shift
case "${1:-}" in
  test)
    # Two variants:
    #   `playwright test --list ...` (preflight enumeration)
    #   `playwright test <spec> --project=... ...` (real run)
    if printf '%s\n' "$@" | grep -qx -- '--list'; then
      # Emit a line per required project so the runner's preflight regex
      # (`\[[a-zA-Z0-9_-]+\]`) picks all three up.
      echo "  [chromium-reduced-motion] › tests/a11y/print-modal-zoom-dpi-layout-metrics.spec.ts"
      echo "  [firefox-reduced-motion]  › tests/a11y/print-modal-zoom-dpi-layout-metrics.spec.ts"
      echo "  [webkit-reduced-motion]   › tests/a11y/print-modal-zoom-dpi-layout-metrics.spec.ts"
      exit 0
    fi
    # Real run — write one fake JSON record tagged with SHIM_RUN_ID so the
    # rendered Markdown carries a marker unique to this invocation.
    mkdir -p "${SHIM_SUMMARY_DIR:?}"
    cat >"$SHIM_SUMMARY_DIR/shim-${SHIM_RUN_ID}.json" <<JSON
{
  "browser": "chromium",
  "caseLabel": "SHIM_MARKER_${SHIM_RUN_ID}",
  "doc": "shim-doc",
  "status": "passed",
  "sheetCount": 1,
  "expectedSheets": 1,
  "sheetCountOk": true,
  "fittedWidthPx":  { "min": 100, "max": 100, "spread": 0 },
  "fittedHeightPx": { "min": 200, "max": 200, "spread": 0 },
  "worstVerticalClipPx": 0,
  "worstHorizontalClipPx": 0,
  "worstRightOverflowPx": 0,
  "worstRightOverflowSheet": null,
  "clipTolerancePx": 1,
  "widthVariancePx": 1,
  "perSheet": []
}
JSON
    exit 0
    ;;
  install)
    # `playwright install --dry-run <browser>` — pretend already installed.
    echo "browser: chromium is already installed"
    exit 0
    ;;
esac
echo "shim: unhandled playwright subcommand: $*" >&2
exit 99
SHIM
chmod +x "$SHIM_BIN/bunx"

SUMMARY_MD="$TMP/summary.md"
export REAL_PATH="$PATH"
export PATH="$SHIM_BIN:$PATH"
export SHIM_SUMMARY_DIR="$TMP/out/layout-metrics-summary"

cd "$REPO_ROOT"

fail=0
n=0
check() {
  local desc="$1" ok="$2"
  n=$((n+1))
  if [ "$ok" = "1" ]; then
    echo "✓ [$n] $desc"
  else
    echo "✗ [$n] $desc"
    fail=$((fail+1))
  fi
}

# --- Run 1: writes SHIM_MARKER_FIRST into the summary MD.
export SHIM_RUN_ID="FIRST"
RUN1_OUT="$(bash "$RUNNER" chromium \
  --output-dir "$TMP/out" \
  --summary-file "$SUMMARY_MD" \
  --summary-mode overwrite 2>&1)" || {
  echo "$RUN1_OUT"
  echo "❌ Run 1 exited non-zero." >&2
  exit 1
}

grep -q 'SHIM_MARKER_FIRST' "$SUMMARY_MD"
check "run 1 writes SHIM_MARKER_FIRST to summary file" "$([ $? -eq 0 ] && echo 1 || echo 0)"

# --- Run 2: writes SHIM_MARKER_SECOND. Overwrite mode MUST replace file.
export SHIM_RUN_ID="SECOND"
RUN2_OUT="$(bash "$RUNNER" chromium \
  --output-dir "$TMP/out" \
  --summary-file "$SUMMARY_MD" \
  --summary-mode overwrite 2>&1)" || {
  echo "$RUN2_OUT"
  echo "❌ Run 2 exited non-zero." >&2
  exit 1
}

grep -q 'SHIM_MARKER_SECOND' "$SUMMARY_MD"
check "run 2 writes SHIM_MARKER_SECOND to summary file" "$([ $? -eq 0 ] && echo 1 || echo 0)"

if grep -q 'SHIM_MARKER_FIRST' "$SUMMARY_MD"; then
  check "run 2 REPLACES run 1's content (no SHIM_MARKER_FIRST remains)" 0
else
  check "run 2 REPLACES run 1's content (no SHIM_MARKER_FIRST remains)" 1
fi

# Only ONE table data row should exist (metrics table body starts after the
# `|---` separator). Accumulation would produce two rows in the same table.
DATA_ROWS="$(grep -c '^| chromium ' "$SUMMARY_MD" || true)"
if [ "$DATA_ROWS" = "1" ]; then
  check "summary contains exactly one metrics row (got: $DATA_ROWS)" 1
else
  check "summary contains exactly one metrics row (got: $DATA_ROWS)" 0
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "✅ overwrite mode replaces summary between runs ($n checks passed)."
  exit 0
else
  echo "❌ $fail check(s) failed out of $n."
  echo "----- final summary file -----"
  cat "$SUMMARY_MD" || true
  echo "------------------------------"
  exit 1
fi

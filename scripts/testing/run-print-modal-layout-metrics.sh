#!/usr/bin/env bash
# Run the print-modal layout-metrics Playwright spec with the SAME
# project settings CI uses (retries=1, list reporter, results under
# test-results/), then render a Markdown summary of the measured
# fitted height/width and clip/overflow deltas to stdout.
#
# Usage:
#   bun run test:print-modal:layout-metrics             # chromium (default)
#   bun run test:print-modal:layout-metrics firefox
#   bun run test:print-modal:layout-metrics webkit
#   bun run test:print-modal:layout-metrics chromium-reduced-motion   # exact project name also OK
#
# Extra Playwright flags pass through:
#   bun run test:print-modal:layout-metrics chromium -- --headed --debug
#
# Shortcuts for the most common Playwright debug flags (no `--` needed):
#   bun run test:print-modal:layout-metrics chromium --headed
#   bun run test:print-modal:layout-metrics chromium --debug
#
# List the Playwright projects the config actually defines and exit:
#   bun run test:print-modal:layout-metrics --list-projects
#
# List the zoom/DPR cases the spec will run and exit:
#   bun run test:print-modal:layout-metrics --list-cases
#
# Write results to a custom directory (default: test-results):
#   bun run test:print-modal:layout-metrics chromium --output-dir tmp/pw-results
#   bun run test:print-modal:layout-metrics --output-dir=tmp/pw-results firefox
#
# Preview the resolved commands without executing anything:
#   bun run test:print-modal:layout-metrics chromium --dry-run
#
# Override the ⚠️ pixel tolerance in the rendered summary (default: per-record):
#   bun run test:print-modal:layout-metrics chromium --tolerance-px 2
#
# Choose an exact path for the Markdown summary file
# (default: $OUTPUT_DIR/layout-metrics-summary.md):
#   bun run test:print-modal:layout-metrics chromium --summary-file tmp/report.md
#
# Overwrite (default) or append the Markdown summary to the target file:
#   bun run test:print-modal:layout-metrics chromium --summary-mode append
#
# Keep only the last N appended run sections (append mode only):
#   bun run test:print-modal:layout-metrics chromium --summary-mode append --summary-keep 5
#
# Also write a machine-readable JSON envelope alongside the Markdown:
#   bun run test:print-modal:layout-metrics chromium --summary-json tmp/summary.json
#
# Append each run's envelope into a JSON array in the target file instead
# of overwriting (useful for nightly history dashboards):
#   bun run test:print-modal:layout-metrics chromium \
#     --summary-json tmp/summary.json --summary-json-append
#
# Requires the browser binaries to be installed:
#   bunx playwright install <browser>

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." &>/dev/null && pwd)"
cd "$REPO_ROOT"

SPEC="tests/a11y/print-modal-zoom-dpi-layout-metrics.spec.ts"
OUTPUT_DIR="test-results"
RENDER_SCRIPT=".github/scripts/render-layout-metrics-summary.sh"
DRY_RUN=0
TOLERANCE_PX=""  # empty = use each JSON record's own tolerance
EXTRA_PW_FLAGS=()  # forwarded verbatim to `playwright test` (e.g. --headed, --debug)
SUMMARY_FILE=""    # empty = default to $OUTPUT_DIR/layout-metrics-summary.md
SUMMARY_MODE="overwrite"  # overwrite | append
SUMMARY_KEEP=""           # append mode only: keep only the last N run sections
SUMMARY_JSON=""           # optional path for aggregated machine-readable JSON
SUMMARY_JSON_APPEND=0     # 1 = append envelope to array in $SUMMARY_JSON

# ---- Pre-parse --output-dir out of the argv (can appear before or after -----
# the project arg). Everything else stays in "$@" so the existing positional
# handling below (project name, then pass-through flags) is unchanged.
FILTERED=()
while [ $# -gt 0 ]; do
  case "$1" in
    --output-dir)
      if [ $# -lt 2 ] || [ -z "${2:-}" ]; then
        echo "❌ --output-dir requires a path argument (e.g. --output-dir tmp/pw-results)."
        exit 2
      fi
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --output-dir=*)
      OUTPUT_DIR="${1#--output-dir=}"
      if [ -z "$OUTPUT_DIR" ]; then
        echo "❌ --output-dir requires a non-empty path (e.g. --output-dir=tmp/pw-results)."
        exit 2
      fi
      shift
      ;;
    --dry-run|-n)
      DRY_RUN=1
      shift
      ;;
    --tolerance-px)
      if [ $# -lt 2 ] || [ -z "${2:-}" ]; then
        echo "❌ --tolerance-px requires a numeric value (e.g. --tolerance-px 2)."
        exit 2
      fi
      TOLERANCE_PX="$2"
      shift 2
      ;;
    --tolerance-px=*)
      TOLERANCE_PX="${1#--tolerance-px=}"
      shift
      ;;
    --headed)
      EXTRA_PW_FLAGS+=(--headed)
      shift
      ;;
    --debug)
      EXTRA_PW_FLAGS+=(--debug)
      shift
      ;;
    --summary-file)
      if [ $# -lt 2 ] || [ -z "${2:-}" ]; then
        echo "❌ --summary-file requires a path (e.g. --summary-file tmp/summary.md)."
        exit 2
      fi
      SUMMARY_FILE="$2"
      shift 2
      ;;
    --summary-file=*)
      SUMMARY_FILE="${1#--summary-file=}"
      if [ -z "$SUMMARY_FILE" ]; then
        echo "❌ --summary-file requires a non-empty path."
        exit 2
      fi
      shift
      ;;
    --summary-mode)
      if [ $# -lt 2 ] || [ -z "${2:-}" ]; then
        echo "❌ --summary-mode requires 'overwrite' or 'append'."
        exit 2
      fi
      SUMMARY_MODE="$2"
      shift 2
      ;;
    --summary-mode=*)
      SUMMARY_MODE="${1#--summary-mode=}"
      shift
      ;;
    --summary-keep)
      if [ $# -lt 2 ] || [ -z "${2:-}" ]; then
        echo "❌ --summary-keep requires a positive integer (e.g. --summary-keep 10)."
        exit 2
      fi
      SUMMARY_KEEP="$2"
      shift 2
      ;;
    --summary-keep=*)
      SUMMARY_KEEP="${1#--summary-keep=}"
      shift
      ;;
    --summary-json)
      if [ $# -lt 2 ] || [ -z "${2:-}" ]; then
        echo "❌ --summary-json requires a path (e.g. --summary-json tmp/summary.json)."
        exit 2
      fi
      SUMMARY_JSON="$2"
      shift 2
      ;;
    --summary-json=*)
      SUMMARY_JSON="${1#--summary-json=}"
      if [ -z "$SUMMARY_JSON" ]; then
        echo "❌ --summary-json requires a non-empty path."
        exit 2
      fi
      shift
      ;;
    --summary-json-append)
      SUMMARY_JSON_APPEND=1
      shift
      ;;
    *)
      FILTERED+=("$1")
      shift
      ;;
  esac
done

# Resolve the final Markdown summary path AFTER --output-dir is known.
# Default: co-locate with the JSON records under the layout-metrics-summary/
# subdir so all artifacts for this run sit in one place.
SUMMARY_MD="${SUMMARY_FILE:-$OUTPUT_DIR/layout-metrics-summary/layout-metrics-summary.md}"

# Validate --summary-mode and resolve the tee flags used by both real run
# and --dry-run output. `overwrite` uses `tee` (truncate + write); `append`
# uses `tee -a` (append with no truncation) so multiple runs accumulate.
case "$SUMMARY_MODE" in
  overwrite) TEE_ARGS=() ;;
  append)    TEE_ARGS=(-a) ;;
  *)
    echo "❌ --summary-mode must be 'overwrite' or 'append' (got: '$SUMMARY_MODE')."
    exit 2
    ;;
esac

# Validate --summary-keep: positive integer, and only meaningful in append mode.
if [ -n "$SUMMARY_KEEP" ]; then
  if ! printf '%s' "$SUMMARY_KEEP" | grep -qE '^[1-9][0-9]*$'; then
    echo "❌ --summary-keep must be a positive integer (got: '$SUMMARY_KEEP')."
    exit 2
  fi
  if [ "$SUMMARY_MODE" != "append" ]; then
    echo "❌ --summary-keep only applies with --summary-mode append (current mode: '$SUMMARY_MODE')."
    exit 2
  fi
fi
set -- "${FILTERED[@]+"${FILTERED[@]}"}"

# Summary JSON lives inside the chosen output dir so wiping it before a run
# only touches this run's records — mirrors the CI layout.
SUMMARY_DIR="$OUTPUT_DIR/layout-metrics-summary"

# Validate --tolerance-px if provided. Accept integer or decimal, >= 0.
if [ -n "$TOLERANCE_PX" ]; then
  if ! printf '%s' "$TOLERANCE_PX" | grep -qE '^[0-9]+(\.[0-9]+)?$'; then
    echo "❌ --tolerance-px must be a non-negative number (got: '$TOLERANCE_PX')."
    exit 2
  fi
fi

# ---- Resolve project name from the first positional arg ---------------------
raw="${1:-chromium}"
# Drop the arg so remaining args ($@) are forwarded to playwright verbatim.
if [ $# -gt 0 ]; then shift; fi

case "$raw" in
  chromium|firefox|webkit)
    PROJECT="${raw}-reduced-motion"
    BROWSER="$raw"
    ;;
  chromium-reduced-motion|firefox-reduced-motion|webkit-reduced-motion)
    PROJECT="$raw"
    BROWSER="${raw%-reduced-motion}"
    ;;
  --help|-h)
    sed -n '2,20p' "$0"
    exit 0
    ;;
  --list-projects)
    # Enumerate projects that playwright.config.ts actually defines and exit.
    # Useful for spotting CI/local drift without triggering a full test run.
    echo "▸ Detected Playwright projects (from \`bunx playwright test --list\`):"
    LIST_OUT="$(bunx playwright test --list --reporter=list 2>&1 || true)"
    PROJECTS="$(printf '%s\n' "$LIST_OUT" \
      | grep -oE '\[[a-zA-Z0-9_-]+\]' \
      | sort -u \
      | tr -d '[]' || true)"
    if [ -z "$PROJECTS" ]; then
      echo "  (none — could not enumerate; playwright output first 20 lines:)"
      printf '%s\n' "$LIST_OUT" | head -20 | sed 's/^/    /'
      exit 3
    fi
    printf '%s\n' "$PROJECTS" | sed 's/^/  - /'
    exit 0
    ;;
  --list-cases)
    # Extract the CASES array from the spec source so we always report
    # exactly what the spec will run — no second source of truth to drift.
    if [ ! -f "$SPEC" ]; then
      echo "❌ --list-cases: spec not found at $SPEC"
      exit 7
    fi
    echo "▸ Zoom/DPR cases declared in:"
    echo "    $SPEC"
    echo
    # Lines look like:
    #   { kind: "zoom", slug: "zoom-090", label: "browser zoom 90%",  cssZoom: 0.9 },
    #   { kind: "dpr",  slug: "dpr-2",    label: "devicePixelRatio 2 (Retina)", dpr: 2 },
    MATCHES="$(grep -E '^\s*\{\s*kind:\s*"(zoom|dpr)"' "$SPEC" || true)"
    if [ -z "$MATCHES" ]; then
      echo "  (none — could not parse CASES array; check the spec's shape.)"
      exit 8
    fi
    printf '  %-6s  %-10s  %-8s  %s\n' "KIND" "SLUG" "VALUE" "LABEL"
    printf '  %-6s  %-10s  %-8s  %s\n' "------" "----------" "--------" "-----"
    printf '%s\n' "$MATCHES" | while IFS= read -r line; do
      kind="$(printf '%s' "$line" | sed -nE 's/.*kind:\s*"([^"]+)".*/\1/p')"
      slug="$(printf '%s' "$line" | sed -nE 's/.*slug:\s*"([^"]+)".*/\1/p')"
      label="$(printf '%s' "$line" | sed -nE 's/.*label:\s*"([^"]+)".*/\1/p')"
      if [ "$kind" = "zoom" ]; then
        val="$(printf '%s' "$line" | sed -nE 's/.*cssZoom:\s*([0-9.]+).*/\1/p')"
      else
        val="$(printf '%s' "$line" | sed -nE 's/.*dpr:\s*([0-9.]+).*/\1/p')"
      fi
      printf '  %-6s  %-10s  %-8s  %s\n' "$kind" "$slug" "$val" "$label"
    done
    COUNT="$(printf '%s\n' "$MATCHES" | wc -l | tr -d ' ')"
    echo
    echo "  Total: $COUNT case(s). Each runs per browser project."
    exit 0
    ;;
  *)
    echo "❌ Unknown project '$raw'."
    echo "   Expected one of: chromium | firefox | webkit"
    echo "                   chromium-reduced-motion | firefox-reduced-motion | webkit-reduced-motion"
    exit 2
    ;;
esac

# ---- Preflight: validate Playwright config + project + browser binary -------
# 1. The Playwright config MUST define all three reduced-motion projects
#    (chromium/firefox/webkit) — CI runs all three legs and drift between
#    what CI expects and what devs run locally silently masks regressions.
# 2. The specific requested project MUST resolve (guards typos and stale
#    project renames — playwright's own error message is easy to miss in
#    a wall of Vite output).
# 3. The browser binary MUST be installed — otherwise Playwright errors
#    mid-run with a stack trace instead of a one-line "install" hint.
REQUIRED_PROJECTS=(chromium-reduced-motion firefox-reduced-motion webkit-reduced-motion)

# 0. Spec file MUST exist. If someone renames/moves the spec but forgets to
#    update this runner, Playwright's own error ("No tests found") is easy
#    to miss in CI output. Fail fast with the exact path we expected.
if [ ! -f "$SPEC" ]; then
  echo "❌ Preflight failed: layout-metrics spec not found at:"
  echo "     $SPEC"
  echo "   The runner and CI both hard-code this path. If the spec moved,"
  echo "   update SPEC in scripts/testing/run-print-modal-layout-metrics.sh"
  echo "   AND the matching path in .github/workflows/print-modal-zoom-dpi*.yml."
  exit 7
fi
echo "  ✓ Spec file present:             $SPEC"

echo "▸ Preflight: validating Playwright projects…"
CONFIG_LIST_OUT="$(bunx playwright test --list --reporter=list 2>&1 || true)"
# `playwright test --list` emits lines like `  [chromium-reduced-motion] › tests/...`.
# Extract the unique set of project names actually configured.
CONFIGURED_PROJECTS="$(printf '%s\n' "$CONFIG_LIST_OUT" \
  | grep -oE '\[[a-zA-Z0-9_-]+\]' \
  | sort -u \
  | tr -d '[]' || true)"

if [ -z "$CONFIGURED_PROJECTS" ]; then
  echo "❌ Preflight failed: could not enumerate Playwright projects."
  echo "   Playwright output (first 20 lines):"
  printf '%s\n' "$CONFIG_LIST_OUT" | head -20 | sed 's/^/     /'
  echo "   Fix: ensure playwright.config.ts is valid and \`bunx playwright test --list\` runs."
  exit 3
fi

MISSING_PROJECTS=()
for p in "${REQUIRED_PROJECTS[@]}"; do
  if ! printf '%s\n' "$CONFIGURED_PROJECTS" | grep -qx "$p"; then
    MISSING_PROJECTS+=("$p")
  fi
done

if [ ${#MISSING_PROJECTS[@]} -gt 0 ]; then
  echo "❌ Preflight failed: playwright.config.ts is missing required project(s):"
  for p in "${MISSING_PROJECTS[@]}"; do echo "     - $p"; done
  echo "   Configured projects:"
  printf '%s\n' "$CONFIGURED_PROJECTS" | sed 's/^/     - /'
  echo "   CI matrix (print-modal-zoom-dpi-cross-browser.yml) runs all three;"
  echo "   drift between CI and local hides regressions. Re-add the missing project(s)."
  exit 4
fi

if ! printf '%s\n' "$CONFIGURED_PROJECTS" | grep -qx "$PROJECT"; then
  # Should be unreachable given the check above, but keeps the guard local
  # to the requested project name (e.g. future renames).
  echo "❌ Preflight failed: requested project '$PROJECT' is not defined in playwright.config.ts."
  echo "   Configured projects:"
  printf '%s\n' "$CONFIGURED_PROJECTS" | sed 's/^/     - /'
  exit 5
fi

# Verify the browser binary is installed. Playwright's own error when a
# browser is missing is buried under a stack trace; catch it up front.
if ! bunx playwright install --dry-run "$BROWSER" 2>&1 | grep -qiE "is already installed|browser: chromium|browser: firefox|browser: webkit"; then
  # `install --dry-run` output format varies across playwright versions;
  # fall back to a direct binary probe as a second signal.
  if ! bunx playwright test --list --project="$PROJECT" "$SPEC" >/dev/null 2>&1; then
    echo "❌ Preflight failed: Playwright browser '$BROWSER' is not installed."
    echo "   Fix: bunx playwright install $BROWSER"
    exit 6
  fi
fi

echo "  ✓ All required projects present: ${REQUIRED_PROJECTS[*]}"
echo "  ✓ Requested project resolves:    $PROJECT"
echo "  ✓ Browser binary available:      $BROWSER"
echo



# ---- Build the exact commands we would run ---------------------------------
# Kept as arrays so --dry-run can print them with proper quoting AND the
# real run can exec them without a second source of truth drifting.
PLAYWRIGHT_CMD=(
  bunx playwright test
  "$SPEC"
  "--project=$PROJECT"
  --retries=1
  --reporter=list
  "--output=$OUTPUT_DIR"
  "${EXTRA_PW_FLAGS[@]+"${EXTRA_PW_FLAGS[@]}"}"
  "$@"
)
RENDER_CMD=(bash "$RENDER_SCRIPT" "$SUMMARY_DIR")

print_cmd() {
  local first=1
  for tok in "$@"; do
    if [ $first -eq 1 ]; then
      printf '  %q' "$tok"; first=0
    else
      printf ' %q' "$tok"
    fi
  done
  printf '\n'
}

if [ "$DRY_RUN" -eq 1 ]; then
  echo "▶ --dry-run: would run the following commands (nothing executed)."
  echo
  echo "  Resolved paths:"
  echo "    OUTPUT_DIR   = $OUTPUT_DIR"
  echo "    SUMMARY_DIR  = $SUMMARY_DIR       (Playwright JSON records land here)"
  echo "    SUMMARY_MD   = $SUMMARY_MD  (Markdown summary will be written here)"
  echo "    SUMMARY_MODE = $SUMMARY_MODE  ($( [ "$SUMMARY_MODE" = "append" ] && echo "tee -a — appends to existing file" || echo "tee — truncates before writing" ))"
  echo
  echo "  # 1. wipe prior summary records"
  printf '  rm -rf %q && mkdir -p %q\n' "$SUMMARY_DIR" "$SUMMARY_DIR"
  echo
  echo "  # 2. Playwright test (resolved project: $PROJECT)"
  print_cmd "${PLAYWRIGHT_CMD[@]}"
  echo
  echo "  # 3. Render summary table to stdout AND $SUMMARY_MD"
  if [ -n "$TOLERANCE_PX" ]; then
    printf "  GITHUB_STEP_SUMMARY='' TOLERANCE_PX_OVERRIDE=%q " "$TOLERANCE_PX"
  else
    printf "  GITHUB_STEP_SUMMARY='' "
  fi
  # Show the tee pipeline that the real run uses.
  printf '%q' "${RENDER_CMD[0]}"
  for tok in "${RENDER_CMD[@]:1}"; do printf ' %q' "$tok"; done
  if [ ${#TEE_ARGS[@]} -gt 0 ]; then
    printf ' | tee %s %q\n' "${TEE_ARGS[*]}" "$SUMMARY_MD"
  else
    printf ' | tee %q\n' "$SUMMARY_MD"
  fi
  exit 0
fi

# ---- Clean prior summary records so the printed table matches THIS run ------
rm -rf "$SUMMARY_DIR"
mkdir -p "$SUMMARY_DIR"

echo "▶ Running $SPEC on project: $PROJECT"
echo "  (retries=1, reporter=list, output=$OUTPUT_DIR — matches CI when default)"
echo

set +e
"${PLAYWRIGHT_CMD[@]}"
STATUS=$?
set -e

echo
echo "━━━ Measured layout metrics ━━━"
echo
# Render to both stdout (for the terminal) AND a file so the same
# Markdown is available for later inspection / PR attachment.
# Path resolved earlier: $SUMMARY_MD (--summary-file overrides default).
mkdir -p "$(dirname "$SUMMARY_MD")"

# In append mode, prepend a timestamped separator so successive runs don't
# blend together. Skip when the file is missing/empty — the first section
# doesn't need a divider above it. Include the resolved CLI options that
# shaped the run (paths, filters, tolerance, extra Playwright flags) so a
# reader scrolling through an accumulated file can tell each section apart
# without cross-referencing shell history.
#
# Also skip when the most recent `## Run @` header in the file has no table
# rows after it — that means a previous invocation added a divider but the
# render step produced nothing (spec crashed / zero JSON records), so a
# fresh divider now would stack two empty headers back-to-back.
if [ "$SUMMARY_MODE" = "append" ] && [ -s "$SUMMARY_MD" ]; then
  SKIP_DIVIDER=0
  LAST_HEADER_LINE="$(grep -n '^## Run @ ' "$SUMMARY_MD" | tail -1 | cut -d: -f1 || true)"
  if [ -n "$LAST_HEADER_LINE" ]; then
    # Any Markdown table row (`| ... |`) after the last header means the
    # previous run rendered real content; we DO want a new divider.
    if ! tail -n "+$LAST_HEADER_LINE" "$SUMMARY_MD" | grep -q '^| '; then
      SKIP_DIVIDER=1
      echo "  ↷ Skipping divider: latest '## Run @' header at line $LAST_HEADER_LINE has no table rows after it (previous run left an empty section)."
    fi
  fi

  if [ "$SKIP_DIVIDER" -eq 0 ]; then
    RUN_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    TOL_DISPLAY="${TOLERANCE_PX:-(per-record default)}"
    EXTRA_DISPLAY="${EXTRA_PW_FLAGS[*]:-(none)}"
    PASSTHROUGH_DISPLAY="${*:-(none)}"
    {
      echo
      echo "---"
      echo
      echo "## Run @ $RUN_TS — project: $PROJECT"
      echo
      echo "**CLI options for this run:**"
      echo
      echo "- \`OUTPUT_DIR\`     = \`$OUTPUT_DIR\`"
      echo "- \`SUMMARY_DIR\`    = \`$SUMMARY_DIR\`"
      echo "- \`SUMMARY_MD\`     = \`$SUMMARY_MD\`"
      echo "- \`SUMMARY_MODE\`   = \`$SUMMARY_MODE\`"
      echo "- \`--tolerance-px\` = \`$TOL_DISPLAY\`"
      echo "- Playwright flags = \`$EXTRA_DISPLAY\`"
      echo "- Pass-through argv = \`$PASSTHROUGH_DISPLAY\`"
      echo
    } >> "$SUMMARY_MD"
  fi
fi


GITHUB_STEP_SUMMARY="" TOLERANCE_PX_OVERRIDE="$TOLERANCE_PX" \
  "${RENDER_CMD[@]}" | tee "${TEE_ARGS[@]+"${TEE_ARGS[@]}"}" "$SUMMARY_MD"

# --- Emit aggregated machine-readable JSON (if requested) --------------------
# Combines every per-record file the spec wrote under $SUMMARY_DIR/*.json
# into a single envelope with run metadata so downstream tooling (dashboards,
# regression bots, delta reports) has one file to consume.
#
# Default: overwrites the target every run so the JSON reflects just the
# latest invocation (pair with the Markdown summary's append mode for
# history). Pass --summary-json-append to instead accumulate one envelope
# per run inside a top-level JSON array in $SUMMARY_JSON. The array is
# created lazily on first run; on subsequent runs the file is read,
# defensively coerced to an array, and this run's envelope pushed onto it.
if [ -n "$SUMMARY_JSON" ]; then
  mkdir -p "$(dirname "$SUMMARY_JSON")"
  RUN_TS_JSON="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! command -v jq >/dev/null 2>&1; then
    echo "::warning::--summary-json requested but jq is not installed; skipping."
  else
    # Build the envelope into a temp file first so we can validate it BEFORE
    # touching the target. This keeps a bad run from clobbering (or
    # corrupting the array in) an otherwise good history file.
    ENVELOPE_TMP="$(mktemp)"
    trap 'rm -f "$ENVELOPE_TMP"' EXIT
    jq -n \
      --arg runAt "$RUN_TS_JSON" \
      --arg project "$PROJECT" \
      --arg browser "$BROWSER" \
      --arg spec "$SPEC" \
      --arg summaryMd "$SUMMARY_MD" \
      --arg summaryMode "$SUMMARY_MODE" \
      --arg tolerancePx "${TOLERANCE_PX:-}" \
      --argjson exitStatus "$STATUS" \
      --slurpfile records <(
        find "$SUMMARY_DIR" -maxdepth 1 -type f -name '*.json' 2>/dev/null \
          | sort \
          | xargs -r -I{} jq -c '.' {} 2>/dev/null \
          | jq -s '.'
      ) '
        # Decorate each record with envelope-level context (spec, tolerancePx)
        # and default browser to the envelope value if the per-record JSON
        # dropped it. Keeps every entry self-describing so an out-of-band
        # consumer (audit tooling, replay harness) can process a single
        # record without re-reading the envelope.
        ($tolerancePx | if . == "" then null else (. | tonumber) end) as $tol
        | ($records[0] | map(
            . + {
              browser: (.browser // $browser),
              spec: (.spec // $spec),
              tolerancePx: (if has("tolerancePx") then .tolerancePx else $tol end)
            }
          )) as $decorated
        | {
          runAt: $runAt,
          project: $project,
          browser: $browser,
          spec: $spec,
          exitStatus: $exitStatus,
          summaryMd: $summaryMd,
          summaryMode: $summaryMode,
          tolerancePx: $tol,
          recordCount: ($decorated | length),
          records: $decorated
        }
      ' > "$ENVELOPE_TMP"

    # --- Validate shape against the schema ----------------------------------
    # Uses jq as a portable validator (no ajv/node dep). Enforces the required
    # keys, types, and the summaryMode enum documented in
    # scripts/testing/print-modal-summary.schema.json. On failure we print
    # every problem found (not just the first) and exit non-zero so CI stops.
    SCHEMA_PATH="$(dirname "$0")/print-modal-summary.schema.json"
    VALIDATION_ERRORS="$(
      jq -r '
        def t(x): x | type;
        def check(cond; msg): if cond then empty else msg end;
        [
          check(t(.runAt) == "string" and (.runAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"));
                "runAt must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ), got: \(.runAt | tojson)"),
          check(t(.project) == "string" and (.project | length) > 0;
                "project must be a non-empty string"),
          check(t(.browser) == "string" and (.browser | length) > 0;
                "browser must be a non-empty string"),
          check(t(.spec) == "string" and (.spec | length) > 0;
                "spec must be a non-empty string"),
          check(t(.exitStatus) == "number" and (.exitStatus | floor) == .exitStatus and .exitStatus >= 0;
                "exitStatus must be a non-negative integer, got: \(.exitStatus | tojson)"),
          check(t(.summaryMd) == "string" and (.summaryMd | length) > 0;
                "summaryMd must be a non-empty string"),
          check(.summaryMode == "append" or .summaryMode == "overwrite";
                "summaryMode must be \"append\" or \"overwrite\", got: \(.summaryMode | tojson)"),
          check(t(.tolerancePx) == "number" or .tolerancePx == null;
                "tolerancePx must be a number or null, got: \(.tolerancePx | tojson)"),
          check(t(.recordCount) == "number" and (.recordCount | floor) == .recordCount and .recordCount >= 0;
                "recordCount must be a non-negative integer, got: \(.recordCount | tojson)"),
          check(t(.records) == "array";
                "records must be an array, got: \(.records | type)"),
          check(t(.records) == "array" and (.records | length) == .recordCount;
                "records.length (\(.records | length)) must equal recordCount (\(.recordCount))"),
          check(t(.records) != "array" or (.records | all(type == "object"));
                "every entry in records must be an object"),
          # Per-record required fields — enforce the replay/audit shape so a
          # regressed spec that drops rawMetrics fails loudly instead of
          # silently shipping a summary-only aggregate.
          check(t(.records) != "array" or (.records | all(has("browser") and has("spec") and has("tolerancePx") and has("caseSlug") and has("doc") and has("sheetCount") and has("perSheet") and has("rawMetrics")));
                "each record must include: browser, spec, tolerancePx, caseSlug, doc, sheetCount, perSheet, rawMetrics"),
          check(t(.records) != "array" or (.records | all((.browser | type) == "string" and (.browser | length) > 0));
                "records[].browser must be a non-empty string"),
          check(t(.records) != "array" or (.records | all((.spec | type) == "string" and (.spec | length) > 0));
                "records[].spec must be a non-empty string"),
          check(t(.records) != "array" or (.records | all((.tolerancePx | type) == "number" or .tolerancePx == null));
                "records[].tolerancePx must be a number or null"),
          check(t(.records) != "array" or (.records | all((.rawMetrics | type) == "array"));
                "records[].rawMetrics must be an array of SheetMetrics objects"),
          check(t(.records) != "array" or (.records | all((.perSheet | type) == "array"));
                "records[].perSheet must be an array"),
          check(t(.records) != "array" or (.records | all((.rawMetrics | length) == .sheetCount));
                "records[].rawMetrics.length must equal records[].sheetCount")
        ] | .[]
      ' "$ENVELOPE_TMP" 2>&1 || echo "jq failed to parse envelope"
    )"
    if [ -n "$VALIDATION_ERRORS" ]; then
      echo >&2
      echo "::error::Aggregated --summary-json output failed schema validation." >&2
      echo "  file:   $SUMMARY_JSON (not written)" >&2
      echo "  schema: $SCHEMA_PATH" >&2
      echo "  errors:" >&2
      printf '    - %s\n' $'\n'"$VALIDATION_ERRORS" | sed '/^    - $/d' >&2
      exit 2
    fi

    # --- Install: append to array, or overwrite ------------------------------
    if [ "$SUMMARY_JSON_APPEND" = "1" ]; then
      MERGED_TMP="$(mktemp)"
      if [ -s "$SUMMARY_JSON" ]; then
        # Defensive coercion: if the existing file is a single envelope
        # object (older runs), wrap it into an array first so the semantics
        # of --summary-json-append remain "one entry per run". If it's not
        # valid JSON at all, fail loudly rather than silently discard.
        if ! jq '.' "$SUMMARY_JSON" >/dev/null 2>&1; then
          echo "::error::--summary-json-append: existing file is not valid JSON: $SUMMARY_JSON" >&2
          exit 2
        fi
        jq --slurpfile envelope "$ENVELOPE_TMP" '
          (if type == "array" then . else [.] end) + $envelope
        ' "$SUMMARY_JSON" > "$MERGED_TMP"
      else
        jq -s '.' "$ENVELOPE_TMP" > "$MERGED_TMP"
      fi
      mv "$MERGED_TMP" "$SUMMARY_JSON"
      ENTRIES="$(jq 'length' "$SUMMARY_JSON")"
      RECORDS="$(jq '.[-1].recordCount' "$SUMMARY_JSON")"
      echo
      echo "  🧾 Appended envelope to: $SUMMARY_JSON ($RECORDS record(s) this run; $ENTRIES total run(s) in file)."
    else
      mv "$ENVELOPE_TMP" "$SUMMARY_JSON"
      echo
      echo "  🧾 Wrote machine-readable JSON: $SUMMARY_JSON ($(jq '.recordCount' "$SUMMARY_JSON") record(s))."
    fi
    echo "  ✅ Schema OK ($SCHEMA_PATH)"
  fi
fi


# --- Prune older run sections in append mode ---------------------------------
# Sections are delimited by lone `---` divider lines that this script writes
# above every appended run header. We keep the last N chunks so the file
# doesn't grow indefinitely across nightly / repeated runs. The initial
# (pre-first-divider) section counts as chunk 1, so `--summary-keep 5` keeps
# the 5 most recent run sections total.
if [ "$SUMMARY_MODE" = "append" ] && [ -n "$SUMMARY_KEEP" ] && [ -s "$SUMMARY_MD" ]; then
  TOTAL_SECTIONS="$(awk 'BEGIN{n=1} /^---$/{n++} END{print n}' "$SUMMARY_MD")"
  if [ "$TOTAL_SECTIONS" -gt "$SUMMARY_KEEP" ]; then
    DROP=$((TOTAL_SECTIONS - SUMMARY_KEEP))
    TMP_PRUNED="$(mktemp)"
    # Skip the first $DROP sections; emit the rest verbatim. The kept output
    # starts at the `---` divider that opens section ($DROP + 1) so the file
    # still begins with a valid separator-then-header block.
    awk -v drop="$DROP" '
      BEGIN { seen = 0; emit = 0 }
      /^---$/ {
        seen++
        if (seen == drop) { emit = 1; print; next }
      }
      emit { print }
    ' "$SUMMARY_MD" > "$TMP_PRUNED"
    mv "$TMP_PRUNED" "$SUMMARY_MD"
    echo
    echo "  ✂  Pruned $DROP older run section(s); kept last $SUMMARY_KEEP of $TOTAL_SECTIONS."
  fi
fi

# --- Regenerate the run index at the top of the summary (append mode only) ---
# Scans every `## Run @ <ts> — project: <p>` header in the file, counts the
# per-run status emojis (✅/❌/⏱️/⏭️) that live in that run's metrics table,
# and writes an index block above all content. Wrapped in HTML-comment
# markers so successive runs replace the block cleanly instead of stacking
# duplicates.
#
# Only runs when the file has at least one `## Run @` header — the very
# first (pre-append) summary has no history yet and an empty index would
# just add noise.
if [ "$SUMMARY_MODE" = "append" ] && [ -s "$SUMMARY_MD" ] \
    && grep -q '^## Run @ ' "$SUMMARY_MD"; then
  INDEX_TMP="$(mktemp)"
  BODY_TMP="$(mktemp)"

  # 1. Strip any prior index block so we can regenerate it fresh.
  awk '
    BEGIN { skip = 0 }
    /^<!-- INDEX:START -->/ { skip = 1; next }
    /^<!-- INDEX:END -->/   { skip = 0; next }
    !skip { print }
  ' "$SUMMARY_MD" > "$BODY_TMP"

  # 2. Build the new index by walking the stripped body: on each `## Run @`
  #    header, emit a bullet with the header text and the tallied status
  #    emojis found before the next header/EOF.
  awk '
    function flush() {
      if (header != "") {
        line = "- " header
        counts = ""
        if (ok  > 0) counts = counts " " ok  " ✅"
        if (bad > 0) counts = counts " " bad " ❌"
        if (to  > 0) counts = counts " " to  " ⏱️"
        if (sk  > 0) counts = counts " " sk  " ⏭️"
        if (counts != "") line = line " —" counts
        else              line = line " — (no metrics rows recorded)"
        print line
      }
      header = ""; ok = 0; bad = 0; to = 0; sk = 0
    }
    /^## Run @ / {
      flush()
      header = substr($0, 4)   # drop the leading "## "
      next
    }
    {
      if (header != "") {
        # Count status emojis found in this section (per row, but multiple
        # rows in one run legitimately increment the counter).
        n = gsub(/✅/, "&"); ok  += n
        n = gsub(/❌/, "&"); bad += n
        n = gsub(/⏱️/, "&"); to  += n
        n = gsub(/⏭️/, "&"); sk  += n
      }
    }
    END { flush() }
  ' "$BODY_TMP" > "$INDEX_TMP"

  INDEX_COUNT="$(wc -l < "$INDEX_TMP" | tr -d ' ')"

  # 3. Rewrite the file: index block first, then a divider, then the body.
  {
    echo "<!-- INDEX:START -->"
    echo "# Run index"
    echo
    echo "_${INDEX_COUNT} appended run(s). Status counts are aggregated across every metrics row in that section._"
    echo
    cat "$INDEX_TMP"
    echo
    echo "<!-- INDEX:END -->"
    echo
    cat "$BODY_TMP"
  } > "$SUMMARY_MD"

  rm -f "$INDEX_TMP" "$BODY_TMP"
  echo "  🗂  Regenerated run index at top of summary ($INDEX_COUNT entries)."
fi

echo
if [ $STATUS -eq 0 ]; then
  echo "✅ Layout metrics spec passed on $PROJECT."
else
  echo "❌ Layout metrics spec failed on $PROJECT (exit $STATUS)."
  echo "   Per-sheet JSON + screenshots: $OUTPUT_DIR/**/sheet-*.{json,png}"
  echo "   Summary records:              $SUMMARY_DIR/*.json"
fi

# Final line: absolute path of the saved Markdown summary so it's easy to
# scrape from CI logs / copy from the terminal.
echo
echo "📄 Markdown summary saved to: $(cd "$(dirname "$SUMMARY_MD")" && pwd)/$(basename "$SUMMARY_MD")"
exit $STATUS

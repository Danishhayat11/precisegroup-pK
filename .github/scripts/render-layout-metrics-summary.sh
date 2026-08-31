#!/usr/bin/env bash
# Render a Markdown table of measured print-modal layout metrics into
# $GITHUB_STEP_SUMMARY. Reads every JSON record produced by
# tests/a11y/print-modal-zoom-dpi-layout-metrics.spec.ts under
# test-results/layout-metrics-summary/.
#
# Called with `if: always()` so the summary appears even when the specs
# fail — the whole point is spotting drift in fitted height/width and in
# clip / overflow deltas without opening the HTML report.
#
# Requires `jq` (present on GitHub-hosted ubuntu-latest images).
#
# Usage:  bash .github/scripts/render-layout-metrics-summary.sh [dir]
#         (default dir: test-results/layout-metrics-summary)

set -euo pipefail

SUMMARY_DIR="${1:-test-results/layout-metrics-summary}"
OUT="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

# Optional pixel-tolerance override. When set, ⚠️ flags use this value
# instead of each JSON record's `.clipTolerancePx` / `.widthVariancePx`.
# Empty = fall back to the per-record tolerances the spec wrote.
TOL_OVERRIDE="${TOLERANCE_PX_OVERRIDE:-}"
if [ -n "$TOL_OVERRIDE" ]; then
  # jq expression that ignores the JSON's own tolerance.
  CLIP_TOL_EXPR="$TOL_OVERRIDE"
  WIDTH_TOL_EXPR="$TOL_OVERRIDE"
  TOL_HINT="$TOL_OVERRIDE (overridden via --tolerance-px)"
else
  CLIP_TOL_EXPR=".clipTolerancePx"
  WIDTH_TOL_EXPR=".widthVariancePx"
  TOL_HINT="1"
fi

# Empty check: look ONLY for *.json records the spec writes. Anything else
# in this directory (e.g. this run's own layout-metrics-summary.md, created
# by `tee` at pipeline startup) must NOT be treated as a metrics record.
JSON_COUNT=0
if [ -d "$SUMMARY_DIR" ]; then
  # shellcheck disable=SC2012
  JSON_COUNT="$(find "$SUMMARY_DIR" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
fi
if [ "$JSON_COUNT" -eq 0 ]; then
  {
    echo "### Print modal layout metrics"
    echo
    echo "_No metrics records found in \`$SUMMARY_DIR\` — the layout-metrics spec did not run or failed before measuring._"
  } >> "$OUT"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "::warning::jq is not installed; skipping layout metrics step summary"
  exit 0
fi

{
  echo "### Print modal layout metrics"
  echo
  echo "Measured per (browser, zoom/DPR case, receipt doc). Δ columns show the worst deviation across all rendered \`.pp-sheet\` pages in that case; anything greater than the tolerance (${TOL_HINT}px) is flagged with ⚠️."
  echo
  echo "Legend: **Pages** rendered / expected · **Fitted W/H** min–max px · **ΔV clip** worst \`scrollHeight - clientHeight\` · **ΔH clip** worst \`scrollWidth - clientWidth\` · **Δ right overflow** worst descendant past sheet right edge · **W spread** widest − narrowest page width."
  echo
  echo "| Browser | Case | Doc | Status | Pages | Fitted W (px) | Fitted H (px) | ΔV clip | ΔH clip | Δ right overflow | W spread |"
  echo "|---|---|---|---|---|---|---|---|---|---|---|"
} >> "$OUT"

# Stable ordering: browser, then case slug, then doc.
find "$SUMMARY_DIR" -maxdepth 1 -type f -name '*.json' | sort | while read -r file; do
  row=$(jq -r "
    def fmt2: (. * 100 | round) / 100;
    def clipEmoji(v; tol): if v > tol then \"⚠️ \" else \"\" end;
    def statusEmoji:
      if . == \"passed\" then \"✅\"
      elif . == \"failed\" then \"❌\"
      elif . == \"timedOut\" then \"⏱️\"
      elif . == \"skipped\" then \"⏭️\"
      else \"•\" end;
    [
      .browser,
      .caseLabel,
      .doc,
      (.status | statusEmoji) + \" \" + (.status // \"unknown\"),
      \"\(.sheetCount) / \(.expectedSheets)\" + (if .sheetCountOk then \"\" else \" ⚠️\" end),
      \"\(.fittedWidthPx.min | fmt2) – \(.fittedWidthPx.max | fmt2)\",
      \"\(.fittedHeightPx.min | fmt2) – \(.fittedHeightPx.max | fmt2)\",
      (clipEmoji(.worstVerticalClipPx; ${CLIP_TOL_EXPR})) + \"\(.worstVerticalClipPx | fmt2)\",
      (clipEmoji(.worstHorizontalClipPx; ${CLIP_TOL_EXPR})) + \"\(.worstHorizontalClipPx | fmt2)\",
      (clipEmoji(.worstRightOverflowPx; ${CLIP_TOL_EXPR}))
        + \"\(.worstRightOverflowPx | fmt2)\"
        + (if .worstRightOverflowSheet != null and .worstRightOverflowPx > 0
           then \" (p\(.worstRightOverflowSheet + 1))\" else \"\" end),
      (clipEmoji(.fittedWidthPx.spread; ${WIDTH_TOL_EXPR})) + \"\(.fittedWidthPx.spread | fmt2)\"
    ] | \"| \" + join(\" | \") + \" |\"
  " "$file" 2>/dev/null || true)
  if [ -n "$row" ]; then
    echo "$row" >> "$OUT"
  fi
done

# Per-page breakdown for long-receipt cases only — collapsed so short
# runs don't drown the summary. Reviewers who need per-page numbers
# expand this section.
{
  echo
  echo "<details><summary>Per-page breakdown (long-receipt)</summary>"
  echo
} >> "$OUT"

find "$SUMMARY_DIR" -maxdepth 1 -type f -name '*long-receipt.json' | sort | while read -r file; do
  header=$(jq -r '"#### \(.browser) — \(.caseLabel)"' "$file")
  {
    echo
    echo "$header"
    echo
    echo "| Page | W (px) | H (px) | ΔV clip | ΔH clip | Δ right overflow | Overflow element |"
    echo "|---|---|---|---|---|---|---|"
  } >> "$OUT"
  jq -r '
    def fmt2: (. * 100 | round) / 100;
    .perSheet[] | "| \(.page) | \(.width | fmt2) | \(.height | fmt2) | \(.vClipPx | fmt2) | \(.hClipPx | fmt2) | \(.rightOverflowPx | fmt2) | \(.rightOverflowElement // "—") |"
  ' "$file" >> "$OUT"
done

echo >> "$OUT"
echo "</details>" >> "$OUT"

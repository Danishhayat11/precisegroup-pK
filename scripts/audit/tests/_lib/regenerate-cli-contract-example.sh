#!/usr/bin/env bash
# Regenerates the canonical cli-contract.sh end-to-end example snippet in
# two places:
#
#   1. scripts/audit/tests/cli-contract.sh — the header comment block
#      between the markers:
#         # >>> CLI_CONTRACT_EXAMPLE_FULL BEGIN (auto-generated, do not edit)
#         # >>> CLI_CONTRACT_EXAMPLE_FULL END
#      Each generated line is prefixed with `#   ` (blank lines collapse
#      to a bare `#`) so it stays inside the existing shebang-block
#      comment.
#
#   2. scripts/audit/tests/_lib/README.md — the fenced ```bash``` block
#      between the markers:
#         <!-- BEGIN:cli-contract-example-full (auto-generated, do not edit) -->
#         <!-- END:cli-contract-example-full -->
#      The generator emits a fresh fenced block (opening ```bash, body,
#      closing ```) between the markers; the markers themselves are
#      preserved verbatim.
#
# How the snippet is built:
#
#   • Runs `bash scripts/audit/tests/cli-contract.sh` (no DB calls), and
#     captures stdout+stderr.
#   • Extracts the canonical "── Exit-code summary ──" → next blank-line
#     /self-regression boundary as the bucket block.
#   • Wraps it with the standard scaffolding (`$` prompt, abridged
#     per-scenario line, self-regression header, total assertion count
#     parsed from the live output).
#
# Usage:
#
#   bash scripts/audit/tests/_lib/regenerate-cli-contract-example.sh
#       Rewrites both files in place. Idempotent — running twice with no
#       upstream changes produces a byte-identical result.
#
#   bash scripts/audit/tests/_lib/regenerate-cli-contract-example.sh --check
#       Dry-run. Exits 0 if both files already match what the generator
#       would write, 1 otherwise. Intended for CI drift gating.
#
# After running without --check, re-run the doc-vs-render drift gate:
#
#   bash scripts/audit/tests/_lib/cli-contract.docs.sh
#
# Any failure there means the new render drifted from the assertions
# pinned in cli-contract.docs.sh; update those assertions in the same
# commit (see _lib/README.md → "Interpreting failures").

set -euo pipefail

MODE="write"
if [ "${1:-}" = "--check" ]; then
  MODE="check"
elif [ "${1:-}" != "" ]; then
  echo "usage: $0 [--check]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
CLI="$ROOT/scripts/audit/tests/cli-contract.sh"
README="$ROOT/scripts/audit/tests/_lib/README.md"

[ -f "$CLI" ]    || { echo "✗ missing $CLI" >&2; exit 1; }
[ -f "$README" ] || { echo "✗ missing $README" >&2; exit 1; }

tmp_out="$(mktemp)"
tmp_a="$(mktemp)"
tmp_b="$(mktemp)"
trap 'rm -f "$tmp_out" "$tmp_a" "$tmp_b"' EXIT

# 1. Run cli-contract.sh and capture combined output. The suite exits 0
#    on success; we still tolerate non-zero so a regression doesn't
#    silently produce an empty snippet — the extraction step below
#    catches a missing bucket block explicitly.
bash "$CLI" >"$tmp_out" 2>&1 || true

# 2. Pull the bucket block: from "── Exit-code summary ──" up to (but not
#    including) the self-regression header line.
bucket_block="$(awk '
  /── Exit-code summary ──/ { flag = 1 }
  flag && /^── self-regression/ { flag = 0 }
  flag { print }
' "$tmp_out")"

if [ -z "$bucket_block" ]; then
  echo "✗ failed to capture '── Exit-code summary ──' block from $CLI" >&2
  echo "  raw output saved at $tmp_out" >&2
  trap - EXIT
  exit 1
fi

# 3. Parse the total assertion count from the trailing summary line so
#    the regenerated snippet stays in sync if assertions are added.
total="$(awk '
  match($0, /All ([0-9]+) CLI contract assertions passed/, m) { print m[1]; exit }
' "$tmp_out")"
if [ -z "$total" ]; then
  echo "✗ failed to parse 'All N CLI contract assertions passed' from cli-contract.sh output" >&2
  trap - EXIT
  exit 1
fi

# 4. Build the canonical snippet body (plain text — no leading prefix).
#    This is what lands inside the README's ```bash``` fence; the header
#    rewriter prefixes each line with `#   ` / `#` for blank lines.
snippet_body="$(printf '%s\n' \
  '$ bash scripts/audit/tests/cli-contract.sh' \
  '✓ [1] --help prints usage and exits 0' \
  '... (8 scenarios) ...' \
  "$bucket_block" \
  '── self-regression: helper delegation + auto-discovery (no EXEMPT) ──' \
  '  ✓ [self/1..11] ...' \
  "✓ All ${total} CLI contract assertions passed.")"

# 5. Render the README replacement (fenced bash block, markers preserved).
awk -v body="$snippet_body" '
  /<!-- BEGIN:cli-contract-example-full \(auto-generated, do not edit\) -->/ {
    print
    print "```bash"
    print body
    print "```"
    inside = 1
    next
  }
  /<!-- END:cli-contract-example-full -->/ {
    inside = 0
    print
    next
  }
  !inside { print }
' "$README" > "$tmp_a"

if ! grep -qF "<!-- BEGIN:cli-contract-example-full (auto-generated, do not edit) -->" "$README"; then
  echo "✗ $README is missing the BEGIN marker:" >&2
  echo "  <!-- BEGIN:cli-contract-example-full (auto-generated, do not edit) -->" >&2
  trap - EXIT
  exit 1
fi
if ! grep -qF "<!-- END:cli-contract-example-full -->" "$README"; then
  echo "✗ $README is missing the END marker:" >&2
  echo "  <!-- END:cli-contract-example-full -->" >&2
  trap - EXIT
  exit 1
fi

# 6. Render the cli-contract.sh header replacement. Each snippet line is
#    prefixed with `#   ` (blank lines collapse to a bare `#`) so it
#    stays inside the existing comment block.
awk -v body="$snippet_body" '
  /^# >>> CLI_CONTRACT_EXAMPLE_FULL BEGIN \(auto-generated, do not edit\)$/ {
    print
    n = split(body, lines, "\n")
    for (i = 1; i <= n; i++) {
      if (lines[i] == "") print "#"
      else print "#   " lines[i]
    }
    inside = 1
    next
  }
  /^# >>> CLI_CONTRACT_EXAMPLE_FULL END$/ {
    inside = 0
    print
    next
  }
  !inside { print }
' "$CLI" > "$tmp_b"

if ! grep -qxF "# >>> CLI_CONTRACT_EXAMPLE_FULL BEGIN (auto-generated, do not edit)" "$CLI"; then
  echo "✗ $CLI is missing the BEGIN marker line:" >&2
  echo "  # >>> CLI_CONTRACT_EXAMPLE_FULL BEGIN (auto-generated, do not edit)" >&2
  trap - EXIT
  exit 1
fi
if ! grep -qxF "# >>> CLI_CONTRACT_EXAMPLE_FULL END" "$CLI"; then
  echo "✗ $CLI is missing the END marker line:" >&2
  echo "  # >>> CLI_CONTRACT_EXAMPLE_FULL END" >&2
  trap - EXIT
  exit 1
fi

# 7. Write or check.
if [ "$MODE" = "check" ]; then
  drift=0
  _show_diff() {
    # `diff` is optional — only render a hint when it's actually available.
    if command -v diff >/dev/null 2>&1; then
      diff -u "$1" "$2" || true
    else
      echo "  (install \`diff\` to see a line-level breakdown)"
    fi
  }
  _same() {
    # Pure-bash equality so the check works in minimal sandboxes that
    # ship without `cmp` or `diff`.
    [ "$(cat "$1")" = "$(cat "$2")" ]
  }
  if ! _same "$README" "$tmp_a"; then
    echo "✗ drift: $README needs regeneration"
    _show_diff "$README" "$tmp_a"
    drift=1
  fi
  if ! _same "$CLI" "$tmp_b"; then
    echo "✗ drift: $CLI needs regeneration"
    _show_diff "$CLI" "$tmp_b"
    drift=1
  fi
  if [ "$drift" -ne 0 ]; then
    echo "" >&2
    echo "Run: bash scripts/audit/tests/_lib/regenerate-cli-contract-example.sh" >&2
    exit 1
  fi
  echo "✓ cli-contract.sh example snippet is up to date in both files."
  exit 0
fi

cp "$tmp_a" "$README"
cp "$tmp_b" "$CLI"
echo "✓ regenerated cli-contract.sh example snippet in:"
echo "    $README"
echo "    $CLI"

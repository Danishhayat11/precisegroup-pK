#!/usr/bin/env bash
# Doc/render drift gate for scripts/audit/tests/cli-contract.sh.
#
# The header comment in cli-contract.sh advertises a precise summary
# contract (bucket 0 = --help / -h, bucket 1 = placeholder, bucket 2 =
# six invalid-arg scenarios, rendered via `summary_print 0 1 2`). The
# rest of the audit tooling — summary-format.sh validation, the
# Exit-code summary in CI logs, the _lib smokes — treats that header as
# the source of truth. If the documentation says one thing and the
# script renders another, every downstream consumer silently lies.
#
# This smoke parses the header AND runs cli-contract.sh in isolation,
# then cross-checks every claim against the rendered bucket layout.
# A drift in either direction (text changed without updating the
# script, or rows added/removed without updating the text) fails here.

set -u

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT="$ROOT/scripts/audit/tests/cli-contract.sh"

n=0; fail=0
assert() {
  local desc="$1" cond="$2"
  n=$((n+1))
  if eval "$cond"; then
    echo "✓ [$n] $desc"
  else
    echo "✗ [$n] $desc"
    fail=$((fail+1))
  fi
}

[ -f "$SCRIPT" ] || { echo "✗ cli-contract.sh not found at $SCRIPT"; exit 2; }

# ── Phase 1: parse the documented contract from the header comment ──
# Grab the contiguous leading "# …" block so we never read stray comments
# from later in the file.
HEADER="$(awk '/^#/{print; next} {exit}' "$SCRIPT")"

assert "header documents 'summary_print 0 1 2' bucket order" \
  'grep -qE "summary_print 0 1 2" <<<"$HEADER"'

assert "header documents bucket 0 → --help / -h scenarios" \
  'grep -qE "exit 0.*help|--help.*-h" <<<"$HEADER"'

assert "header documents bucket 1 → placeholder line" \
  'grep -qF "(no scenarios exercised this code)" <<<"$HEADER"'

# Pin the literal "six" claim from the header so changing the row count
# in the script without updating the prose trips this assertion.
assert "header documents bucket 2 → six invalid-arg scenarios" \
  'grep -qE "exit 2.*six|six invalid-arg scenarios" <<<"$HEADER"'

assert "header documents canonical 'Exit-code summary' heading" \
  'grep -qF "── Exit-code summary ──" <<<"$HEADER"'

assert "header documents the _lib/exit-summary.sh source path" \
  'grep -qE "_lib/exit-summary\.sh" <<<"$HEADER"'

# Script body must match the documented summary_print invocation.
assert "script body calls summary_print 0 1 2 (matches header)" \
  'grep -qxE "summary_print 0 1 2" "$SCRIPT"'

# ── Phase 2: actually run the suite and validate the rendered block ──
RENDER_LOG="$(mktemp)"
trap 'rm -f "$RENDER_LOG"' EXIT

# Suite may exit non-zero if assertions fail in the sandbox; we still
# want to inspect the rendered summary block, so swallow the exit code.
( cd "$ROOT" && bash "$SCRIPT" ) >"$RENDER_LOG" 2>&1 || true

assert "rendered output contains exactly one 'Exit-code summary' header" \
  '[ "$(grep -cF "── Exit-code summary ──" "$RENDER_LOG")" = "1" ]'

assert "rendered buckets are exactly 0,1,2 in ascending order" \
  'grep -oE "^exit [0-9]+ — .+:$" "$RENDER_LOG" \
     | sed -E "s/^exit ([0-9]+) .*/\1/" \
     | paste -sd, - | grep -qx "0,1,2"'

# Extract each bucket body (lines between "exit N — …:" and the next
# bucket header / blank line) and count ✓ rows.
bucket_body() {
  awk -v code="$1" '
    $0 ~ "^exit " code " — " {f=1; next}
    f && $0 ~ "^exit [0-9]+ — " {f=0}
    f && /^$/ {f=0}
    f {print}
  ' "$RENDER_LOG"
}

B0="$(bucket_body 0)"
B1="$(bucket_body 1)"
B2="$(bucket_body 2)"

assert "bucket 0 has exactly 2 ✓ rows (matches '--help / -h' claim)" \
  '[ "$(grep -cE "^[[:space:]]*✓ " <<<"$B0")" = "2" ]'

assert "bucket 0 ✓ rows reference the help scenarios" \
  'grep -qE "help" <<<"$B0"'

assert "bucket 1 renders the placeholder line (no drift scenarios)" \
  'grep -qxF "  (no scenarios exercised this code)" <<<"$B1"'

assert "bucket 1 has no ✓/✗ rows (placeholder is exclusive)" \
  '[ "$(grep -cE "^[[:space:]]*[✓✗] " <<<"$B1")" = "0" ]'

assert "bucket 2 has exactly 6 ✓ rows (matches 'six invalid-arg scenarios' claim)" \
  '[ "$(grep -cE "^[[:space:]]*✓ " <<<"$B2")" = "6" ]'

if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n cli-contract.sh doc-vs-render assertion(s) failed."
  exit 1
fi
echo "✓ All $n cli-contract.sh doc-vs-render assertions passed."

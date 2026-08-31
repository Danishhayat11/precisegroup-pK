#!/usr/bin/env bash
# Cross-checks the canonical example snippet pinned in
# scripts/audit/tests/cli-contract.sh's header (and mirrored in
# scripts/audit/tests/_lib/README.md) against what the suite actually
# renders today — so the prose example can't drift out of sync with the
# live exit-summary/summary-format bucket output.
#
# Three sources of truth are compared:
#
#   A. The header snippet between
#        # >>> CLI_CONTRACT_EXAMPLE_FULL BEGIN (auto-generated, do not edit)
#        # >>> CLI_CONTRACT_EXAMPLE_FULL END
#      (with the leading `#   ` / `#` comment prefix stripped).
#   B. The README snippet between
#        <!-- BEGIN:cli-contract-example-full (auto-generated, do not edit) -->
#        <!-- END:cli-contract-example-full -->
#      (with the surrounding ```bash fence stripped).
#   C. The live `bash scripts/audit/tests/cli-contract.sh` output.
#
# All three MUST agree on:
#   • the canonical "── Exit-code summary ──" header line (exactly once);
#   • the 0 / 1 / 2 bucket bodies, byte-for-byte;
#   • the bucket ordering (0 → 1 → 2 ascending);
#   • the trailing "✓ All N CLI contract assertions passed." line, with
#     matching N.
#
# This complements cli-contract.docs.sh (which asserts structural claims
# in the header text) by asserting *snippet content parity* — the actual
# bucket lines must match the live render, character for character.

set -u
fail=0
n=0

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
CLI="$ROOT/scripts/audit/tests/cli-contract.sh"
README="$ROOT/scripts/audit/tests/_lib/README.md"

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

# Extract a sub-block by delimiter regexes (exclusive of the delimiter lines).
# Extract a sub-block by exact-match delimiter lines (exclusive of the
# delimiter lines themselves). Uses string equality, not regex, so
# parentheses / brackets in the marker lines need no escaping.
slice() {
  local file="$1" begin="$2" end="$3"
  awk -v b="$begin" -v e="$end" '
    $0 == b { flag = 1; next }
    $0 == e { flag = 0 }
    flag    { print }
  ' "$file"
}

# Pull the bucket region (── Exit-code summary ── through the line
# immediately preceding ── self-regression …) from a multi-line blob.
bucket_region() {
  awk '
    /── Exit-code summary ──/ { flag = 1 }
    flag && /^── self-regression/ { flag = 0 }
    flag { print }
  '
}

# 1. Capture the live render once and reuse it across every assertion.
LIVE_OUT="$(bash "$CLI" 2>&1)"
LIVE_BUCKETS="$(printf '%s\n' "$LIVE_OUT" | bucket_region)"
LIVE_TOTAL="$(printf '%s\n' "$LIVE_OUT" | awk '
  match($0, /All ([0-9]+) CLI contract assertions passed/, m) { print m[1]; exit }
')"

assert "live cli-contract.sh produced a non-empty '── Exit-code summary ──' block" \
  '[ -n "$LIVE_BUCKETS" ]'
assert "live cli-contract.sh produced a parseable 'All N … passed' total" \
  '[ -n "$LIVE_TOTAL" ]'

# 2. Extract + un-prefix the header snippet (strip `#   ` / `#` leading
#    comment marker; blank `#` lines become true blank lines).
HEADER_RAW="$(slice "$CLI" \
  '# >>> CLI_CONTRACT_EXAMPLE_FULL BEGIN (auto-generated, do not edit)' \
  '# >>> CLI_CONTRACT_EXAMPLE_FULL END')"
HEADER_SNIPPET="$(printf '%s\n' "$HEADER_RAW" | awk '
  /^#   / { sub(/^#   /, "", $0); print; next }
  /^#$/   { print "";                next }
  /^# $/  { print "";                next }
  { print }   # surface anything unexpected so the diff fails loudly
')"
HEADER_BUCKETS="$(printf '%s\n' "$HEADER_SNIPPET" | bucket_region)"

assert "header snippet block is present (markers found, body non-empty)" \
  '[ -n "$HEADER_RAW" ] && [ -n "$HEADER_SNIPPET" ]'
assert "header snippet contains a '── Exit-code summary ──' line" \
  'printf "%s\n" "$HEADER_SNIPPET" | grep -qxF "── Exit-code summary ──"'
assert "header snippet bucket block matches live render byte-for-byte" \
  '[ "$HEADER_BUCKETS" = "$LIVE_BUCKETS" ]'

# 3. Extract the README snippet (inside the ```bash fence between the
#    HTML comment markers).
README_RAW="$(slice "$README" \
  '<!-- BEGIN:cli-contract-example-full (auto-generated, do not edit) -->' \
  '<!-- END:cli-contract-example-full -->')"
README_SNIPPET="$(printf '%s\n' "$README_RAW" | awk '
  /^```bash$/ { infence = 1; next }
  /^```$/     { infence = 0; next }
  infence     { print }
')"
README_BUCKETS="$(printf '%s\n' "$README_SNIPPET" | bucket_region)"

assert "README snippet block is present (markers found, body non-empty)" \
  '[ -n "$README_RAW" ] && [ -n "$README_SNIPPET" ]'
assert "README snippet is wrapped in a \`\`\`bash fence (no stray prose)" \
  'printf "%s\n" "$README_RAW" | grep -qxF "\`\`\`bash" && printf "%s\n" "$README_RAW" | grep -qxF "\`\`\`"'
assert "README snippet bucket block matches live render byte-for-byte" \
  '[ "$README_BUCKETS" = "$LIVE_BUCKETS" ]'

# 4. Parity between the two prose sources (header ⇔ README) — even
#    outside the bucket region, the full snippet body must agree, so the
#    `$ bash …` prompt line, abridged `... (8 scenarios) ...` placeholder,
#    self-regression footer, and total line all stay aligned.
assert "header snippet and README snippet are byte-identical (full body)" \
  '[ "$HEADER_SNIPPET" = "$README_SNIPPET" ]'

# 5. Bucket-ordering invariants — extracted from the live bucket block so
#    a snippet that "matches" a broken render still fails here.
ORDER="$(printf '%s\n' "$LIVE_BUCKETS" | awk '
  /^exit ([0-9]+)/ { match($0, /^exit ([0-9]+)/, m); printf "%s ", m[1] }
')"
assert "live bucket block renders buckets in ascending 0 → 1 → 2 order" \
  '[ "$(printf "%s" "$ORDER" | tr -s " " | sed "s/ $//")" = "0 1 2" ]'

# 6. Total-assertion-count agreement. Snippets and live render all carry
#    the same "✓ All N CLI contract assertions passed." trailing line.
HEADER_TOTAL="$(printf '%s\n' "$HEADER_SNIPPET" | awk '
  match($0, /All ([0-9]+) CLI contract assertions passed/, m) { print m[1]; exit }
')"
README_TOTAL="$(printf '%s\n' "$README_SNIPPET" | awk '
  match($0, /All ([0-9]+) CLI contract assertions passed/, m) { print m[1]; exit }
')"
assert "header snippet total assertion count matches live (N=$LIVE_TOTAL)" \
  '[ "$HEADER_TOTAL" = "$LIVE_TOTAL" ]'
assert "README snippet total assertion count matches live (N=$LIVE_TOTAL)" \
  '[ "$README_TOTAL" = "$LIVE_TOTAL" ]'

# 7. Bucket-1 placeholder invariant inside the snippet — guards against a
#    well-meaning copy-edit that swaps the canonical placeholder string
#    for paraphrased text (summary-format.sh would reject the live form,
#    but a paraphrased snippet would otherwise pass parity if the live
#    text were also wrong).
assert "header snippet bucket 1 carries the canonical placeholder line" \
  'printf "%s\n" "$HEADER_BUCKETS" | grep -qxF "  (no scenarios exercised this code)"'

# 8. End-to-end command parity — the literal `$ …` prompt line embedded in
#    the README snippet must (a) name a runnable command and (b) when
#    actually executed, reproduce the exact bucket block printed below it.
#    This is the CI assertion that the README example command *is* what
#    produced the expected 0/1/2 snippet — not just a hand-written caption.
README_CMD="$(printf '%s\n' "$README_SNIPPET" | awk '
  /^\$ / { sub(/^\$ /, "", $0); print; exit }
')"
assert "README snippet starts with a '\$ ' prompt line naming a command" \
  '[ -n "$README_CMD" ]'
assert "README example command is exactly 'bash scripts/audit/tests/cli-contract.sh'" \
  '[ "$README_CMD" = "bash scripts/audit/tests/cli-contract.sh" ]'

# Execute the command parsed from the README (relative to repo root) and
# compare its bucket region to the snippet's bucket region.
EXEC_OUT="$(cd "$ROOT" && eval "$README_CMD" 2>&1 || true)"
EXEC_BUCKETS="$(printf '%s\n' "$EXEC_OUT" | bucket_region)"
EXEC_TOTAL="$(printf '%s\n' "$EXEC_OUT" | awk '
  match($0, /All ([0-9]+) CLI contract assertions passed/, m) { print m[1]; exit }
')"
assert "executing the README's '\$ …' command produced a non-empty bucket block" \
  '[ -n "$EXEC_BUCKETS" ]'
assert "executing the README's '\$ …' command reproduced the snippet bucket block byte-for-byte" \
  '[ "$EXEC_BUCKETS" = "$README_BUCKETS" ]'
assert "executing the README's '\$ …' command reproduced the snippet total (N=$LIVE_TOTAL)" \
  '[ "$EXEC_TOTAL" = "$README_TOTAL" ]'


if [ "$fail" -ne 0 ]; then
  echo ""
  echo "✗ $fail/$n cli-contract.sh example-snippet parity assertion(s) failed."
  echo "  Run: bash scripts/audit/tests/_lib/regenerate-cli-contract-example.sh"
  echo "  Then re-run this gate."
  exit 1
fi

echo "✓ All $n cli-contract.sh example-snippet parity assertions passed."

#!/usr/bin/env bash
# CI-level guard: every audit test script in scripts/audit/tests/ MUST end
# its run with a "── Exit-code summary ──" block emitted by the shared
# helper at scripts/audit/tests/_lib/exit-summary.sh, with the documented
# bucket labels in the documented order.
#
# Why this exists: a refactor that swaps the helper, mutes the summary,
# reorders the buckets, or changes the label wording would silently break
# CI log forensics (reviewers grep these headings to answer "which scenario
# produced exit N?"). Failing fast here keeps every suite shape-compatible
# with scripts/audit/README.md → "CI interpretation".
#
# Two layers of validation run for every audit suite:
#
#   1. PINNED suites (SUITES below) assert exact label wording per code,
#      catching label drift or print-order regressions in the four suites
#      that have established per-script overrides.
#
#   2. AUTO-DISCOVERED suites — every other scripts/audit/tests/*.sh that
#      is not summary-format.sh itself and not in EXEMPT — must still emit
#      the header exactly once and at least one well-formed bucket of the
#      shape `exit <N> — <label>:` followed by a `  ✓` / `  ✗` /
#      `  (no scenarios exercised this code)` body line. This catches any
#      NEW test script that forgets to wire in the shared helper.
#
# To pin label wording for a newly-added suite, add an entry to SUITES.
# To intentionally skip a suite, add it to EXEMPT with a justifying comment.

set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TESTS_DIR="$ROOT/scripts/audit/tests"
HEADER="── Exit-code summary ──"
fail=0
n=0

# Shared suite-enumeration rules — see _lib/suite-discovery.sh for the
# contract. Using this helper guarantees that any future tool (run-all.sh,
# ad-hoc CI greps) selects the same set of suites we validate here.
# shellcheck source=./_lib/suite-discovery.sh
. "$TESTS_DIR/_lib/suite-discovery.sh"


# script | codes (space-sep, in print order) | label0 | label1 | ...
# `;` separates fields so labels can contain `|`.
SUITES=(
  "scripts/audit/tests/cli-exit-codes.sh;0 1 2;\
exit 0 — pass / warn-mode;\
exit 1 — drift detected;\
exit 2 — strict missing pin / invalid args"

  "scripts/audit/tests/strict-mode.sh;0 1 2;\
exit 0 — pass / warn-mode;\
exit 1 — drift detected / strict-on-main escalation;\
exit 2 — strict missing pin / invalid args"

  "scripts/audit/tests/branch-escalate.sh;0 1 2;\
exit 0 — pass / warn-mode (feature-branch missing pin);\
exit 1 — drift / strict-on-default-branch escalation;\
exit 2 — strict missing pin / invalid args (pre-escalation)"

  "scripts/audit/tests/required-args-and-db.sh;0 1 2 3;\
exit 0 — pass / warn-mode;\
exit 1 — drift detected;\
exit 2 — strict missing pin / invalid args;\
exit 3 — infrastructure failure (psql missing / DB unreachable)"
)

# Suites intentionally skipped by auto-discovery beyond the built-in set
# (summary-format.sh itself, run-all.sh orchestrator, _lib/* helpers) that
# suite-discovery.sh already excludes. Each entry MUST have a brief
# justification — exemptions are a last resort, not a default.
EXEMPT=()


TMP=$(mktemp -d)

# ─────────────────────────────────────────────────────────────────────────────
# README — summary-format-failures artifact contract
# ─────────────────────────────────────────────────────────────────────────────
# When a suite fails the format contract, copy its full captured log into
# FAIL_DIR (default: $ROOT/.summary-format-failures) so CI can upload it
# as an artifact. The directory is OUTSIDE $TMP so the EXIT trap does not
# clobber it on the failure path; the workflow's actions/upload-artifact
# step picks it up with `if-no-files-found: ignore` and publishes it under
# the artifact name `summary-format-failures`.
#
# Lifecycle contract (enforced by the EXIT trap below):
#   • Successful run  → FAIL_DIR is always removed, no on-disk residue.
#   • Failing run     → FAIL_DIR is preserved so CI can upload it as the
#                       'summary-format-failures' artifact, and the
#                       workflow's own follow-up cleanup step removes it
#                       after upload to keep the runner workspace clean.
#   • Interrupted run → the trap still fires; FAIL_DIR is preserved only
#                       if at least one failure was already recorded.
#
# Artifact layout (asserted by _lib/summary-format.fail-artifact.sh) — these
# filenames are part of the public contract; CI log forensics, the HTML
# preview, and downstream tooling all key off them by exact name:
#   FAILURES.md            — markdown index, one section per failing suite.
#                            Also streamed verbatim into $GITHUB_STEP_SUMMARY
#                            so reviewers see the failure table on the job's
#                            Summary tab without downloading the artifact.
#   index.html             — minimal HTML index for the browser-based
#                            actions/upload-artifact preview, with links
#                            to FAILURES.md and every <suite>.log.
#   <suite-basename>.log   — one file per failing suite (basename of the
#                            failing scripts/audit/tests/<suite>.sh, e.g.
#                            `cli-exit-codes.log`). Contains a capture
#                            banner (suite path, capture time, exit code,
#                            reason, commit) followed by verbatim
#                            stdout+stderr framed by BEGIN/END markers.
#
# Where this surfaces in the GitHub Actions job:
#   • Job log (stderr tail of this step) — prints "Captured failing output:
#     $FAIL_DIR" plus the filename legend, so a failed step is self-describing.
#   • Step output `fail_dir=<path>` (written to $GITHUB_OUTPUT) — downstream
#     workflow steps can reference it without re-deriving the path.
#   • Summary tab ($GITHUB_STEP_SUMMARY) — FAILURES.md is appended so the
#     per-suite failure list renders inline on the run's overview page.
#   • Artifacts panel — uploaded as `summary-format-failures`; opening it in
#     the browser renders index.html with links to FAILURES.md and each
#     <suite-basename>.log.
# ─────────────────────────────────────────────────────────────────────────────
# Artifact toggle — set SUMMARY_FAILURE_ARTIFACT=0 to disable writing
# FAIL_DIR (per-suite .log files, FAILURES.md, index.html) AND to suppress
# the matching upload step in .github/workflows/security.yml. Defaults to
# `1` (on) so CI keeps producing the `summary-format-failures` artifact
# without any workflow changes. Use `0` for local runs where you only want
# the stderr summary, or to temporarily silence artifact uploads from a
# branch without editing the workflow.
SUMMARY_FAILURE_ARTIFACT="${SUMMARY_FAILURE_ARTIFACT:-1}"
case "$SUMMARY_FAILURE_ARTIFACT" in
  0|1) ;;
  *)
    echo "summary-format.sh: SUMMARY_FAILURE_ARTIFACT must be 0 or 1 (got: $SUMMARY_FAILURE_ARTIFACT)" >&2
    exit 2
    ;;
esac

FAIL_DIR="${SUMMARY_FAILURE_DIR:-$ROOT/.summary-format-failures}"
rm -rf "$FAIL_DIR"
if [ "$SUMMARY_FAILURE_ARTIFACT" = "1" ]; then
  mkdir -p "$FAIL_DIR"
fi

_cleanup() {
  rm -rf "$TMP"
  # Preserve FAIL_DIR only when the artifact is enabled AND at least one
  # suite failed; otherwise always clean it up so green runs (and runs
  # with the artifact disabled) leave no on-disk residue.
  if [ "$SUMMARY_FAILURE_ARTIFACT" != "1" ] || [ "${fail:-0}" -eq 0 ]; then
    rm -rf "$FAIL_DIR"
  fi
}
trap _cleanup EXIT
FAIL_INDEX="$FAIL_DIR/FAILURES.md"
FAIL_HTML="$FAIL_DIR/index.html"
if [ "$SUMMARY_FAILURE_ARTIFACT" = "1" ]; then
  {
    echo "# summary-format.sh failures"
    echo
    echo "Captured at: $(date -u +%FT%TZ)"
    echo "Commit: ${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
    echo "Workflow run: ${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
    echo
    echo "Each entry below corresponds to one suite that failed the"
    echo '`── Exit-code summary ──` contract. The full captured stdout+stderr'
    echo "for that suite is in the sibling \`<basename>.log\` file."
    echo
  } >"$FAIL_INDEX"
fi


# HTML-escape stdin → stdout. Only the five characters that can break out
# of <pre> / attribute context are encoded; that is sufficient for the
# minimal index page rendered below and avoids pulling in a perl/awk dep.
_html_escape() {
  sed -e 's/&/\&amp;/g' \
      -e 's/</\&lt;/g' \
      -e 's/>/\&gt;/g' \
      -e 's/"/\&quot;/g' \
      -e "s/'/\&#39;/g"
}

# record_failure <script-rel-path> <log-file> <reason> [suite-exit-code]
# Writes an annotated per-suite log into FAIL_DIR/<basename>.log that
# combines (a) capture metadata + the validator's own diagnostic reason
# with (b) the verbatim suite stdout+stderr that was captured at run
# time. Reviewers opening the failure artifact get the full context for
# the suite in a single file without having to cross-reference
# FAILURES.md and the raw log. Also appends a markdown entry to
# FAILURES.md AND an HTML row to index.html (kept in lockstep so the
# actions/upload-artifact preview shows the same set of failures), and
# emits a GitHub Actions ::error:: annotation pointing at the suite
# file so reviewers see the failure in the PR "Files changed" tab as
# well as in the Job summary.
record_failure() {
  local script="$1" log="$2" reason="$3" exit_code="${4:-unknown}"
  local base
  base=$(basename "$script")
  local dest="$FAIL_DIR/$base.log"
  if [ "$SUMMARY_FAILURE_ARTIFACT" = "1" ]; then
    # Annotated per-suite log: banner + reason + verbatim suite output.
    {
      echo "================================================================"
      echo " summary-format.sh — captured failure"
      echo "================================================================"
      echo "Suite:         $script"
      echo "Captured at:   $(date -u +%FT%TZ)"
      echo "Suite exit:    $exit_code"
      echo "Reason:        $reason"
      echo "Source log:    $log"
      echo "Commit:        ${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
      echo
      echo "──────── BEGIN suite stdout+stderr ────────"
      if [ -r "$log" ]; then
        cat "$log"
      else
        echo "(captured log $log was unreadable — see CI stdout)"
      fi
      echo "──────── END suite stdout+stderr ────────"
    } >"$dest" 2>/dev/null || true
    {
      echo "## $script"
      echo
      echo "- Reason: $reason"
      echo "- Suite exit: $exit_code"
      echo "- Captured log: \`${base}.log\` (capture metadata + full suite stdout+stderr)"
      echo
      echo '```'
      sed -n '1,40p' "$log"
      echo '... (truncated; see full log in artifact)'
      echo '```'
      echo
    } >>"$FAIL_INDEX"
    # Append a row to the running HTML index. The full document header
    # and footer are written once, after the loop, in _html_finalize.
    {
      printf '<section class="failure">\n'
      printf '  <h2><code>%s</code></h2>\n' "$(printf '%s' "$script" | _html_escape)"
      printf '  <p><strong>Reason:</strong> %s</p>\n' "$(printf '%s' "$reason" | _html_escape)"
      printf '  <p><strong>Suite exit:</strong> <code>%s</code></p>\n' \
        "$(printf '%s' "$exit_code" | _html_escape)"
      printf '  <p>Captured log: <a href="%s">%s</a> (capture metadata + full suite stdout+stderr)</p>\n' \
        "$(printf '%s' "${base}.log" | _html_escape)" \
        "$(printf '%s' "${base}.log" | _html_escape)"
      printf '  <pre>'
      sed -n '1,40p' "$log" | _html_escape
      printf '</pre>\n'
      printf '  <p><em>... (truncated; see full log in artifact)</em></p>\n'
      printf '</section>\n'
    } >>"$FAIL_HTML"
  fi
  # GitHub Actions annotation — surfaces inline in the PR diff.
  printf '::error file=%s::summary-format: %s\n' "$script" "$reason"
}

# Wrap the per-failure <section> rows with a proper HTML document so the
# actions/upload-artifact browser preview renders them. Called only when
# at least one failure was recorded (see exit path at the bottom).
_html_finalize() {
  local body
  body=$(cat "$FAIL_HTML" 2>/dev/null || true)
  {
    cat <<HTML_HEAD
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>summary-format.sh failures</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { border-bottom: 2px solid #d73a49; padding-bottom: .25rem; }
    h2 { color: #d73a49; margin-top: 2rem; }
    code { background: #f6f8fa; padding: 1px 4px; border-radius: 3px; }
    pre { background: #f6f8fa; padding: .75rem 1rem; overflow-x: auto; border-radius: 4px; font-size: 12px; line-height: 1.4; }
    .meta { color: #666; font-size: 14px; }
    a { color: #0366d6; }
  </style>
</head>
<body>
  <h1>summary-format.sh failures</h1>
  <p class="meta">Captured at: $(date -u +%FT%TZ)</p>
  <p class="meta">Commit: ${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}</p>
  <p>Full markdown index: <a href="FAILURES.md">FAILURES.md</a></p>
HTML_HEAD
    printf '%s\n' "$body"
    cat <<'HTML_TAIL'
</body>
</html>
HTML_TAIL
  } >"$FAIL_HTML.tmp"
  mv "$FAIL_HTML.tmp" "$FAIL_HTML"
}






check_suite() {
  local entry="$1"
  IFS=';' read -r -a parts <<<"$entry"
  local script="${parts[0]}"
  local codes_str="${parts[1]}"
  read -r -a codes <<<"$codes_str"
  # Remaining parts are labels in code order.
  local labels=("${parts[@]:2}")
  n=$((n+1))

  echo "── checking $script ──"
  local log="$TMP/$(basename "$script").log"
  local suite_rc=0
  bash "$ROOT/$script" >"$log" 2>&1 || suite_rc=$?
  if [ "$suite_rc" -ne 0 ]; then
    echo "✗ [$n] $script exited non-zero ($suite_rc); cannot validate summary."
    sed -n '1,40p' "$log"
    echo "  ... (truncated; full log in $log)"
    record_failure "$script" "$log" "suite exited non-zero ($suite_rc) before summary could be validated" "$suite_rc"
    fail=$((fail+1))
    return
  fi

  # 1) Header must be present, exactly once.
  local hdr_count
  hdr_count=$(grep -cF -- "$HEADER" "$log" || true)
  if [ "$hdr_count" != "1" ]; then
    echo "✗ [$n] expected exactly 1 \"$HEADER\" line, found $hdr_count"
    record_failure "$script" "$log" "expected exactly 1 \"$HEADER\" line, found $hdr_count" "0"
    fail=$((fail+1))
    return
  fi

  # 2) Restrict the rest of the checks to the summary tail (header onward),
  #    so a stray earlier echo can't satisfy a label match.
  local tail
  tail=$(awk -v h="$HEADER" 'index($0,h){found=1} found' "$log")

  # 3) Each declared label must appear (as a header line, ending with ":"),
  #    in the declared order, with a non-empty bucket body underneath
  #    ("  ✓ ..." / "  ✗ ..." / "  (no scenarios exercised this code)").
  local last_pos=0
  local i label pos
  for i in "${!codes[@]}"; do
    label="${labels[$i]}:"
    pos=$(awk -v l="$label" 'index($0,l){print NR; exit}' <<<"$tail")
    if [ -z "$pos" ]; then
      echo "✗ [$n] missing label for exit ${codes[$i]}: \"$label\""
      record_failure "$script" "$log" "missing label for exit ${codes[$i]}: \"$label\"" "0"
      fail=$((fail+1))
      return
    fi
    if [ "$pos" -le "$last_pos" ]; then
      echo "✗ [$n] label order wrong: \"$label\" appeared at line $pos (≤ previous $last_pos)"
      record_failure "$script" "$log" "label order wrong: \"$label\" at line $pos (≤ previous $last_pos)" "0"
      fail=$((fail+1))
      return
    fi
    # Body line immediately after the label must be a bucket entry.
    local body
    body=$(awk -v p="$pos" 'NR==p+1' <<<"$tail")
    if ! grep -qE '^(  ✓|  ✗|  \(no scenarios exercised this code\))' <<<"$body"; then
      echo "✗ [$n] bucket body missing/malformed under \"$label\" (got: \"$body\")"
      record_failure "$script" "$log" "bucket body missing/malformed under \"$label\"" "0"
      fail=$((fail+1))
      return
    fi
    last_pos="$pos"
  done


  echo "✓ [$n] $script — header + ${#codes[@]} labels in order, all buckets well-formed"
}

# Generic shape check for any suite NOT covered by a SUITES pin: header
# present exactly once, at least one well-formed bucket of the shape
# `exit <N> — <text>:` followed by a ✓ / ✗ / placeholder body line, all
# buckets in monotonically increasing line order under the header.
check_suite_generic() {
  local rel="$1"
  n=$((n+1))
  echo "── checking $rel (auto-discovered) ──"
  local log="$TMP/$(basename "$rel").log"
  local suite_rc=0
  bash "$ROOT/$rel" >"$log" 2>&1 || suite_rc=$?
  if [ "$suite_rc" -ne 0 ]; then
    echo "✗ [$n] $rel exited non-zero ($suite_rc); cannot validate summary."
    sed -n '1,40p' "$log"
    echo "  ... (truncated; full log in $log)"
    record_failure "$rel" "$log" "auto-discovered suite exited non-zero ($suite_rc) before summary could be validated" "$suite_rc"
    fail=$((fail+1))
    return
  fi

  local hdr_count
  hdr_count=$(grep -cF -- "$HEADER" "$log" || true)
  if [ "$hdr_count" != "1" ]; then
    echo "✗ [$n] expected exactly 1 \"$HEADER\" line, found $hdr_count"
    echo "  HINT: source scripts/audit/tests/_lib/exit-summary.sh and call summary_print."
    record_failure "$rel" "$log" "expected exactly 1 \"$HEADER\" line, found $hdr_count (missing exit-summary helper?)" "0"
    fail=$((fail+1))
    return
  fi

  local tail
  tail=$(awk -v h="$HEADER" 'index($0,h){found=1} found' "$log")

  # Find every "exit <N> — ...:" header line and confirm a valid body
  # line follows each one. Require at least one such bucket.
  local bucket_lines
  bucket_lines=$(grep -nE '^exit [0-9]+ — .+:$' <<<"$tail" || true)
  if [ -z "$bucket_lines" ]; then
    echo "✗ [$n] no \"exit <N> — <label>:\" bucket headers found under \"$HEADER\""
    echo "  HINT: call summary_print <code>... with the codes your suite exercises."
    record_failure "$rel" "$log" "no \"exit <N> — <label>:\" bucket headers found under \"$HEADER\"" "0"
    fail=$((fail+1))
    return
  fi

  local bucket_count=0 last_lineno=0 lineno label body
  # Track the codes seen and the body classification per code so we can
  # assert canonical 0/1/2 coverage AND placeholder-shape correctness
  # after the loop.
  declare -A SEEN_CODES=()      # code -> 1
  declare -A CODE_KIND=()       # code -> "records" | "placeholder" | "mixed"
  declare -A CODE_LINENO=()     # code -> header line number (for ordering)
  local SEEN_ORDER=()           # codes in the order they were emitted
  while IFS=: read -r lineno label; do
    if [ "$lineno" -le "$last_lineno" ]; then
      echo "✗ [$n] bucket headers out of order at line $lineno (\"$label\")"
      record_failure "$rel" "$log" "bucket headers out of order at line $lineno (\"$label\")" "0"
      fail=$((fail+1))
      return
    fi
    # Extract numeric code from header line "exit <N> — <label>:".
    local code
    code=$(sed -E 's/^exit ([0-9]+) .*/\1/' <<<"$label")
    SEEN_CODES[$code]=1
    CODE_LINENO[$code]="$lineno"
    SEEN_ORDER+=("$code")


    body=$(awk -v p="$lineno" 'NR==p+1' <<<"$tail")
    if ! grep -qE '^(  ✓|  ✗|  \(no scenarios exercised this code\))' <<<"$body"; then
      echo "✗ [$n] bucket body missing/malformed under \"$label\" (got: \"$body\")"
      record_failure "$rel" "$log" "bucket body missing/malformed under \"$label\"" "0"
      fail=$((fail+1))
      return
    fi

    # Gather every body line up to (but not including) the next bucket
    # header / trailing blank line, so we can verify placeholder shape:
    # a placeholder bucket MUST contain exactly the placeholder line and
    # nothing else (no smuggled ✓/✗ rows), and a non-placeholder bucket
    # MUST contain only ✓/✗ rows (no stray placeholder).
    local body_block has_record=0 has_placeholder=0 stray=0
    body_block=$(awk -v p="$lineno" '
      NR<=p {next}
      /^exit [0-9]+ — .+:$/ {exit}     # next bucket header → stop
      /^$/ {exit}                       # blank line closes the summary block
      {print}
    ' <<<"$tail")

    while IFS= read -r bline; do
      [ -z "$bline" ] && continue
      case "$bline" in
        "  ✓ "*|"  ✗ "*)                              has_record=1 ;;
        "  (no scenarios exercised this code)")       has_placeholder=1 ;;
        *)                                            stray=1 ;;
      esac
    done <<<"$body_block"
    if [ "$stray" = 1 ]; then
      echo "✗ [$n] bucket for exit $code has unrecognised body line(s) under \"$label\""
      record_failure "$rel" "$log" "bucket for exit $code has unrecognised body line(s) under \"$label\"" "0"
      fail=$((fail+1))
      return
    fi
    if [ "$has_placeholder" = 1 ] && [ "$has_record" = 1 ]; then
      CODE_KIND[$code]="mixed"
      echo "✗ [$n] bucket for exit $code mixes placeholder + ✓/✗ rows (use one or the other)"
      record_failure "$rel" "$log" "bucket for exit $code mixes placeholder + ✓/✗ rows under \"$label\"" "0"
      fail=$((fail+1))
      return
    elif [ "$has_placeholder" = 1 ]; then
      CODE_KIND[$code]="placeholder"
    else
      CODE_KIND[$code]="records"
    fi

    last_lineno="$lineno"
    bucket_count=$((bucket_count+1))
  done <<<"$bucket_lines"

  # Canonical-coverage assertion: every auto-discovered suite MUST emit
  # buckets for exit codes 0, 1, AND 2 (in ascending order). Codes that
  # the suite did not exercise must appear as the documented placeholder
  # bucket — never be silently dropped — so reviewers grepping the CI log
  # can tell "this suite ran zero drift scenarios" apart from "this suite
  # forgot to wire in the helper".
  #
  # On failure we also print a minimal expected-vs-actual diff so the CI
  # log answers "what was emitted, what was missing, and where did the
  # order break" without forcing reviewers to re-read the raw suite log.
  local actual_list="${SEEN_ORDER[*]:-}"   # space-separated, emission order
  local expected_list="0 1 2"
  local req prev_lineno=0
  for req in 0 1 2; do
    if [ -z "${SEEN_CODES[$req]:-}" ]; then
      local missing=""
      for r in 0 1 2; do
        [ -z "${SEEN_CODES[$r]:-}" ] && missing+="${missing:+ }$r"
      done
      echo "✗ [$n] missing canonical bucket for exit $req under \"$HEADER\""
      echo "    expected buckets: [${expected_list// /, }]"
      echo "    actual buckets:   [${actual_list// /, }]"
      echo "    missing:          [${missing// /, }]"
      echo "  HINT: call \`summary_print 0 1 2\` even when some codes are unused —"
      echo "        the helper renders \"  (no scenarios exercised this code)\" for empties."
      record_failure "$rel" "$log" "missing canonical bucket for exit $req (auto-discovery requires 0/1/2 coverage)" "0"
      fail=$((fail+1))
      return
    fi
    if [ "${CODE_LINENO[$req]}" -le "$prev_lineno" ]; then
      echo "✗ [$n] canonical buckets 0/1/2 not in ascending order (exit $req appeared too early)"
      echo "    expected order: [${expected_list// /, }]"
      echo "    actual order:   [${actual_list// /, }]"
      echo "    first break:    exit $req at line ${CODE_LINENO[$req]} ≤ previous header at line $prev_lineno"
      record_failure "$rel" "$log" "canonical buckets 0/1/2 out of order (exit $req at line ${CODE_LINENO[$req]} ≤ previous $prev_lineno)" "0"
      fail=$((fail+1))
      return
    fi
    prev_lineno="${CODE_LINENO[$req]}"
  done


  # Per-bucket classification summary for the CI log — makes "which
  # canonical codes were exercised vs placeholdered" answerable at a glance.
  local kinds=""
  for req in 0 1 2; do
    kinds+=" $req=${CODE_KIND[$req]}"
  done
  echo "✓ [$n] $rel — header + $bucket_count bucket(s) (canonical:${kinds}), all bodies well-formed"
}



# Layer 1: pinned per-label assertions.
#
# `SUMMARY_FORMAT_SKIP_PINNED=1` skips this layer entirely. The fail-artifact
# regression test under _lib/summary-format.fail-artifact.sh sets it so its
# fixture tree does not need to ship a working copy of every real suite — only
# the auto-discovery layer (and the FAIL_DIR / FAILURES.md / index.html
# plumbing) is exercised against an intentionally-broken stub. Production CI
# leaves it unset so both layers always run.
if [ "${SUMMARY_FORMAT_SKIP_PINNED:-0}" != "1" ]; then
  for entry in "${SUITES[@]}"; do
    check_suite "$entry"
  done
else
  echo "── Layer 1 skipped (SUMMARY_FORMAT_SKIP_PINNED=1) ──"
fi
# Layer 2: auto-discover any other *.sh in scripts/audit/tests/ and run
# the generic shape check. This is the safety net: a newly-added suite
# that forgets the exit-summary block will fail CI without anyone needing
# to remember to update this file.
#
# Suite selection is delegated to the shared discover_suites helper so the
# rules ("which files count as a suite?") cannot drift between this guard
# and any other tool that walks scripts/audit/tests/. We additionally skip
# anything already pinned by Layer 1 plus any entries the maintainer added
# to EXEMPT above.
declare -A PINNED=()
for entry in "${SUITES[@]}"; do
  PINNED["${entry%%;*}"]=1
done

discovered=0
while IFS= read -r rel; do
  [ -n "${PINNED[$rel]:-}" ] && continue
  check_suite_generic "$rel"
  discovered=$((discovered+1))
done < <(discover_suites "${EXEMPT[@]}")

echo
echo "── auto-discovery: $discovered new suite(s) found beyond the ${#SUITES[@]} pinned + ${#EXEMPT[@]} exempt ──"



echo
if [ "$fail" -gt 0 ]; then
  echo "✗ $fail/$n audit suites failed the summary-format contract."
  if [ "$SUMMARY_FAILURE_ARTIFACT" = "1" ]; then
    # Finalize the HTML index (wraps accumulated <section> rows in a full
    # <html>...</html> shell). Only meaningful when ≥1 failure was recorded.
    _html_finalize
    echo "  Captured failing output: $FAIL_DIR"
    echo "  - FAILURES.md          — markdown index of every failure"
    echo "  - index.html           — browser-renderable index (actions/upload-artifact preview)"
    echo "  - <suite-basename>.log — full stdout+stderr per failing suite"
    echo "  CI uploads this directory as the 'summary-format-failures' artifact."
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
      echo "fail_dir=$FAIL_DIR" >>"$GITHUB_OUTPUT"
    fi
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ] && [ -f "$FAIL_INDEX" ]; then
      cat "$FAIL_INDEX" >>"$GITHUB_STEP_SUMMARY"
    fi
  else
    echo "  (SUMMARY_FAILURE_ARTIFACT=0 — failure artifact writes + upload disabled)"
  fi
  exit 1
fi
# FAIL_DIR cleanup on the green path is handled by the EXIT trap (_cleanup).
echo "✓ All $n audit suites emit the expected Exit-code summary."



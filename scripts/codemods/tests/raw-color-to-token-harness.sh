#!/usr/bin/env bash
# Test harness for scripts/codemods/raw-color-to-token.mjs.
#
# Runs the REAL codemod against a synthetic tree in a temp CWD so we prove:
#
#   1. --write actually rewrites raw utilities to the mapped semantic token,
#      and the run reports the edit in its human summary.
#   2. Default (no --write) is dry-run — files are NOT mutated on disk even
#      though the diff is printed, and the summary says "(dry-run)".
#   3. Line-level `// allow-raw-color: <reason>` skips that line's rewrite
#      (same-line AND preceding-line JSX-comment forms).
#   4. File-level `/* allow-raw-color-file: <reason> */` skips the file.
#   5. Config `excludePaths` skips the file by default, and --allow-excluded
#      opts back in to rewrite it.
#   6. --json <path> emits a valid, schema-versioned report with the
#      expected file/token/unfixable counts.
#
# Uses a temp dir as CWD — the codemod resolves paths against process.cwd(),
# so the real repo tree is never touched.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/codemods/raw-color-to-token.mjs"

if [ ! -f "$SCRIPT" ]; then
  echo "✖ codemod script not found at $SCRIPT" >&2
  exit 2
fi

TMP="$(mktemp -d -t raw-color-codemod.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

pass_count=0
fail_count=0
failures=()

record_pass() { pass_count=$((pass_count + 1)); echo "  ✓ $1"; }
record_fail() {
  fail_count=$((fail_count + 1))
  failures+=("$1")
  echo "  ✗ $1" >&2
}

assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    record_pass "$label"
  else
    record_fail "$label — MISSING: $needle"
    printf '    haystack (truncated):\n%s\n' "$haystack" | head -30 >&2
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" label="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    record_fail "$label — unexpectedly present: $needle"
  else
    record_pass "$label"
  fi
}

assert_eq() {
  local actual="$1" expected="$2" label="$3"
  if [ "$actual" = "$expected" ]; then
    record_pass "$label"
  else
    record_fail "$label — expected [$expected], got [$actual]"
  fi
}

# ---------------- fixture config ----------------
# Custom autofix map + excludePaths that mirror the real config's shape but
# are self-contained so the tests aren't coupled to production mappings.
mkdir -p "$TMP/config"
cat > "$TMP/config/color-audit.config.mjs" <<'EOF'
export const excludePaths = [
  {
    pattern: /^src\/pages\/Excluded\.tsx$/,
    category: "Print / letterhead",
    reason: "excluded fixture — raw color intentional",
  },
];
export const allowlist = [];
export const autofix = [
  { from: "bg-white", to: "bg-background", reason: "app surface" },
  { from: "text-white", to: "text-primary-foreground", reason: "on-primary text" },
  { from: "bg-black", to: "bg-foreground", reason: "inverse surface" },
];
EOF
CFG="config/color-audit.config.mjs"

# ---------------- fixtures ----------------
mkdir -p "$TMP/src/pages" "$TMP/src/routes/_authenticated"

# 1. Plain rewrite target — must become bg-background after --write.
cat > "$TMP/src/pages/Rewrite.tsx" <<'EOF'
export default function Rewrite() {
  return <div className="bg-white text-white" />;
}
EOF

# 2. Line-level allow marker — same-line comment silences that line, but the
#    unmarked line on top must still be rewritten.
cat > "$TMP/src/pages/LineAllow.tsx" <<'EOF'
export default function LineAllow() {
  return (
    <div>
      <span className="bg-white" />
      <span className="bg-black" /> {/* allow-raw-color: sentinel debug swatch */}
      {/* allow-raw-color: brand override */}
      <span className="text-white" />
    </div>
  );
}
EOF

# 3. File-level allow marker — every mapping in this file must be ignored.
cat > "$TMP/src/pages/FileAllow.tsx" <<'EOF'
/* allow-raw-color-file: legacy surface pending token migration */
export default function FileAllow() {
  return <div className="bg-white text-white bg-black" />;
}
EOF

# 4. Config-excluded file — default run must NOT rewrite; --allow-excluded MUST.
cat > "$TMP/src/pages/Excluded.tsx" <<'EOF'
export default function Excluded() {
  return <div className="bg-white" />;
}
EOF

# 5. Unfixable violation fixture — a palette utility with no autofix mapping
#    exercises the R3 rule reporting path in the JSON report.
cat > "$TMP/src/routes/_authenticated/unfixable.tsx" <<'EOF'
export default function Unfixable() {
  return <div className="bg-slate-900 text-slate-100" />;
}
EOF

# All --path fixtures live under src/ — pass the whole subtree so the
# codemod's include filter is disabled (--path implies "trust me") and every
# fixture above is considered.
PATHS=(--path src/pages --path src/routes/_authenticated)

run_codemod() {
  # Runs the codemod in $TMP as CWD, capturing stdout+stderr and exit code.
  # Trailing args are forwarded verbatim.
  local out
  set +e
  out="$(cd "$TMP" && node "$SCRIPT" --config "$CFG" "${PATHS[@]}" "$@" 2>&1)"
  local rc=$?
  set -e
  LAST_RC=$rc
  LAST_OUT=$out
}

# ---------------- 1. Dry-run leaves files untouched ----------------
echo ""
echo "▶ dry-run leaves files untouched but reports the diff"
BEFORE_REWRITE="$(cat "$TMP/src/pages/Rewrite.tsx")"
run_codemod
assert_eq "$LAST_RC" "0" "dry-run exits 0"
assert_contains "$LAST_OUT" "[DRY-RUN]" "banner announces dry-run mode"
assert_contains "$LAST_OUT" "(dry-run — re-run with --write to apply)" "dry-run footer present"
assert_contains "$LAST_OUT" "bg-white" "diff shows original token"
assert_contains "$LAST_OUT" "bg-background" "diff shows replacement token"
AFTER_REWRITE="$(cat "$TMP/src/pages/Rewrite.tsx")"
assert_eq "$AFTER_REWRITE" "$BEFORE_REWRITE" "dry-run did NOT mutate Rewrite.tsx"

# ---------------- 2. --write mutates files with mapped rewrites ----------------
echo ""
echo "▶ --write rewrites raw utilities to semantic tokens"
run_codemod --write
assert_eq "$LAST_RC" "0" "--write exits 0"
assert_contains "$LAST_OUT" "[WRITE]" "banner announces write mode"
assert_contains "$LAST_OUT" "✓ wrote" "write footer present"
REWRITTEN="$(cat "$TMP/src/pages/Rewrite.tsx")"
assert_contains "$REWRITTEN" "bg-background" "Rewrite.tsx now uses bg-background"
assert_contains "$REWRITTEN" "text-primary-foreground" "Rewrite.tsx now uses text-primary-foreground"
assert_not_contains "$REWRITTEN" "bg-white" "Rewrite.tsx no longer contains bg-white"

# ---------------- 3. Line-level allow markers ----------------
echo ""
echo "▶ line-level allow markers preserve raw utilities on marked lines"
LINE_ALLOW_RESULT="$(cat "$TMP/src/pages/LineAllow.tsx")"
# The unmarked <span className="bg-white" /> at the top must have been rewritten
# to bg-background by the --write pass above.
assert_contains "$LINE_ALLOW_RESULT" 'className="bg-background"' "unmarked line rewritten"
# The same-line comment protects bg-black (must remain literal).
assert_contains "$LINE_ALLOW_RESULT" 'className="bg-black"' "same-line marker preserved bg-black"
# The preceding-line JSX comment protects the following text-white.
assert_contains "$LINE_ALLOW_RESULT" 'className="text-white"' "preceding-line marker preserved text-white"

# ---------------- 4. File-level allow marker ----------------
echo ""
echo "▶ file-level allow marker skips the entire file"
FILE_ALLOW_RESULT="$(cat "$TMP/src/pages/FileAllow.tsx")"
assert_contains "$FILE_ALLOW_RESULT" "bg-white text-white bg-black" "FileAllow.tsx untouched"

# ---------------- 5. Config excludePaths ----------------
echo ""
echo "▶ excludePaths skips the file by default"
EXCLUDED_RESULT="$(cat "$TMP/src/pages/Excluded.tsx")"
assert_contains "$EXCLUDED_RESULT" 'className="bg-white"' "Excluded.tsx untouched by default"

echo ""
echo "▶ --allow-excluded opts config-excluded files back in"
run_codemod --write --allow-excluded
assert_eq "$LAST_RC" "0" "--allow-excluded --write exits 0"
EXCLUDED_AFTER="$(cat "$TMP/src/pages/Excluded.tsx")"
assert_contains "$EXCLUDED_AFTER" 'className="bg-background"' "Excluded.tsx rewritten with --allow-excluded"

# ---------------- 6. JSON report ----------------
echo ""
echo "▶ --json <path> emits a parseable, schema-versioned report"
# Reset the rewrite fixture so this pass sees fresh edits to report on.
cat > "$TMP/src/pages/Rewrite.tsx" <<'EOF'
export default function Rewrite() {
  return <div className="bg-white text-white" />;
}
EOF
cat > "$TMP/src/pages/Excluded.tsx" <<'EOF'
export default function Excluded() {
  return <div className="bg-white" />;
}
EOF
REPORT="$TMP/report.json"
run_codemod --json "$REPORT"
assert_eq "$LAST_RC" "0" "--json <path> exits 0"
if [ ! -f "$REPORT" ]; then
  record_fail "JSON report file was not created at $REPORT"
else
  record_pass "JSON report file created"
  # Parse with node so any malformed JSON fails loudly with a real error.
  SUMMARY="$(node -e "
    const r = require('$REPORT');
    if (r.schemaVersion !== 1) { console.error('bad schemaVersion:', r.schemaVersion); process.exit(2); }
    const rewrite = r.filesChanged.find(f => f.file === 'src/pages/Rewrite.tsx');
    const excluded = r.filesChanged.find(f => f.file === 'src/pages/Excluded.tsx');
    const fileAllow = r.filesChanged.find(f => f.file === 'src/pages/FileAllow.tsx');
    const unfixable = r.unfixableViolations.filter(v => v.file === 'src/routes/_authenticated/unfixable.tsx');
    console.log(JSON.stringify({
      mode: r.mode,
      applied: r.applied,
      totalRewrites: r.summary.totalRewrites,
      unfixableCount: r.summary.unfixableViolations,
      rewriteFilePresent: !!rewrite,
      rewriteEditCount: rewrite ? rewrite.editCount : 0,
      excludedFilePresent: !!excluded,
      fileAllowPresent: !!fileAllow,
      tokenPairs: r.tokenRewrites.map(t => t.from + '->' + t.to).sort(),
      unfixableRules: [...new Set(unfixable.map(u => u.rule))].sort(),
      unfixableTokens: [...new Set(unfixable.map(u => u.token))].sort(),
    }));
  ")"
  # ↓ extract each field with node (safer than shell parsing) and assert.
  eval "$(node -e "
    const s = $SUMMARY;
    for (const [k, v] of Object.entries(s)) {
      const val = Array.isArray(v) ? v.join(',') : String(v);
      console.log('R_' + k + '=' + JSON.stringify(val));
    }
  ")"
  assert_eq "$R_mode" "dry-run" "report.mode == dry-run"
  assert_eq "$R_applied" "false" "report.applied == false in dry-run"
  assert_eq "$R_rewriteFilePresent" "true" "Rewrite.tsx listed in filesChanged"
  assert_eq "$R_rewriteEditCount" "2" "Rewrite.tsx has 2 edits (bg-white + text-white)"
  assert_eq "$R_excludedFilePresent" "false" "Excluded.tsx NOT in filesChanged (skipped by config)"
  assert_eq "$R_fileAllowPresent" "false" "FileAllow.tsx NOT in filesChanged (file-level allow)"
  assert_contains "$R_tokenPairs" "bg-white->bg-background" "tokenRewrites include bg-white→bg-background"
  assert_contains "$R_tokenPairs" "text-white->text-primary-foreground" "tokenRewrites include text-white→text-primary-foreground"
  assert_contains "$R_unfixableRules" "R3" "unfixable.tsx contributes R3 palette violation"
  assert_contains "$R_unfixableTokens" "bg-slate-900" "unfixable palette token captured"
fi

# ---------------- 7. --json - streams to stdout with no human summary ----------------
echo ""
echo "▶ --json - streams JSON to stdout only"
run_codemod --json -
assert_eq "$LAST_RC" "0" "--json - exits 0"
# Human banner strings must NOT leak into the stdout stream.
assert_not_contains "$LAST_OUT" "[DRY-RUN]" "no human banner on stdout"
assert_not_contains "$LAST_OUT" "considered " "no human summary line on stdout"
# The output must parse as JSON with the expected top-level shape.
STDOUT_SCHEMA="$(node -e "
  const r = JSON.parse(process.argv[1]);
  console.log(r.schemaVersion + '|' + r.tool);
" -- "$LAST_OUT")"
assert_eq "$STDOUT_SCHEMA" "1|raw-color-to-token" "stdout JSON has schemaVersion=1 and correct tool"

# ---------------- summary ----------------
echo ""
echo "──────── raw-color-to-token codemod harness ────────"
echo "  passed: $pass_count"
echo "  failed: $fail_count"
if [ "$fail_count" -ne 0 ]; then
  echo ""
  echo "  FAILURES:"
  for f in "${failures[@]}"; do echo "    · $f"; done
  exit 1
fi
echo "  ✓ all scenarios passed"

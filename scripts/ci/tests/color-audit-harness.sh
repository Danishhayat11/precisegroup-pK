#!/usr/bin/env bash
# CI test harness for scripts/ci/no-hex-in-marketing-shell.mjs (the color
# guardrail). Runs the REAL script against a synthetic src/ tree so we prove:
#
#   1. Clean authenticated routes using semantic tokens PASS (exit 0).
#   2. Authenticated routes with raw hex / palette / bw utilities FAIL
#      (exit 1) AND the failure names the exact rule + offending token +
#      file:line:column.
#   3. Intended exceptions stay allowed:
#      a. file-level `/* allow-raw-color-file: <reason> */` silences the
#         whole file and echoes the reason in diagnostics.
#      b. line-level `// allow-raw-color: <reason>` (and preceding-line
#         JSX comment form) silences that line and echoes the reason.
#      c. path-based exceptions (print/, letterhead, error surfaces,
#         DashboardHero, tests) are never scanned.
#
# Uses a temp dir as CWD — the guardrail walks `process.cwd()/src`, so the
# real repo tree is never touched.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/no-hex-in-marketing-shell.mjs"

if [ ! -f "$SCRIPT" ]; then
  echo "✖ guardrail script not found at $SCRIPT" >&2
  exit 2
fi

TMP="$(mktemp -d -t color-audit-harness.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

ARTIFACT_DIR="${CI_ARTIFACT_DIR:-$REPO_ROOT/ci-artifacts}"
mkdir -p "$ARTIFACT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

pass_count=0
fail_count=0
failures=()

# ---------------- fixtures ----------------
mkdir -p \
  "$TMP/src/routes/_authenticated" \
  "$TMP/src/components/print" \
  "$TMP/src/components" \
  "$TMP/src/pages"

# 1. Clean authenticated route — semantic tokens only. Must PASS.
cat > "$TMP/src/routes/_authenticated/clean.tsx" <<'EOF'
export default function CleanRoute() {
  return (
    <div className="bg-background text-foreground border border-border">
      <span className="text-muted-foreground">All semantic tokens.</span>
    </div>
  );
}
EOF

# 2. Dirty authenticated route — every rule class represented. Must FAIL.
#    Kept in a SEPARATE tree ($DIRTY) so scenario 1 above can pass cleanly.

# 3. File-level exception — reason MUST appear in diagnostics.
cat > "$TMP/src/routes/_authenticated/legacy-dashboard.tsx" <<'EOF'
/* allow-raw-color-file: legacy dashboard pending status-token migration */
export default function LegacyDashboard() {
  // Raw hex + palette utilities silenced by the file-level marker above.
  return <div className="bg-slate-900 text-white" style={{ borderColor: "#0F172A" }} />;
}
EOF

# 4. Line-level exceptions — one same-line, one preceding-line JSX comment.
cat > "$TMP/src/routes/_authenticated/loader.tsx" <<'EOF'
export default function Loader() {
  return (
    <svg>
      <stop stopColor="#00E5FF" /> {/* allow-raw-color: brand neon-cyan gradient stop */}
      {/* allow-raw-color: brand soft-violet gradient stop */}
      <stop stopColor="#7A5CFF" />
    </svg>
  );
}
EOF

# 5. Path-based exception — print/ is never scanned even with raw hex.
cat > "$TMP/src/components/print/Receipt.tsx" <<'EOF'
export function Receipt() {
  // Print stylesheet colors — intentionally raw, path is excluded.
  return <div style={{ color: "#000000", background: "#FFFFFF" }} className="bg-white" />;
}
EOF

# 6. Path-based exception — DashboardHero is excluded by name.
cat > "$TMP/src/components/DashboardHero.tsx" <<'EOF'
export function DashboardHero() {
  return <div className="bg-slate-950 text-white" />;
}
EOF

# 7. One benign violation ensures the guardrail prints its full diagnostics
#    block (including the "Active exceptions applied" section) so we can
#    assert that fixtures 3, 4 keep their reasons echoed. Without a trigger
#    the guardrail exits 0 and prints only a one-line summary.
cat > "$TMP/src/routes/_authenticated/trigger.tsx" <<'EOF'
export default function Trigger() {
  return <div className="bg-white" />;
}
EOF

# ---------------- assertion helpers ----------------

record_pass() { pass_count=$((pass_count + 1)); echo "  ✓ $1"; }
record_fail() {
  fail_count=$((fail_count + 1))
  failures+=("$1")
  echo "  ✗ $1" >&2
}

assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    record_pass "$label — found: $needle"
  else
    record_fail "$label — MISSING: $needle"
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" label="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    record_fail "$label — unexpectedly present: $needle"
  else
    record_pass "$label — absent as expected: $needle"
  fi
}

capture() {
  # capture <label> <cwd> [<config-path>] [<script-arg>...]
  #   Writes stdout+stderr to $ARTIFACT_DIR and echoes on stdout.
  #   The guardrail loads its config from COLOR_AUDIT_CONFIG when set —
  #   default here is the real repo config so existing exclusions apply.
  #   Extra positional args after the config are forwarded to the script
  #   (e.g. `--dry-run`, `--fix`).
  local label="$1" cwd="$2" cfg="${3:-$REPO_ROOT/scripts/ci/color-audit.config.mjs}"
  shift 3 || true
  local out_file="$ARTIFACT_DIR/color-audit-harness.${label}.${STAMP}.log"
  set +e
  ( cd "$cwd" && COLOR_AUDIT_CONFIG="$cfg" node "$SCRIPT" "$@" ) >"$out_file" 2>&1
  local status=$?
  set -e
  echo "$out_file" > "$TMP/last_out_file"
  echo "$status" > "$TMP/last_status"
  cat "$out_file"
}

# ============================================================
# Scenario A — tree with intended exceptions + one trigger violation.
# Verifies that even when the guardrail fails, path-based exclusions stay
# excluded and file/line-level exception REASONS are echoed for audit.
# ============================================================
echo ""
echo "── Scenario A: intended exceptions survive a real failure ──"
CLEAN_OUT="$(capture "scenario-a-clean" "$TMP")"
CLEAN_STATUS="$(cat "$TMP/last_status")"

if [ "$CLEAN_STATUS" -ne 1 ]; then
  record_fail "Scenario A expected exit 1 (trigger fixture), got $CLEAN_STATUS"
else
  record_pass "Scenario A exited 1 as expected"
fi

# The trigger violation is the ONLY offender — assert exactly that file/rule.
assert_contains "$CLEAN_OUT" "src/routes/_authenticated/trigger.tsx:" \
  "A0: only the trigger fixture is reported"

# Exception fixtures must NOT appear as violations.
assert_not_contains "$CLEAN_OUT" \
  "src/routes/_authenticated/legacy-dashboard.tsx:2" \
  "A1a: file-level fixture not treated as violation"
assert_not_contains "$CLEAN_OUT" "offender=#00E5FF" \
  "A1b: line-level fixture hex not flagged as violation"

# File-level exception acknowledged with its reason
assert_contains "$CLEAN_OUT" \
  "src/routes/_authenticated/legacy-dashboard.tsx  reason: legacy dashboard pending status-token migration" \
  "A2: file-level exception reason echoed"

# Line-level exceptions acknowledged with their reasons
assert_contains "$CLEAN_OUT" \
  "reason: brand neon-cyan gradient stop" \
  "A3: same-line exception reason echoed"
assert_contains "$CLEAN_OUT" \
  "reason: brand soft-violet gradient stop" \
  "A4: preceding-line exception reason echoed"

# Path-based exclusions must not appear as violations or as exceptions
assert_not_contains "$CLEAN_OUT" "components/print/Receipt.tsx" \
  "A5: print/ path never scanned"
assert_not_contains "$CLEAN_OUT" "DashboardHero.tsx" \
  "A6: DashboardHero.tsx never scanned"

# ============================================================
# Scenario B — DIRTY tree. Expect exit 1 with rich diagnostics.
# ============================================================
DIRTY="$(mktemp -d -t color-audit-dirty.XXXXXX)"
trap 'rm -rf "$TMP" "$DIRTY"' EXIT
mkdir -p "$DIRTY/src/routes/_authenticated"

cat > "$DIRTY/src/routes/_authenticated/drift.tsx" <<'EOF'
export default function Drift() {
  // Each rule (R1-R4) triggered exactly once so summary counts are predictable.
  return (
    <div className="bg-white text-slate-500 bg-[#0F172A]" style={{ color: "#abcdef" }} />
  );
}
EOF

echo ""
echo "── Scenario B: authenticated route with drift ──"
DIRTY_OUT="$(capture "scenario-b-dirty" "$DIRTY")"
DIRTY_STATUS="$(cat "$TMP/last_status")"

if [ "$DIRTY_STATUS" -ne 1 ]; then
  record_fail "Scenario B expected exit 1, got $DIRTY_STATUS"
else
  record_pass "Scenario B exited 1"
fi

# Header + per-rule summary
assert_contains "$DIRTY_OUT" "Guardrail failed" "B1: failure banner"
assert_contains "$DIRTY_OUT" "[R1 arbitrary-hex utility]" "B2: R1 rule summary"
assert_contains "$DIRTY_OUT" "[R2 bare hex literal]"       "B3: R2 rule summary"
assert_contains "$DIRTY_OUT" "[R3 non-semantic palette utility]" "B4: R3 rule summary"
assert_contains "$DIRTY_OUT" "[R4 raw black/white utility]"      "B5: R4 rule summary"

# Exact offender tokens named
assert_contains "$DIRTY_OUT" "bg-[#0F172A]"     "B6: R1 offender token"
assert_contains "$DIRTY_OUT" "#abcdef"          "B7: R2 offender token"
assert_contains "$DIRTY_OUT" "text-slate-500"   "B8: R3 offender token"
assert_contains "$DIRTY_OUT" "bg-white"         "B9: R4 offender token"

# File:line:column + caret-underlined context line
assert_contains "$DIRTY_OUT" "src/routes/_authenticated/drift.tsx:" \
  "B10: file:line:column reported"
assert_contains "$DIRTY_OUT" "^^^^^^^" \
  "B11: caret underline rendered"

# Fix guidance printed for at least one rule
assert_contains "$DIRTY_OUT" "fix:" "B12: per-rule fix guidance printed"

# ============================================================
# Scenario C — CLEAN authenticated route in isolation.
# ============================================================
CLEAN_ONLY="$(mktemp -d -t color-audit-clean-only.XXXXXX)"
trap 'rm -rf "$TMP" "$DIRTY" "$CLEAN_ONLY"' EXIT
mkdir -p "$CLEAN_ONLY/src/routes/_authenticated"
cat > "$CLEAN_ONLY/src/routes/_authenticated/index.tsx" <<'EOF'
export default function Home() {
  return <main className="bg-card text-foreground border-border" />;
}
EOF

echo ""
echo "── Scenario C: single clean authenticated route ──"
CO_OUT="$(capture "scenario-c-clean-only" "$CLEAN_ONLY")"
CO_STATUS="$(cat "$TMP/last_status")"

if [ "$CO_STATUS" -ne 0 ]; then
  record_fail "Scenario C expected exit 0, got $CO_STATUS"
else
  record_pass "Scenario C exited 0"
fi
assert_contains "$CO_OUT" "✓ no hard-coded colors" "C1: success banner"

# ============================================================
# Scenario D — CENTRALIZED CONFIG allowlist.
#
# Proves adding a new exception no longer requires editing the guardrail
# script: a synthetic config file grants exclude/allowlist entries for
# fixture routes, and the script honors them + echoes their config-supplied
# reasons in diagnostics.
# ============================================================
CFG_ROOT="$(mktemp -d -t color-audit-cfg.XXXXXX)"
trap 'rm -rf "$TMP" "$DIRTY" "$CLEAN_ONLY" "$CFG_ROOT"' EXIT
mkdir -p "$CFG_ROOT/src/routes/_authenticated" "$CFG_ROOT/scripts"

# Route A: raw hex silenced ONLY by config allowlist (rule-scoped R2).
#   Also carries an R4 (bg-white) violation the allowlist does NOT cover,
#   proving rule-scoped silencing doesn't blanket the file.
cat > "$CFG_ROOT/src/routes/_authenticated/brand-loader.tsx" <<'EOF'
export default function BrandLoader() {
  return (
    <>
      <svg><stop stopColor="#00E5FF" /></svg>
      <div className="bg-white" />
    </>
  );
}
EOF

# Route B: fully silenced by config allowlist (rules: "*").
cat > "$CFG_ROOT/src/routes/_authenticated/legacy-config.tsx" <<'EOF'
export default function LegacyConfig() {
  return <div className="bg-slate-900 text-white" style={{ color: "#0F172A" }} />;
}
EOF

# Route C: excluded entirely via config excludePaths.
cat > "$CFG_ROOT/src/routes/_authenticated/print-shim.tsx" <<'EOF'
export default function PrintShim() {
  return <div className="bg-white" style={{ color: "#000000" }} />;
}
EOF

# Synthetic config file — the whole point of Scenario D. No script edit
# required to onboard these three fixtures.
cat > "$CFG_ROOT/scripts/color-audit.config.mjs" <<'EOF'
export const excludePaths = [
  {
    pattern: /^src\/routes\/_authenticated\/print-shim\.tsx$/,
    category: "Print / letterhead",
    reason: "print shim renders into the PDF pipeline",
  },
];
export const allowlist = [
  {
    pattern: /^src\/routes\/_authenticated\/brand-loader\.tsx$/,
    rules: ["R2"],
    reason: "brand SVG gradient stops (neon-cyan)",
  },
  {
    pattern: /^src\/routes\/_authenticated\/legacy-config\.tsx$/,
    rules: "*",
    reason: "legacy admin page pending semantic-token migration",
  },
];
export default { excludePaths, allowlist };
EOF

echo ""
echo "── Scenario D: centralized config allowlist ──"
CFG_OUT="$(capture "scenario-d-config" "$CFG_ROOT" "$CFG_ROOT/scripts/color-audit.config.mjs")"
CFG_STATUS="$(cat "$TMP/last_status")"

# brand-loader still has the R4 bg-white violation → exit 1 expected.
if [ "$CFG_STATUS" -ne 1 ]; then
  record_fail "Scenario D expected exit 1 (uncovered R4), got $CFG_STATUS"
else
  record_pass "Scenario D exited 1 for the uncovered rule"
fi

# The uncovered R4 offender is reported…
assert_contains "$CFG_OUT" "brand-loader.tsx" "D1: uncovered R4 flagged"
assert_contains "$CFG_OUT" "offender=bg-white" "D2: R4 offender named"

# …but the config-silenced R2 hex on the same file is NOT flagged.
assert_not_contains "$CFG_OUT" "offender=#00E5FF" \
  "D3: config rule-scoped allowlist silences R2 hex"

# Fully allowlisted file appears as a file-level exception with its config reason.
assert_contains "$CFG_OUT" \
  "[config] src/routes/_authenticated/legacy-config.tsx  reason: legacy admin page pending semantic-token migration" \
  "D4: config rules:'*' silences whole file with reason echoed"

# Rule-scoped hit is reported in the new banner section.
assert_contains "$CFG_OUT" \
  "src/routes/_authenticated/brand-loader.tsx  rules: R2  reason: brand SVG gradient stops (neon-cyan)" \
  "D5: config rule-scoped hit echoed with rules + reason"

# excludePaths-covered route is never scanned or reported.
assert_not_contains "$CFG_OUT" "print-shim.tsx" \
  "D6: config excludePaths skips the file entirely"

# ============================================================
# Scenario E — AUTOFIX (--dry-run and --fix).
#
# Verifies:
#   E1-E3: --dry-run reports rewrites, does NOT touch files, still exits 1
#          (because unmapped hex offenders remain).
#   E4-E6: --fix rewrites mapped utilities in place, unmapped hex still
#          fails, and a rescan proves the fixed utility is now clean.
# ============================================================
FIX_ROOT="$(mktemp -d -t color-audit-fix.XXXXXX)"
trap 'rm -rf "$TMP" "$DIRTY" "$CLEAN_ONLY" "$CFG_ROOT" "$FIX_ROOT"' EXIT
mkdir -p "$FIX_ROOT/src/routes/_authenticated"

# Route mixes:
#   - bg-white          → mapped in autofix (bg-background)
#   - text-slate-500    → mapped in autofix (text-muted-foreground)
#   - border-gray-200   → mapped in autofix (border-border)
#   - #abcdef           → R2 bare hex, NO autofix mapping (must remain)
cat > "$FIX_ROOT/src/routes/_authenticated/mixed.tsx" <<'EOF'
export default function Mixed() {
  return (
    <div className="bg-white text-slate-500 border border-gray-200" style={{ color: "#abcdef" }} />
  );
}
EOF
FIXTURE="$FIX_ROOT/src/routes/_authenticated/mixed.tsx"
ORIGINAL="$(cat "$FIXTURE")"

echo ""
echo "── Scenario E: autofix (--dry-run + --fix) ──"

# --- E1..E3: dry-run preview -------------------------------------------
DRY_OUT="$(capture "scenario-e-dryrun" "$FIX_ROOT" "" "--dry-run")"
DRY_STATUS="$(cat "$TMP/last_status")"

if [ "$DRY_STATUS" -ne 1 ]; then
  record_fail "Scenario E dry-run expected exit 1 (unmapped hex), got $DRY_STATUS"
else
  record_pass "Scenario E dry-run exited 1 (unmapped hex left over)"
fi
assert_contains "$DRY_OUT" "Would apply 3 autofix rewrite(s) (--dry-run: no files written)" \
  "E1: dry-run reports 3 previewed rewrites"
assert_contains "$DRY_OUT" "bg-white  →  bg-background" \
  "E2: dry-run previews bg-white mapping"

DRY_FIXTURE="$(cat "$FIXTURE")"
if [ "$DRY_FIXTURE" = "$ORIGINAL" ]; then
  record_pass "E3: dry-run left the file untouched"
else
  record_fail "E3: dry-run mutated the file — should be preview-only"
fi

# --- E4..E6: apply -----------------------------------------------------
FIX_OUT="$(capture "scenario-e-fix" "$FIX_ROOT" "" "--fix")"
FIX_STATUS="$(cat "$TMP/last_status")"

if [ "$FIX_STATUS" -ne 1 ]; then
  record_fail "Scenario E --fix expected exit 1 (bare hex still unfixable), got $FIX_STATUS"
else
  record_pass "Scenario E --fix exited 1 (bare hex remains after rewrites)"
fi
assert_contains "$FIX_OUT" "Applied 3 autofix rewrite(s)" \
  "E4: --fix reports 3 applied rewrites"

FIXED_FIXTURE="$(cat "$FIXTURE")"
if printf '%s' "$FIXED_FIXTURE" | grep -qF "bg-background" \
  && printf '%s' "$FIXED_FIXTURE" | grep -qF "text-muted-foreground" \
  && printf '%s' "$FIXED_FIXTURE" | grep -qF "border-border" \
  && ! printf '%s' "$FIXED_FIXTURE" | grep -qE "\bbg-white\b|\btext-slate-500\b|\bborder-gray-200\b"; then
  record_pass "E5: --fix replaced mapped utilities in place"
else
  record_fail "E5: --fix did not rewrite as expected — file: $FIXED_FIXTURE"
fi

# The unmapped bare hex must still be present in both the file AND the report.
assert_contains "$FIX_OUT" "offender=#abcdef" \
  "E6: --fix leaves unmapped R2 hex to fail the scan"



# ============================================================
# Summary
# ============================================================
echo ""
echo "──────────────────────────────────────────────"
echo "color-audit harness: $pass_count passed, $fail_count failed"
if [ "$fail_count" -ne 0 ]; then
  echo "" >&2
  echo "Failures:" >&2
  for f in "${failures[@]}"; do echo "  - $f" >&2; done
  echo "" >&2
  echo "Captured logs under: $ARTIFACT_DIR" >&2
  exit 1
fi
echo "Captured logs under: $ARTIFACT_DIR"

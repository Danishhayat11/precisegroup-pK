#!/usr/bin/env bash
# Positive control: the Supabase column validator MUST exit 0 when every
# referenced payments column is real (e.g. payments.amount, payments.receipt_no,
# payments.payment_date). This complements validator-catches-payment-id.sh —
# together they prove the validator is neither silently passing everything nor
# noisily failing on valid code.
#
# Runs the real validator against a synthetic project rooted at a temp dir
# so the real src/ tree isn't polluted. The temp project contains:
#   - a copy of the real generated types.ts (real schema)
#   - a single .ts file that ONLY references known-good payments columns,
#     via .from().select().eq() AND inside a raw SQL string literal.
#
# The test PASSES only if the validator exits 0 with an empty findings array.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
VALIDATOR="$REPO_ROOT/scripts/ci/validate-supabase-columns.mjs"
TYPES="$REPO_ROOT/src/integrations/supabase/types.ts"

if [ ! -f "$VALIDATOR" ]; then
  echo "✖ validator not found at $VALIDATOR" >&2
  exit 2
fi
if [ ! -f "$TYPES" ]; then
  echo "✖ types.ts not found at $TYPES" >&2
  exit 2
fi

TMP="$(mktemp -d -t supacol-positive.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/src/integrations/supabase"
cp "$TYPES" "$TMP/src/integrations/supabase/types.ts"

cat > "$TMP/src/__positive_payments__.ts" <<'EOF'
// Positive-control fixture. Every payments column referenced here MUST exist
// in the generated types.ts schema. If the validator flags any of these,
// either the schema regressed or the validator has a false-positive bug.
import { supabase } from "@/integrations/supabase/client";

export async function safePaymentsQuery() {
  const { data } = await supabase
    .from("payments")
    .select("receipt_no, amount, payment_date, booking_id, status")
    .eq("booking_id", "BK-MA-00001")
    .order("payment_date", { ascending: false });
  return data;
}

// Raw SQL branch — validator's raw-SQL scanner must also accept these.
export const SAFE_PAYMENTS_SQL =
  "SELECT receipt_no, amount, payment_date FROM public.payments WHERE booking_id = $1";
EOF

set +e
OUT="$(cd "$TMP" && node "$VALIDATOR" --json)"
STATUS=$?
set -e

# Capture the validator's --json output + metadata as a CI artifact on EVERY
# run (pass or fail). Uploaded by the workflow so triage always has a
# durable record of what the positive control saw — no need to re-run
# locally to diff a schema change or false-positive regression.
# Default location: <repo>/ci-artifacts/.
ARTIFACT_DIR="${CI_ARTIFACT_DIR:-$REPO_ROOT/ci-artifacts}"
mkdir -p "$ARTIFACT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
JSON_FILE="$ARTIFACT_DIR/validator-passes-safe-payments.${STAMP}.json"
META_FILE="$ARTIFACT_DIR/validator-passes-safe-payments.${STAMP}.meta.txt"
printf '%s\n' "$OUT" > "$JSON_FILE"
{
  echo "test: validator-passes-safe-payments"
  echo "validator: $VALIDATOR"
  echo "types_source: $TYPES"
  echo "tmp_project_root: $TMP"
  echo "exit_status: $STATUS"
  echo "captured_at_utc: $STAMP"
  echo "fixture_file: src/__positive_payments__.ts"
  echo "expected: zero exit with empty findings array"
} > "$META_FILE"

fail() {
  echo "$1" >&2
  echo "  → validator JSON: $JSON_FILE" >&2
  echo "  → metadata:       $META_FILE" >&2
  echo "--- validator --json output ---" >&2
  echo "$OUT" >&2
  exit 1
}

if [ "$STATUS" -ne 0 ]; then
  fail "✖ Validator exited $STATUS but was expected to PASS on safe payments columns"
fi

# Also assert the JSON explicitly reports zero findings. The validator prints
# `{"ok": true, "findings": []}` on success — accept either wording but require
# no findings-array entries.
if echo "$OUT" | grep -Eq '"findings"[[:space:]]*:[[:space:]]*\[[[:space:]]*\{'; then
  fail "✖ Validator exited 0 but reported findings on safe payments columns"
fi

echo "✓ Validator correctly passed on safe payments columns (exit=$STATUS)"
echo "  captured JSON: $JSON_FILE"
echo "  captured meta: $META_FILE"


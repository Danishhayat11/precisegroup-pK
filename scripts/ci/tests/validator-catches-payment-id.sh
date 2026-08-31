#!/usr/bin/env bash
# Regression: the Supabase column validator MUST fail the build when any
# source file references `payments.payment_id`. This is the exact class of
# bug that shipped once — "column payments.payment_id does not exist" —
# and the validator's job is to catch it in CI.
#
# Runs the real validator against a synthetic project rooted at a temp dir
# so the real src/ tree isn't polluted. The temp project contains:
#   - a copy of the real generated types.ts (real schema)
#   - a single .ts file that intentionally does .from("payments").select("payment_id, amount")
#
# The test PASSES only if the validator exits non-zero AND its JSON output
# lists a finding with table=payments, column=payment_id.

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

TMP="$(mktemp -d -t supacol-regression.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/src/integrations/supabase"
cp "$TYPES" "$TMP/src/integrations/supabase/types.ts"

cat > "$TMP/src/__regression_payment_id__.ts" <<'EOF'
// Intentional regression fixture. Must trigger the validator.
import { supabase } from "@/integrations/supabase/client";
export async function stalePaymentIdRef() {
  const { data } = await supabase
    .from("payments")
    .select("payment_id, amount")
    .eq("payment_id", "x");
  return data;
}
EOF

set +e
OUT="$(cd "$TMP" && node "$VALIDATOR" --json)"
STATUS=$?
set -e

# Capture the validator's --json output (and finding details) as a CI artifact
# so a failed run can be inspected without re-running locally. Uploaded by the
# workflow's if:failure() step. Default location: <repo>/ci-artifacts/.
ARTIFACT_DIR="${CI_ARTIFACT_DIR:-$REPO_ROOT/ci-artifacts}"
mkdir -p "$ARTIFACT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
JSON_FILE="$ARTIFACT_DIR/validator-catches-payment-id.${STAMP}.json"
META_FILE="$ARTIFACT_DIR/validator-catches-payment-id.${STAMP}.meta.txt"
printf '%s\n' "$OUT" > "$JSON_FILE"
{
  echo "test: validator-catches-payment-id"
  echo "validator: $VALIDATOR"
  echo "types_source: $TYPES"
  echo "tmp_project_root: $TMP"
  echo "exit_status: $STATUS"
  echo "captured_at_utc: $STAMP"
  echo "fixture_file: src/__regression_payment_id__.ts"
  echo "expected: non-zero exit with payments.payment_id finding"
} > "$META_FILE"

fail() {
  echo "$1" >&2
  echo "  → validator JSON: $JSON_FILE" >&2
  echo "  → metadata:       $META_FILE" >&2
  echo "--- validator --json output ---" >&2
  echo "$OUT" >&2
  exit 1
}

if [ "$STATUS" -eq 0 ]; then
  fail "✖ Validator exited 0 but was expected to FAIL on payments.payment_id"
fi

# Confirm the finding is specifically the payments.payment_id one.
if ! echo "$OUT" | grep -q '"table": "payments"'; then
  fail "✖ Validator failed but no 'payments' table finding present"
fi
if ! echo "$OUT" | grep -q '"column": "payment_id"'; then
  fail "✖ Validator failed but no 'payment_id' column finding present"
fi

echo "✓ Validator correctly failed on payments.payment_id (exit=$STATUS)"
echo "  captured JSON: $JSON_FILE"
echo "  captured meta: $META_FILE"

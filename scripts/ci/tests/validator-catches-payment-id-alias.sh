#!/usr/bin/env bash
# Second negative regression: the Supabase column validator MUST still fail
# when `payments.payment_id` is referenced through a DIFFERENT query shape
# than the original fixture — specifically, an aliased select plus an
# `.order()` on the stale column, plus a raw SQL string that aliases it.
#
# Sibling of validator-catches-payment-id.sh. Both must stay green: this one
# proves the validator isn't matching only the exact literal from the first
# fixture but actually catches the class of bug (payments.payment_id anywhere).

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

TMP="$(mktemp -d -t supacol-regression-alias.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/src/integrations/supabase"
cp "$TYPES" "$TMP/src/integrations/supabase/types.ts"

cat > "$TMP/src/__regression_payment_id_alias__.ts" <<'EOF'
// Intentional regression fixture #2 — different shape than the first one:
//  - aliased select ("payment_id:receipt_no" is legal, but "pid:payment_id" is NOT)
//  - .order() on the stale column
//  - raw SQL that aliases payment_id in the projection
// The validator must still flag payments.payment_id in all three places.
import { supabase } from "@/integrations/supabase/client";

export async function stalePaymentIdAlias() {
  const { data } = await supabase
    .from("payments")
    .select("pid:payment_id, amount, receipt_no")
    .order("payment_id", { ascending: false });
  return data;
}

export const STALE_PAYMENTS_SQL_ALIAS =
  "SELECT p.payment_id AS pid, p.amount FROM public.payments p WHERE p.payment_id = $1";
EOF

set +e
OUT="$(cd "$TMP" && node "$VALIDATOR" --json)"
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  echo "✖ Validator exited 0 but was expected to FAIL on aliased payments.payment_id" >&2
  echo "$OUT" >&2
  exit 1
fi

if ! echo "$OUT" | grep -q '"table": "payments"'; then
  echo "✖ Validator failed but no 'payments' table finding present" >&2
  echo "$OUT" >&2
  exit 1
fi
if ! echo "$OUT" | grep -q '"column": "payment_id"'; then
  echo "✖ Validator failed but no 'payment_id' column finding present" >&2
  echo "$OUT" >&2
  exit 1
fi

echo "✓ Validator correctly failed on aliased payments.payment_id (exit=$STATUS)"

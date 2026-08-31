#!/usr/bin/env bash
# Regression: verify lint-security-invariants.mjs catches both
# ai_wildcard_cors and public_security_review re-introductions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
LINT=(node scripts/security/lint-security-invariants.mjs)

WORK="$(mktemp -d)"
AI_PATH="src/routes/api/ai.ts"
PUB_PATH="src/routes/security-review.tsx"
cp "$AI_PATH" "$WORK/ai.orig.ts"

restore() {
  cp "$WORK/ai.orig.ts" "$AI_PATH"
  rm -f "$PUB_PATH"
  rm -rf "$WORK"
}
trap restore EXIT

echo "1/3 baseline passes"
"${LINT[@]}" >/dev/null

# ── ai_wildcard_cors ───────────────────────────────────────────────
echo "2/3 catches ai_wildcard_cors"
node -e '
const fs=require("fs");
const p=process.argv[1];
let s=fs.readFileSync(p,"utf8");
s=s.replace(/headers\["access-control-allow-origin"\] = origin;/,
            `headers["access-control-allow-origin"] = "*";`);
if(!/= "\*";/.test(s)) { console.error("patch did not apply"); process.exit(2); }
fs.writeFileSync(p,s);
' "$AI_PATH"
if "${LINT[@]}" >/dev/null 2>&1; then
  echo "FAIL: lint did not catch ai_wildcard_cors regression" >&2
  exit 1
fi
cp "$WORK/ai.orig.ts" "$AI_PATH"

# ── public_security_review ─────────────────────────────────────────
echo "3/3 catches public_security_review"
cat > "$PUB_PATH" <<'EOF'
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/security-review")({ component: () => null });
EOF
if "${LINT[@]}" >/dev/null 2>&1; then
  echo "FAIL: lint did not catch public_security_review regression" >&2
  exit 1
fi
rm -f "$PUB_PATH"

echo "✓ regression checks all fired"

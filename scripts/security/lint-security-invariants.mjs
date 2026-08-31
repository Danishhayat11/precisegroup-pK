#!/usr/bin/env node
/**
 * CI lint for security invariants that have already been fixed once and
 * must never regress. Each check exits non-zero on the first violation so
 * the build fails fast in CI.
 *
 * Checks:
 *   1. ai_wildcard_cors        — /api/ai must not send
 *                                `Access-Control-Allow-Origin: *`.
 *   2. public_security_review  — the Security Issues Review route must
 *                                live under `_authenticated/` (auth gate)
 *                                and never at the top-level public path.
 */
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const failures = [];

async function readIfExists(path) {
  try {
    await stat(path);
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

// ── 1. ai_wildcard_cors ────────────────────────────────────────────────
{
  const path = join(ROOT, "src/routes/api/ai.ts");
  const src = await readIfExists(path);
  if (src == null) {
    failures.push({
      id: "ai_wildcard_cors",
      message: `Expected admin AI route at ${relative(ROOT, path)} — file missing. If it moved, update scripts/security/lint-security-invariants.mjs.`,
    });
  } else {
    // Match `access-control-allow-origin` with a wildcard value in any quote style.
    // Match `access-control-allow-origin` paired with a wildcard `"*"` value
    // regardless of the separator (`:`, `,`, or `=`) so JSON headers, object
    // literals, and header-assignment expressions are all covered.
    const re = /access-control-allow-origin[\s"'`\]]*[:,=]\s*["'`]\*["'`]/i;
    if (re.test(src)) {
      failures.push({
        id: "ai_wildcard_cors",
        message: `${relative(ROOT, path)} sends 'Access-Control-Allow-Origin: *'. The Admin AI API must use the explicit allowlist (DEFAULT_ALLOWED_ORIGINS + ADMIN_AI_CORS_ORIGINS).`,
      });
    }
  }
}

// ── 2. public_security_review ──────────────────────────────────────────
{
  const publicPath = join(ROOT, "src/routes/security-review.tsx");
  const gatedPath = join(ROOT, "src/routes/_authenticated/security-review.tsx");

  if (existsSync(publicPath)) {
    failures.push({
      id: "public_security_review",
      message: `${relative(ROOT, publicPath)} exists at a public route path. Move it under src/routes/_authenticated/ so the auth gate applies.`,
    });
  }

  const gatedSrc = await readIfExists(gatedPath);
  if (gatedSrc == null) {
    failures.push({
      id: "public_security_review",
      message: `Expected the Security Issues Review route at ${relative(ROOT, gatedPath)}. Do not re-create it at a public path.`,
    });
  } else {
    if (!/createFileRoute\(\s*['"]\/_authenticated\/security-review['"]/.test(gatedSrc)) {
      failures.push({
        id: "public_security_review",
        message: `${relative(ROOT, gatedPath)} must declare createFileRoute("/_authenticated/security-review") so the pathless auth layout protects it.`,
      });
    }
    if (!/isAdmin/.test(gatedSrc) || !/AdminRequiredMessage/.test(gatedSrc)) {
      failures.push({
        id: "public_security_review",
        message: `${relative(ROOT, gatedPath)} must gate access with the isAdmin check + AdminRequiredMessage fallback.`,
      });
    }
  }
}

if (failures.length > 0) {
  console.error("\n✖ Security invariant lint failed:\n");
  for (const f of failures) {
    console.error(`  [${f.id}] ${f.message}`);
  }
  console.error(
    `\n${failures.length} violation${failures.length === 1 ? "" : "s"}. See scripts/security/lint-security-invariants.mjs.\n`,
  );
  process.exit(1);
}

console.log("✓ Security invariants OK (ai_wildcard_cors, public_security_review)");

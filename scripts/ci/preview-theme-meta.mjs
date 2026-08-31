#!/usr/bin/env node
/**
 * Deployed-preview theme-color meta guard.
 *
 * Fetches the served HTML for /site (and /, the shared root shell) from the
 * public preview and fails CI if the SSR `theme-color` <meta> still carries
 * the old palette value `#FAFAF7`. That hex was the pre-refresh light-mode
 * theme color; after the palette rebase the source of truth is
 * THEME_COLOR_LIGHT = "#F8FAFC" in src/lib/theme.tsx.
 *
 * Failure modes this catches:
 *   · A stale build was promoted (preview still serves the old bundle).
 *   · A code merge silently reverted THEME_COLOR_LIGHT in src/lib/theme.tsx.
 *   · A hand-authored <meta name="theme-color"> was reintroduced in the
 *     root head somewhere and pinned back to the old hex.
 *
 * Non-goals: does NOT verify the *dark* runtime swap (that's a browser-side
 * concern covered by tests/visual/theme-meta.spec.ts) — CI fetches raw HTML,
 * which is theme-agnostic and always ships the light SSR default.
 *
 * Usage:
 *   PREVIEW_URL=https://precisegroup-pk.lovable.app node scripts/ci/preview-theme-meta.mjs
 *   node scripts/ci/preview-theme-meta.mjs --url https://precisegroup-pk.lovable.app
 *
 * Defaults to the project's preview URL when no override is given.
 */

const FORBIDDEN_HEX = "#FAFAF7";
const EXPECTED_HEX = "#F8FAFC";
const ROUTES = ["/", "/site"];
const DEFAULT_BASE = "https://precisegroup-pk.lovable.app";
const TIMEOUT_MS = 15_000;

function parseArgs(argv) {
  const args = { url: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" && argv[i + 1]) {
      args.url = argv[++i];
      continue;
    }
    if (a.startsWith("--url=")) {
      args.url = a.slice("--url=".length);
      continue;
    }
  }
  return args;
}

function pickBaseUrl() {
  const { url } = parseArgs(process.argv);
  const raw = url || process.env.PREVIEW_URL || DEFAULT_BASE;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new Error(`unsupported protocol: ${u.protocol}`);
    }
    // Strip trailing slash so URL joins are unambiguous.
    return raw.replace(/\/+$/, "");
  } catch (err) {
    console.error(`✗ invalid PREVIEW_URL / --url: ${raw} (${err.message})`);
    process.exit(2);
  }
}

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        // Ask upstream not to hand us a cached copy — we want the freshest
        // build so a green run genuinely reflects the deployed HTML.
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

// Extracts the content of every <meta name="theme-color" ...> in the served
// HTML. Case-insensitive, tolerant of attribute order and single/double quotes.
function extractThemeColors(html) {
  const rx = /<meta\b[^>]*\bname=["']theme-color["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/gi;
  const rx2 = /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']theme-color["'][^>]*>/gi;
  const out = [];
  for (const m of html.matchAll(rx)) out.push(m[1]);
  for (const m of html.matchAll(rx2)) out.push(m[1]);
  return out;
}

function normalizeHex(v) {
  return v.trim().toUpperCase();
}

async function main() {
  const base = pickBaseUrl();
  console.log(`⧗ preview base: ${base}`);
  console.log(`⧗ expect theme-color = ${EXPECTED_HEX}, reject ${FORBIDDEN_HEX}`);

  const failures = [];
  for (const path of ROUTES) {
    const url = base + path;
    let res;
    try {
      res = await fetchWithTimeout(url);
    } catch (err) {
      failures.push(`${path}: fetch failed — ${err.message}`);
      continue;
    }
    if (res.status < 200 || res.status >= 400) {
      failures.push(`${path}: HTTP ${res.status}`);
      continue;
    }
    const colors = extractThemeColors(res.body).map(normalizeHex);
    if (colors.length === 0) {
      failures.push(`${path}: no <meta name="theme-color"> found in served HTML`);
      continue;
    }
    const stale = colors.filter((c) => c === normalizeHex(FORBIDDEN_HEX));
    const expected = colors.filter((c) => c === normalizeHex(EXPECTED_HEX));
    if (stale.length > 0) {
      failures.push(
        `${path}: served HTML still carries the old theme-color ${FORBIDDEN_HEX} ` +
          `(found ${stale.length}× — full list: ${colors.join(", ")})`,
      );
      continue;
    }
    if (expected.length === 0) {
      // Not the forbidden value, but also not what we expect — surface it so
      // a silent palette drift doesn't slip past on a color that "isn't old".
      failures.push(
        `${path}: theme-color ${colors.join(", ")} does not match expected ${EXPECTED_HEX}`,
      );
      continue;
    }
    console.log(`✓ ${path}: theme-color = ${colors.join(", ")}`);
  }

  if (failures.length > 0) {
    console.error("\n✗ preview theme-color guard failed:");
    for (const f of failures) console.error(`  • ${f}`);
    console.error(
      `\nExpected SSR light default ${EXPECTED_HEX} (see THEME_COLOR_LIGHT in src/lib/theme.tsx).\n` +
        `If the source is correct, the deployed preview may be stale — republish and re-run.`,
    );
    process.exit(1);
  }

  console.log("\n✓ deployed preview theme-color is fresh on all checked routes");
}

main().catch((err) => {
  console.error(`✗ unexpected error: ${err.stack || err.message}`);
  process.exit(2);
});

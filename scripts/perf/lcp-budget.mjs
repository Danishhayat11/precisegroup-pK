#!/usr/bin/env node
/**
 * Lighthouse CI-style performance budget.
 *
 * Fails (exit 1) if LCP regresses above the budget on any audited URL.
 *
 * Default budget: 2500ms (Core Web Vitals "good" threshold for LCP).
 * Default URLs:   /  and  /site
 *
 * Env:
 *   LCP_BUDGET_MS  override the LCP budget (default 2500)
 *   LH_BASE_URL    origin to audit  (default http://localhost:8080)
 *   LH_FORM_FACTOR "mobile" | "desktop" (default "mobile" — matches CWV)
 *   LH_URLS        comma-separated paths (default "/,/site")
 *
 * Notes:
 * - `/` is a 301 → `/site`. Lighthouse follows redirects and audits the
 *   final page; we still audit both entries so this fires if `/` ever
 *   stops redirecting and starts rendering directly.
 * - The dev server must already be running at LH_BASE_URL (or the script
 *   exits with a clear error). We do NOT spawn the server ourselves so
 *   the budget can run against a preview/prod origin unchanged.
 */

import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const BUDGET_MS = Number(process.env.LCP_BUDGET_MS ?? 2500);
const BASE = (process.env.LH_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const FORM = process.env.LH_FORM_FACTOR === "desktop" ? "desktop" : "mobile";
const PATHS = (process.env.LH_URLS ?? "/,/site")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function fmtMs(n) {
  return n == null ? "n/a" : `${Math.round(n)}ms`;
}

async function ensureOriginReachable() {
  try {
    const res = await fetch(BASE + "/", { redirect: "manual" });
    if (!res.ok && res.status < 300) {
      throw new Error(`unexpected status ${res.status}`);
    }
  } catch (err) {
    console.error(
      `[lcp-budget] cannot reach ${BASE}. Start the dev server first ` +
        `(e.g. \`bun run dev\`) or set LH_BASE_URL.\n  → ${String(err)}`,
    );
    process.exit(2);
  }
}

async function auditOne(port, url) {
  const desktopEmu = {
    mobile: false,
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    disabled: false,
  };
  const runnerResult = await lighthouse(url, {
    port,
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance"],
    formFactor: FORM,
    screenEmulation: FORM === "desktop" ? desktopEmu : undefined,
    throttlingMethod: "simulate",
  });
  const a = runnerResult.lhr.audits;
  return {
    url,
    finalUrl: runnerResult.lhr.finalDisplayedUrl,
    perf: Math.round((runnerResult.lhr.categories.performance.score ?? 0) * 100),
    lcp: a["largest-contentful-paint"]?.numericValue ?? null,
    fcp: a["first-contentful-paint"]?.numericValue ?? null,
    cls: a["cumulative-layout-shift"]?.numericValue ?? null,
    tbt: a["total-blocking-time"]?.numericValue ?? null,
  };
}

async function main() {
  await ensureOriginReachable();

  const chrome = await launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  const results = [];
  try {
    for (const p of PATHS) {
      const url = BASE + p;
      process.stderr.write(`[lcp-budget] auditing ${url} (${FORM})\n`);
      results.push(await auditOne(chrome.port, url));
    }
  } finally {
    await chrome.kill();
  }

  const rows = results.map((r) => ({
    URL: r.url,
    Final: r.finalUrl,
    Perf: r.perf,
    LCP: fmtMs(r.lcp),
    FCP: fmtMs(r.fcp),
    TBT: fmtMs(r.tbt),
    CLS: r.cls == null ? "n/a" : r.cls.toFixed(3),
    Budget: `${BUDGET_MS}ms`,
    Status: r.lcp != null && r.lcp <= BUDGET_MS ? "PASS" : "FAIL",
  }));
  // eslint-disable-next-line no-console
  console.table(rows);

  const failures = results.filter((r) => r.lcp == null || r.lcp > BUDGET_MS);
  if (failures.length > 0) {
    for (const r of failures) {
      const over =
        r.lcp == null ? "no LCP audit value" : `${Math.round(r.lcp - BUDGET_MS)}ms over budget`;
      console.error(`[lcp-budget] FAIL ${r.url}  LCP=${fmtMs(r.lcp)}  (${over})`);
    }
    process.exit(1);
  }

  console.error(`[lcp-budget] OK — all ${results.length} URL(s) under ${BUDGET_MS}ms`);
}

main().catch((err) => {
  console.error("[lcp-budget] crashed:", err);
  process.exit(2);
});

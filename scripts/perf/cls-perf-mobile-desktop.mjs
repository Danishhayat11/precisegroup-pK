#!/usr/bin/env node
/**
 * Ad-hoc CLS + perf audit on both mobile and desktop emulation, using an
 * identical Slow 4G throttling profile as the baseline so numbers are
 * comparable across form factors.
 *
 * Slow 4G (Lighthouse's mobile default, applied to desktop too here):
 *   rttMs 150, throughputKbps 1638.4, cpuSlowdownMultiplier 4
 *
 * Not wired into package.json — this is a diagnostic. Run:
 *   CHROME_PATH=/bin/chromium node scripts/perf/cls-perf-mobile-desktop.mjs
 */
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const BASE = (process.env.LH_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const PATHS = (process.env.LH_URLS ?? "/,/site").split(",").map((s) => s.trim());

// Shared Slow 4G throttling — identical for mobile and desktop runs.
const SLOW_4G = {
  rttMs: 150,
  throughputKbps: 1638.4,
  cpuSlowdownMultiplier: 4,
  requestLatencyMs: 0,
  downloadThroughputKbps: 0,
  uploadThroughputKbps: 0,
};

const MOBILE_SCREEN = {
  mobile: true,
  width: 412,
  height: 823,
  deviceScaleFactor: 1.75,
  disabled: false,
};
const DESKTOP_SCREEN = {
  mobile: false,
  width: 1350,
  height: 940,
  deviceScaleFactor: 1,
  disabled: false,
};

async function auditOne(port, url, formFactor) {
  const r = await lighthouse(url, {
    port,
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance"],
    formFactor,
    screenEmulation: formFactor === "desktop" ? DESKTOP_SCREEN : MOBILE_SCREEN,
    throttlingMethod: "simulate",
    throttling: SLOW_4G,
  });
  const a = r.lhr.audits;
  return {
    url,
    formFactor,
    finalUrl: r.lhr.finalDisplayedUrl,
    perf: Math.round((r.lhr.categories.performance.score ?? 0) * 100),
    LCP_ms: Math.round(a["largest-contentful-paint"]?.numericValue ?? 0),
    FCP_ms: Math.round(a["first-contentful-paint"]?.numericValue ?? 0),
    TBT_ms: Math.round(a["total-blocking-time"]?.numericValue ?? 0),
    SI_ms: Math.round(a["speed-index"]?.numericValue ?? 0),
    CLS: Number((a["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(4)),
    layoutShifts: a["layout-shift-elements"]?.details?.items?.length ?? 0,
  };
}

const chrome = await launch({ chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"] });
const results = [];
try {
  for (const p of PATHS) {
    const url = BASE + p;
    for (const ff of ["mobile", "desktop"]) {
      process.stderr.write(`[audit] ${ff}\t${url}\n`);
      results.push(await auditOne(chrome.port, url, ff));
    }
  }
} finally {
  await chrome.kill();
}
console.log(JSON.stringify(results, null, 2));
console.error("\nSummary (throttling: Slow 4G, identical for both form factors):");
console.table(
  results.map((r) => ({
    URL: r.url,
    Device: r.formFactor,
    Perf: r.perf,
    LCP: r.LCP_ms + "ms",
    FCP: r.FCP_ms + "ms",
    SI: r.SI_ms + "ms",
    TBT: r.TBT_ms + "ms",
    CLS: r.CLS,
    Shifts: r.layoutShifts,
  })),
);

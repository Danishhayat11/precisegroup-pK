#!/usr/bin/env node
/**
 * Fluid-typography visual regression suite.
 *
 * Captures full-page screenshots of public marketing routes at
 * three breakpoints (375 / 768 / 1440), runs heuristic layout
 * assertions targeted at fluid design regressions, and — when a
 * baseline PNG exists — pixel-diffs against it. Writes a
 * `manifest.json` the in-app /visual-qa dashboard renders.
 *
 * Usage:
 *   node scripts/visual-regression.mjs              # capture + assert + diff
 *   node scripts/visual-regression.mjs --promote    # promote current → baseline
 *   BASE_URL=https://foo.lovable.app node scripts/visual-regression.mjs
 */

import { chromium } from "playwright";
import { mkdir, writeFile, readFile, cp, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "visual-qa");
const CURRENT = join(OUT_DIR, "current");
const BASELINE = join(OUT_DIR, "baseline");
const DIFF = join(OUT_DIR, "diff");
const MANIFEST = join(OUT_DIR, "manifest.json");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const PROMOTE = process.argv.includes("--promote");

/** Public marketing routes captured by the suite. */
const ROUTES = [
  { id: "home", path: "/", label: "Home" },
  { id: "site", path: "/site", label: "Site — Overview" },
  { id: "site-services", path: "/site/services", label: "Services" },
  { id: "site-projects", path: "/site/projects", label: "Projects" },
  { id: "site-contact", path: "/site/contact", label: "Contact" },
  {
    id: "resources-pm-erp",
    path: "/resources/property-management-vs-erp",
    label: "Resources — PM vs ERP",
  },
];

const BREAKPOINTS = [
  { id: "375", width: 375, height: 812, label: "Mobile 375", device: "mobile" },
  { id: "768", width: 768, height: 1024, label: "Tablet 768", device: "tablet" },
  { id: "1440", width: 1440, height: 900, label: "Desktop 1440", device: "desktop" },
];

/** Pixel-diff threshold — >0.3% pixel delta counts as a regression. */
const DIFF_PCT_FAIL = 0.3;

async function ensureDirs() {
  await mkdir(CURRENT, { recursive: true });
  await mkdir(BASELINE, { recursive: true });
  await mkdir(DIFF, { recursive: true });
}

/** Run in-browser: heuristic layout assertions for fluid regressions. */
function runAssertionsInPage() {
  return /* js */ `
    (() => {
      const findings = [];
      const html = document.documentElement;
      const body = document.body;

      // 1. Horizontal scroll — the #1 fluid-layout regression on 375px.
      const hOverflow = html.scrollWidth - html.clientWidth;
      if (hOverflow > 1) {
        findings.push({
          rule: 'no-horizontal-scroll',
          severity: 'error',
          message: 'Document scrolls horizontally by ' + hOverflow + 'px',
        });
      }

      // 2. Any element wider than the viewport (overflow culprits).
      const vw = window.innerWidth;
      const wide = [];
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width > vw + 1 && r.height > 0) {
          wide.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 80),
            width: Math.round(r.width),
          });
          if (wide.length >= 5) break;
        }
      }
      if (wide.length) {
        findings.push({
          rule: 'no-element-wider-than-viewport',
          severity: 'error',
          message: wide.length + ' element(s) exceed viewport width',
          detail: wide,
        });
      }

      // 3. Font-size sanity — clamp() should never yield <12px body or <22px h1.
      const bodyFs = parseFloat(getComputedStyle(body).fontSize);
      if (bodyFs < 14) {
        findings.push({
          rule: 'body-font-size-min',
          severity: 'error',
          message: 'Body font-size ' + bodyFs.toFixed(2) + 'px < 14px minimum',
        });
      }
      const h1 = document.querySelector('h1');
      if (h1) {
        const h1Fs = parseFloat(getComputedStyle(h1).fontSize);
        if (h1Fs < 22) {
          findings.push({
            rule: 'h1-font-size-min',
            severity: 'error',
            message: 'H1 font-size ' + h1Fs.toFixed(2) + 'px < 22px minimum',
          });
        }
        if (h1Fs > 80) {
          findings.push({
            rule: 'h1-font-size-max',
            severity: 'warn',
            message: 'H1 font-size ' + h1Fs.toFixed(2) + 'px > 80px maximum',
          });
        }
      }

      // 4. Text overflow — any element whose scrollWidth exceeds clientWidth
      //    while carrying overflow:hidden without text-overflow set.
      const clipped = [];
      for (const el of document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,button,a,span')) {
        if (el.scrollWidth - el.clientWidth > 2 && el.clientWidth > 0) {
          const cs = getComputedStyle(el);
          if (cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis') {
            clipped.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().slice(0, 40),
              overflow: Math.round(el.scrollWidth - el.clientWidth),
            });
            if (clipped.length >= 5) break;
          }
        }
      }
      if (clipped.length) {
        findings.push({
          rule: 'no-hidden-text-overflow',
          severity: 'warn',
          message: clipped.length + ' text node(s) clipped without ellipsis',
          detail: clipped,
        });
      }

      // 5. Tap-target minimum on coarse-pointer widths only (<=768).
      if (window.innerWidth <= 768) {
        const small = [];
        for (const el of document.body.querySelectorAll('button, a[href], [role="button"]')) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 36)) {
            small.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().slice(0, 30),
              size: Math.round(r.width) + 'x' + Math.round(r.height),
            });
            if (small.length >= 5) break;
          }
        }
        if (small.length) {
          findings.push({
            rule: 'tap-target-min',
            severity: 'warn',
            message: small.length + ' interactive element(s) below 40x36 tap target',
            detail: small,
          });
        }
      }

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scroll: { width: html.scrollWidth, height: html.scrollHeight },
        bodyFontSize: bodyFs,
        h1FontSize: h1 ? parseFloat(getComputedStyle(h1).fontSize) : null,
        findings,
      };
    })()
  `;
}

async function diffPng(currentPath, baselinePath, diffPath) {
  const cur = PNG.sync.read(await readFile(currentPath));
  const base = PNG.sync.read(await readFile(baselinePath));
  if (cur.width !== base.width || cur.height !== base.height) {
    return {
      ok: false,
      reason: "size-mismatch",
      current: { w: cur.width, h: cur.height },
      baseline: { w: base.width, h: base.height },
    };
  }
  const diff = new PNG({ width: cur.width, height: cur.height });
  const mismatched = pixelmatch(cur.data, base.data, diff.data, cur.width, cur.height, {
    threshold: 0.1,
    includeAA: false,
  });
  await writeFile(diffPath, PNG.sync.write(diff));
  const total = cur.width * cur.height;
  return {
    ok: true,
    mismatchedPixels: mismatched,
    totalPixels: total,
    pct: (mismatched / total) * 100,
  };
}

async function promote() {
  console.log("[visual-qa] promoting current → baseline");
  if (existsSync(BASELINE)) await rm(BASELINE, { recursive: true, force: true });
  await mkdir(BASELINE, { recursive: true });
  const files = existsSync(CURRENT) ? await readdir(CURRENT) : [];
  for (const f of files) {
    if (f.endsWith(".png")) await cp(join(CURRENT, f), join(BASELINE, f));
  }
  console.log("[visual-qa] promoted " + files.length + " baseline shot(s)");
}

async function main() {
  await ensureDirs();
  if (PROMOTE) return promote();

  // Prefer a system-provided chromium (sandbox ships /chromium_headless_shell-*)
  // so we don't need `npx playwright install` to run.
  const { existsSync: exists } = await import("node:fs");
  const systemChromiums = [
    "/chromium_headless_shell-1194/chrome-linux/headless_shell",
    "/chromium-1194/chrome-linux/chrome",
  ];
  const executablePath = systemChromiums.find((p) => exists(p));
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const started = new Date().toISOString();
  const runs = [];
  let totalPass = 0,
    totalFail = 0;

  for (const bp of BREAKPOINTS) {
    const context = await browser.newContext({
      viewport: { width: bp.width, height: bp.height },
      deviceScaleFactor: 2, // hi-DPI captures
      hasTouch: bp.device !== "desktop",
    });
    const page = await context.newPage();

    for (const route of ROUTES) {
      const key = route.id + "-" + bp.id;
      const url = BASE_URL + route.path;
      const shot = join(CURRENT, key + ".png");
      const baseShot = join(BASELINE, key + ".png");
      const diffShot = join(DIFF, key + ".png");
      const run = {
        key,
        route: route.path,
        routeId: route.id,
        routeLabel: route.label,
        breakpoint: bp.id,
        breakpointLabel: bp.label,
        device: bp.device,
        url,
        status: "pass",
        errors: [],
        warnings: [],
        metrics: null,
        diff: null,
        baselineExists: false,
      };

      try {
        console.log("[visual-qa] " + bp.id.padStart(4) + "  " + route.path);
        const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        if (!resp || !resp.ok()) {
          run.status = "fail";
          run.errors.push({
            rule: "route-loads",
            severity: "error",
            message: "HTTP " + (resp ? resp.status() : "no response"),
          });
        } else {
          // Small settle for fonts + fluid clamp evaluation.
          await page.evaluate(() => (document.fonts && document.fonts.ready) || Promise.resolve());
          await page.waitForTimeout(300);
          await page.screenshot({ path: shot, fullPage: true });

          const metrics = await page.evaluate(runAssertionsInPage());
          run.metrics = {
            viewport: metrics.viewport,
            scroll: metrics.scroll,
            bodyFontSize: metrics.bodyFontSize,
            h1FontSize: metrics.h1FontSize,
          };
          for (const f of metrics.findings) {
            (f.severity === "error" ? run.errors : run.warnings).push(f);
          }
          if (run.errors.length) run.status = "fail";
          else if (run.warnings.length) run.status = "warn";

          if (existsSync(baseShot)) {
            run.baselineExists = true;
            const d = await diffPng(shot, baseShot, diffShot);
            run.diff = d;
            if (!d.ok) {
              run.status = "fail";
              run.errors.push({
                rule: "baseline-size-match",
                severity: "error",
                message: "Baseline dimensions differ from current shot",
              });
            } else if (d.pct > DIFF_PCT_FAIL) {
              run.status = "fail";
              run.errors.push({
                rule: "pixel-diff-threshold",
                severity: "error",
                message: d.pct.toFixed(3) + "% of pixels differ (>" + DIFF_PCT_FAIL + "% budget)",
              });
            }
          }
        }
      } catch (err) {
        run.status = "fail";
        run.errors.push({
          rule: "capture",
          severity: "error",
          message: String((err && err.message) || err),
        });
      }

      if (run.status === "fail") totalFail++;
      else totalPass++;
      runs.push(run);
    }

    await context.close();
  }

  await browser.close();

  const manifest = {
    generatedAt: started,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    breakpoints: BREAKPOINTS,
    routes: ROUTES,
    diffThresholdPct: DIFF_PCT_FAIL,
    totals: { pass: totalPass, fail: totalFail, runs: runs.length },
    runs,
  };
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(
    "\n[visual-qa] " +
      totalPass +
      " pass · " +
      totalFail +
      " fail  → public/visual-qa/manifest.json",
  );
  process.exit(totalFail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

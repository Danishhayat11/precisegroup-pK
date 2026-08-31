#!/usr/bin/env node
/**
 * Responsive audit runner.
 *
 * Visits a fixed matrix of routes (/site, /login, /dashboard) at three
 * viewports (mobile / tablet / desktop) and records:
 *   • whether the route has horizontal overflow (document scroll or
 *     an offending descendant, matching `tests/a11y/responsive-
 *     breakpoints.spec.ts`),
 *   • a viewport screenshot,
 *   • the offending elements (first 5) when overflow is detected.
 *
 * Writes:
 *   • `public/responsive-audit/manifest.json` — machine-readable results.
 *   • `public/responsive-audit/screenshots/<device>-<route>.png` — image
 *     served alongside the manifest so the dashboard page can render it.
 *
 * Both artifacts live under `public/` so the running dev server (and any
 * deploy) serves them at `/responsive-audit/*` — the dashboard page
 * (`/responsive-audit`) fetches the manifest from there.
 *
 * Run:
 *   node scripts/run-responsive-audit.mjs
 *
 * Requires the dev server on http://localhost:8080 (default). Set
 * `BASE_URL` to override.  Authenticated routes are skipped when
 * `LOVABLE_BROWSER_SUPABASE_*` env vars are absent (matches the a11y
 * spec's behavior), and their manifest row is recorded as `skipped`.
 */
import { chromium } from "playwright";
import { mkdir, writeFile, rm, readFile, copyFile, readdir } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const OUT_DIR = path.resolve("public/responsive-audit");
const SHOT_DIR = path.join(OUT_DIR, "screenshots");
const HISTORY_DIR = path.join(OUT_DIR, "history");
const HISTORY_KEEP = Number(process.env.RESPONSIVE_AUDIT_HISTORY_KEEP ?? 20);

const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

const ALL_VIEWPORTS = {
  mobile: { width: 375, height: 1200 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 1400 },
};

const ALL_ROUTES = [
  { name: "site", path: "/site", requiresAuth: false, ready: "header" },
  { name: "login", path: "/login", requiresAuth: false, ready: 'input[type="email"]' },
  { name: "dashboard", path: "/dashboard", requiresAuth: true, ready: "main" },
];

// Optional workflow_dispatch overrides — a comma-separated allowlist for
// devices and routes, and a positive integer count of screenshots per cell.
function parseList(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
const DEVICE_FILTER = parseList(process.env.AUDIT_DEVICES);
const ROUTE_FILTER = parseList(process.env.AUDIT_ROUTES);
const SCREENSHOT_COUNT = Math.max(
  1,
  Number.parseInt(process.env.AUDIT_SCREENSHOT_COUNT ?? "1", 10) || 1,
);
// How many times to retry a row that fails with status="error" (transient
// nav timeouts, flaky readiness selectors, dev-server hiccups). Default 2
// extra attempts on top of the initial try. Set AUDIT_RETRIES=0 to disable.
const AUDIT_RETRIES = Math.max(0, Number.parseInt(process.env.AUDIT_RETRIES ?? "2", 10) || 0);
// Per-navigation timeouts (ms). Overridable so slow CI can bump them
// without editing the script.
const NAV_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.AUDIT_NAV_TIMEOUT_MS ?? "30000", 10) || 30_000,
);
const READY_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.AUDIT_READY_TIMEOUT_MS ?? "15000", 10) || 15_000,
);

const VIEWPORTS = Object.fromEntries(
  Object.entries(ALL_VIEWPORTS).filter(
    ([name]) => DEVICE_FILTER.length === 0 || DEVICE_FILTER.includes(name),
  ),
);
const ROUTES = ALL_ROUTES.filter((r) => {
  if (ROUTE_FILTER.length === 0) return true;
  return ROUTE_FILTER.some((f) => f === r.name.toLowerCase() || f === r.path.toLowerCase());
});

if (Object.keys(VIEWPORTS).length === 0) {
  console.error(
    `No matching devices for AUDIT_DEVICES="${process.env.AUDIT_DEVICES}". Valid: ${Object.keys(ALL_VIEWPORTS).join(", ")}`,
  );
  process.exit(2);
}
if (ROUTES.length === 0) {
  console.error(
    `No matching routes for AUDIT_ROUTES="${process.env.AUDIT_ROUTES}". Valid: ${ALL_ROUTES.map((r) => `${r.name} (${r.path})`).join(", ")}`,
  );
  process.exit(2);
}

async function seed(context, page) {
  if (!HAS_SESSION) return;
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [STORAGE_KEY, SESSION_JSON]);
  if (COOKIES_JSON) {
    const cookies = JSON.parse(COOKIES_JSON);
    for (const c of cookies) c.url = BASE;
    await context.addCookies(cookies);
  }
}

async function measureOverflow(page) {
  return page.evaluate(() => {
    function hasClippingAncestor(el) {
      let n = el.parentElement;
      while (n && n !== document.documentElement) {
        const s = getComputedStyle(n);
        if (
          s.overflowX === "hidden" ||
          s.overflowX === "clip" ||
          s.overflow === "hidden" ||
          s.overflow === "clip"
        )
          return true;
        n = n.parentElement;
      }
      return false;
    }
    const vw = window.innerWidth;
    const docOverflow = Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    );
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      if (s.position === "fixed" || s.pointerEvents === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right - vw <= 1) continue;
      if (hasClippingAncestor(el)) continue;
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") ?? "").slice(0, 100),
        right: Math.round(r.right),
      });
      if (offenders.length >= 5) break;
    }
    return { viewport: vw, docOverflow, offenders };
  });
}

async function auditOne(browser, device, size, route) {
  const context = await browser.newContext({ viewport: size, reducedMotion: "reduce" });
  const page = await context.newPage();
  const started = Date.now();
  try {
    if (route.requiresAuth) {
      if (!HAS_SESSION) {
        return {
          device,
          route: route.name,
          path: route.path,
          viewport: size,
          status: "skipped",
          reason: "no Supabase session in env",
          overflowPx: 0,
          offenders: [],
          screenshot: null,
          durationMs: 0,
        };
      }
      await seed(context, page);
    }
    await page.goto(`${BASE}${route.path}`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page
      .locator(route.ready)
      .first()
      .waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
    );
    const shotUrls = [];
    for (let i = 1; i <= SCREENSHOT_COUNT; i++) {
      const shotName =
        SCREENSHOT_COUNT === 1 ? `${device}-${route.name}.png` : `${device}-${route.name}-${i}.png`;
      await page.screenshot({ path: path.join(SHOT_DIR, shotName) });
      shotUrls.push(`/responsive-audit/screenshots/${shotName}`);
      if (i < SCREENSHOT_COUNT) {
        // Small delay lets any deferred layout/animation settle between shots.
        await page.waitForTimeout(250);
      }
    }
    const metrics = await measureOverflow(page);
    const overflowPx = Math.max(
      metrics.docOverflow,
      ...metrics.offenders.map((o) => o.right - metrics.viewport),
    );
    return {
      device,
      route: route.name,
      path: route.path,
      viewport: size,
      status: overflowPx > 1 || metrics.offenders.length > 0 ? "overflow" : "ok",
      overflowPx: Math.max(0, overflowPx),
      offenders: metrics.offenders,
      screenshot: shotUrls[0],
      screenshots: shotUrls,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      device,
      route: route.name,
      path: route.path,
      viewport: size,
      status: "error",
      reason: err instanceof Error ? err.message : String(err),
      overflowPx: 0,
      offenders: [],
      screenshot: null,
      durationMs: Date.now() - started,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  // Preserve the previous run so the dashboard can diff against it.
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  const previousPath = path.join(OUT_DIR, "manifest.previous.json");
  await mkdir(OUT_DIR, { recursive: true });
  try {
    await copyFile(manifestPath, previousPath);
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
    // First run — no previous manifest to preserve.
    await rm(previousPath, { force: true });
  }

  await rm(SHOT_DIR, { recursive: true, force: true });
  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CI ? {} : { executablePath: "/chromium-1194/chrome-linux/chrome" }),
  });
  const results = [];
  try {
    for (const [device, size] of Object.entries(VIEWPORTS)) {
      for (const route of ROUTES) {
        process.stdout.write(`  ${device.padEnd(8)} ${route.path.padEnd(12)} `);
        let r = await auditOne(browser, device, size, route);
        let attempt = 0;
        // Only retry transient runtime errors — "overflow" is a real
        // finding and "skipped" is intentional (no auth session).
        while (r.status === "error" && attempt < AUDIT_RETRIES) {
          attempt += 1;
          process.stdout.write(`error → retry ${attempt}/${AUDIT_RETRIES} `);
          r = await auditOne(browser, device, size, route);
        }
        if (attempt > 0) r.retries = attempt;
        process.stdout.write(`${r.status}${r.overflowPx ? ` (+${r.overflowPx}px)` : ""}\n`);
        results.push(r);
      }
    }
  } finally {
    await browser.close();
  }

  let previousGeneratedAt = null;
  try {
    const prev = JSON.parse(await readFile(previousPath, "utf8"));
    previousGeneratedAt = prev.generatedAt ?? null;
  } catch {}

  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    hasAuthSession: HAS_SESSION,
    viewports: VIEWPORTS,
    previousGeneratedAt,
    results,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${results.length} rows → public/responsive-audit/manifest.json`);
  if (previousGeneratedAt)
    console.log(`Previous run preserved → public/responsive-audit/manifest.previous.json`);

  // Archive this run into history/<id>/ with its own screenshots so a user
  // can later re-select any past run as the comparison baseline.
  const runId = manifest.generatedAt.replace(/[:.]/g, "-");
  const runDir = path.join(HISTORY_DIR, runId);
  const runShotDir = path.join(runDir, "screenshots");
  await mkdir(runShotDir, { recursive: true });
  const archivedResults = [];
  for (const r of results) {
    const archivedShots = [];
    for (const url of r.screenshots ?? (r.screenshot ? [r.screenshot] : [])) {
      const base = path.basename(url);
      try {
        await copyFile(path.join(SHOT_DIR, base), path.join(runShotDir, base));
        archivedShots.push(`/responsive-audit/history/${runId}/screenshots/${base}`);
      } catch {
        /* screenshot missing — skip */
      }
    }
    archivedResults.push({
      ...r,
      screenshot: archivedShots[0] ?? null,
      screenshots: archivedShots,
    });
  }
  const archivedManifest = { ...manifest, results: archivedResults, runId };
  await writeFile(path.join(runDir, "manifest.json"), JSON.stringify(archivedManifest, null, 2));

  // Rebuild history/index.json from the archived runs on disk and prune old ones.
  await mkdir(HISTORY_DIR, { recursive: true });
  const entries = await readdir(HISTORY_DIR, { withFileTypes: true });
  const runs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const m = JSON.parse(await readFile(path.join(HISTORY_DIR, e.name, "manifest.json"), "utf8"));
      const totals = { ok: 0, overflow: 0, skipped: 0, error: 0 };
      for (const row of m.results ?? []) totals[row.status] = (totals[row.status] ?? 0) + 1;
      runs.push({
        id: e.name,
        generatedAt: m.generatedAt,
        baseUrl: m.baseUrl,
        count: (m.results ?? []).length,
        totals,
      });
    } catch {
      /* skip malformed run */
    }
  }
  runs.sort((a, b) => (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""));
  const kept = runs.slice(0, HISTORY_KEEP);
  const pruned = runs.slice(HISTORY_KEEP);
  for (const p of pruned) {
    await rm(path.join(HISTORY_DIR, p.id), { recursive: true, force: true });
  }
  await writeFile(
    path.join(HISTORY_DIR, "index.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), runs: kept }, null, 2),
  );
  console.log(
    `Archived run → public/responsive-audit/history/${runId}/  (${kept.length} kept, ${pruned.length} pruned)`,
  );

  await notifyNewFailures({ manifest, runId, previousPath });
}

/**
 * Detect NEW failing (device × route) combinations vs the previous run and
 * POST them to /api/public/audit-notify so the server dispatches email
 * and Slack alerts. Silently no-ops when notify env vars are absent, so
 * local `node scripts/run-responsive-audit.mjs` invocations keep working
 * with zero setup.
 *
 * Required env to send:
 *   RESPONSIVE_AUDIT_NOTIFY_URL     e.g. https://precisegroup-pk.lovable.app
 *   RESPONSIVE_AUDIT_NOTIFY_SECRET  same value as the server-side secret
 */
async function notifyNewFailures({ manifest, runId, previousPath }) {
  const notifyUrl = process.env.RESPONSIVE_AUDIT_NOTIFY_URL;
  const notifySecret = process.env.RESPONSIVE_AUDIT_NOTIFY_SECRET;
  if (!notifyUrl || !notifySecret) {
    console.log("Notification skipped (RESPONSIVE_AUDIT_NOTIFY_URL / _SECRET not set).");
    return;
  }
  const isFailing = (s) => s === "overflow" || s === "error";
  let previousResults = [];
  try {
    const prev = JSON.parse(await readFile(previousPath, "utf8"));
    previousResults = Array.isArray(prev.results) ? prev.results : [];
  } catch {
    /* no previous — treat every current failure as new below */
  }
  const prevByKey = new Map(previousResults.map((r) => [`${r.device}::${r.route}`, r]));
  const newFailures = [];
  for (const r of manifest.results) {
    if (!isFailing(r.status)) continue;
    const prev = prevByKey.get(`${r.device}::${r.route}`);
    if (prev && isFailing(prev.status)) continue; // still-failing, not new
    newFailures.push({
      device: r.device,
      route: r.route,
      path: r.path,
      status: r.status,
      overflowPx: typeof r.overflowPx === "number" ? r.overflowPx : undefined,
      previousStatus: prev?.status,
    });
  }
  const totals = { ok: 0, overflow: 0, skipped: 0, error: 0 };
  for (const r of manifest.results) totals[r.status] = (totals[r.status] ?? 0) + 1;
  const payload = {
    runId,
    generatedAt: manifest.generatedAt,
    previousRunAt: manifest.previousGeneratedAt ?? null,
    baseUrl: manifest.baseUrl,
    publicUrl: process.env.RESPONSIVE_AUDIT_PUBLIC_URL ?? notifyUrl,
    newFailures,
    totals,
  };
  const body = JSON.stringify(payload);
  const { createHmac } = await import("node:crypto");
  const signature = createHmac("sha256", notifySecret).update(body).digest("hex");
  try {
    const res = await fetch(`${notifyUrl.replace(/\/$/, "")}/api/public/audit-notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-audit-signature": signature },
      body,
    });
    const responseBody = await res.text();
    if (!res.ok) {
      console.warn(`Notification POST failed (HTTP ${res.status}): ${responseBody.slice(0, 300)}`);
      return;
    }
    console.log(`Notification dispatched: ${responseBody.slice(0, 300)}`);
  } catch (err) {
    console.warn(`Notification POST error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

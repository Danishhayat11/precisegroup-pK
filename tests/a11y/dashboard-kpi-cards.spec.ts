/**
 * Visual + count regression for the /dashboard KPI area.
 *
 * Guards against two classes of regression:
 *
 *   1. "Duplicate KPI card" — a metric rendered both in DashboardHero and
 *      in the KPI grid, or the same card mounted twice from a stray map().
 *      Enforced by exact-label DOM count assertions.
 *   2. "Silent visual drift" — spacing, ordering, colour, iconography, or
 *      layout of the KPI grid changes without anyone noticing. Enforced by
 *      Playwright's built-in `toHaveScreenshot()` pixel diff against a
 *      committed baseline (`*-snapshots/` alongside this spec).
 *
 * Volatile bits (live PKR numbers, animated progress bars, greeting
 * timestamps) are masked so the diff only trips on meaningful layout /
 * chrome changes. Small AA-rendering jitter is absorbed by
 * `maxDiffPixelRatio`. Update the baseline intentionally with
 * `bunx playwright test tests/a11y/dashboard-kpi-cards.spec.ts --update-snapshots`.
 */
import { test, expect, type Locator } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const OUT_DIR = "/tmp/browser/dashboard-kpi-cards";
fs.mkdirSync(OUT_DIR, { recursive: true });

const KPI_LABELS = [
  "Total Received",
  "Total Pending Balance",
  "Current Overdue Amount",
] as const;

test.use({
// SNAPSHOT_VIEWPORT is the single source of truth for the KPI-diff
// viewport. Pinning it here (rather than relying on the config default)
// means the baseline is reproducible even if playwright.config.ts changes
// its default viewport later. Width picks the `xl:grid-cols-4` breakpoint
// so all seven KPI tiles sit on one row.
const SNAPSHOT_VIEWPORT = { width: 1280, height: 1800 } as const;
// Locking `deviceScaleFactor: 1` is what actually stabilises the pixel
// output. WebKit/Chromium default to `1` on Linux CI but Playwright will
// happily honour whatever the config or a parent describe sets, so we
// nail it down at the spec level and re-assert it at capture time.
const SNAPSHOT_DPR = 1;

test.use({
  viewport: SNAPSHOT_VIEWPORT,
  deviceScaleFactor: SNAPSHOT_DPR,
  colorScheme: "light",
  reducedMotion: "reduce",
});


/**
 * Locators for the volatile parts of a KPI grid that must be masked out of
 * the pixel diff:
 *   - `.tabular-nums`    → the animated PKR value string
 *   - `.text-muted-foreground` inside a card → the sub-line (e.g.
 *     "5 overdue installments", "42% of sell value") which recomputes each
 *     run
 *   - `[role="progressbar"], .h-1.w-full` → the animated progress rail
 * If Framer Motion has fully settled these are still stable enough for
 * screenshot capture, but keeping them masked means the test is not brittle
 * against real-world data churn on the dev DB.
 */
function volatileMasks(root: Locator): Locator[] {
  return [
    root.locator(".tabular-nums"),
    root.locator(".text-muted-foreground"),
    root.locator("[role='progressbar']"),
    // Animated progress rail — has the shared `h-1 w-full rounded-full`
    // shape in Dashboard.tsx. Match on the container so both the rail and
    // its inner motion.div are masked as one region.
    root.locator("div.h-1.w-full.rounded-full"),
  ];
}

test.beforeEach(async ({ page }) => {
  // Seed the Supabase session against the localhost origin before landing
  // on the authenticated dashboard route.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k, v),
      [STORAGE_KEY, SESSION_JSON] as const,
    );
  }
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  // Wait until at least the hero + one KPI label are on screen so the
  // count assertions below see stable DOM.
  await page.getByText("Total Received", { exact: true }).first().waitFor({
    state: "visible",
    timeout: 20_000,
  });
  // Allow Framer Motion entrance transitions + progress-bar width tween to
  // finish before any screenshot capture. `reducedMotion: reduce` prevents
  // CSS animation, but Framer's JS-driven tweens ignore the media query;
  // 900ms matches the longest tween in Dashboard.tsx (progress rail).
  await page.waitForTimeout(1200);
});

test("each KPI card renders exactly once above the fold", async ({ page }) => {
  for (const label of KPI_LABELS) {
    const matches = page.getByText(label, { exact: true });
    const count = await matches.count();
    expect(count, `KPI label "${label}" should appear exactly once`).toBe(1);
  }
});

/**
 * Accessibility-name duplication guard.
 *
 * The visible-text count check above trips on repeated label strings, but
 * it is fragile against two real-world scenarios:
 *   - a card wraps ("Current Overdue<br/>Amount") and the exact-text
 *     matcher stops finding it,
 *   - the label is split across nested spans for typography and only the
 *     accessible name still reads cleanly.
 *
 * The KPI region owns two stable a11y contracts we can assert against
 * directly:
 *   1. Exactly one heading names the KPI region — the sr-only "KPI Summary"
 *      <h2> in Dashboard.tsx. Two of them = the whole grid was duplicated.
 *   2. Every KPI tile is a <button> with `aria-label="Open drill-down for
 *      <label>"`. Each aria-label must appear exactly once across the
 *      whole page, independent of how the visible text wraps or renders.
 *
 * These assertions are the load-bearing duplicate-render guard; the text
 * count check stays as a secondary signal.
 */
test("KPI region and cards expose unique, stable a11y names", async ({ page }) => {
  // 1. Region heading: exactly one accessible-name match for "KPI Summary".
  //    `getByRole('heading', { name: ... })` matches on the computed
  //    accessible name, so it works even if the heading text is split
  //    across nested spans or has whitespace collapsed.
  const kpiHeading = page.getByRole("heading", { name: "KPI Summary", exact: true });
  await expect(
    kpiHeading,
    'Exactly one "KPI Summary" heading must anchor the KPI region',
  ).toHaveCount(1);

  // 2. Each KPI tile button — assert by accessible name, not visible text.
  //    Every visible label in KPI_LABELS wires to a button whose
  //    aria-label is `Open drill-down for <label>` (see Dashboard.tsx).
  for (const label of KPI_LABELS) {
    const button = page.getByRole("button", {
      name: `Open drill-down for ${label}`,
      exact: true,
    });
    await expect(
      button,
      `Exactly one KPI button must expose aria-label ` +
        `"Open drill-down for ${label}" (found duplicate render)`,
    ).toHaveCount(1);
  }

  // 3. Cross-check: the set of KPI-button accessible names on the page is
  //    unique. Catches a future regression where two different cards
  //    accidentally share an aria-label (e.g. copy/paste from another
  //    tile) — the per-label check above wouldn't notice.
  const allKpiButtonNames = await page
    .getByRole("button", { name: /^Open drill-down for / })
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label") ?? ""));
  const dupes = allKpiButtonNames.filter(
    (name, i) => allKpiButtonNames.indexOf(name) !== i,
  );
  expect(
    dupes,
    `KPI button aria-labels must be unique; duplicates: ${JSON.stringify(dupes)}`,
  ).toEqual([]);
});

/**
 * Responsive guard: the same "exactly once, above the fold" contract must
 * hold on the two breakpoints the CSS grid actually reflows at
 * (`sm:grid-cols-2`, `lg:grid-cols-3`, `xl:grid-cols-4` in Dashboard.tsx).
 * A regression that duplicates or hides a KPI only at tablet/mobile width
 * — e.g. a `hidden md:block` sibling that leaks the same label, or a
 * responsive card getting pushed below the initial viewport — must fail
 * this test, not slip through the 1280-wide default.
 *
 * "Above the fold" = the card's bounding box starts within the initial
 * viewport height (no scroll needed to see the label). We check the label
 * element's top edge because the whole card is anchored to it.
 */
const RESPONSIVE_VIEWPORTS = [
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 }, // iPhone 14 logical size
] as const;

for (const vp of RESPONSIVE_VIEWPORTS) {
  test.describe(`@${vp.name} (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`each KPI card renders exactly once above the fold on ${vp.name}`, async ({
      page,
    }) => {
      for (const label of KPI_LABELS) {
        const matches = page.getByText(label, { exact: true });
        const count = await matches.count();
        expect(
          count,
          `[${vp.name}] KPI label "${label}" should appear exactly once`,
        ).toBe(1);

        // Above-the-fold check: without any scroll, the label's top edge
        // must sit within the initial viewport. Use the raw bounding box
        // rather than `isInViewport()` — the latter tolerates any overlap,
        // which would pass even for a card whose label is 900px down the
        // page. We want strict "no scroll needed".
        const box = await matches.first().boundingBox();
        expect(
          box,
          `[${vp.name}] KPI label "${label}" must have a layout box`,
        ).not.toBeNull();
        expect(
          box!.y,
          `[${vp.name}] KPI label "${label}" must start above the fold ` +
            `(top=${box!.y}px, viewport=${vp.height}px)`,
        ).toBeLessThan(vp.height);
      }
    });
  });
}


test("KPI grid matches committed pixel baseline", async ({ page }, testInfo) => {
  // Re-lock viewport + DPR at capture time. Belt-and-braces against a
  // parent `test.use()`, a projects override in playwright.config.ts, or
  // a future `page.setViewportSize()` from a shared fixture silently
  // resizing the page before the diff runs.
  await page.setViewportSize({
    width: SNAPSHOT_VIEWPORT.width,
    height: SNAPSHOT_VIEWPORT.height,
  });
  const { innerWidth, innerHeight, dpr } = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));
  expect(innerWidth, "viewport width must be locked for pixel diff").toBe(
    SNAPSHOT_VIEWPORT.width,
  );
  expect(innerHeight, "viewport height must be locked for pixel diff").toBe(
    SNAPSHOT_VIEWPORT.height,
  );
  expect(dpr, "devicePixelRatio must be locked for pixel diff").toBe(SNAPSHOT_DPR);

  const kpiCard = page.getByText("Total Received", { exact: true }).first();
  await kpiCard.scrollIntoViewIfNeeded();
  const grid = kpiCard.locator(
    "xpath=ancestor::*[contains(@class,'grid') and contains(@class,'gap-')][1]",
  );
  await expect(grid).toBeVisible();

  // Human-readable audit artifact — kept alongside CI traces so a reviewer
  // can eyeball the raw grid whenever the pixel-diff assertion fails.
  await grid.screenshot({ path: path.join(OUT_DIR, "kpi-grid.png") });

  // Pixel-diff assertion. Baseline is committed under
  // `tests/a11y/dashboard-kpi-cards.spec.ts-snapshots/` and MUST be
  // regenerated intentionally when the design changes:
  //   bunx playwright test tests/a11y/dashboard-kpi-cards.spec.ts \
  //     --update-snapshots
  await expect(grid).toHaveScreenshot(`kpi-grid-${testInfo.project.name}.png`, {
    // Absorb sub-pixel AA jitter between runs / GPU drivers without
    // hiding real layout regressions. ~1% of a ~1240x260 grid ≈ 3200 px.
    maxDiffPixelRatio: 0.01,
    // Solid grey rectangles over the volatile regions — keeps the diff
    // focused on structural chrome (labels, icons, spacing, colour bands).
    mask: volatileMasks(grid),
    animations: "disabled",
    // Anti-alias mode gives more consistent output across engines than the
    // default `device` mode when we ship a single baseline per project.
    scale: "css",
  });
});

test("DashboardHero band contains no KPI labels", async ({ page }, testInfo) => {
  // The hero band exposes aria-label="Dashboard overview". Any KPI label
  // appearing inside it means the dedupe regressed.
  const hero = page.getByRole("region", { name: /dashboard overview/i });
  await expect(hero).toBeVisible();
  for (const label of KPI_LABELS) {
    await expect(
      hero.getByText(label, { exact: true }),
      `Hero must not render KPI label "${label}"`,
    ).toHaveCount(0);
  }
  await hero.screenshot({ path: path.join(OUT_DIR, "hero.png") });

  // Pixel-diff the hero chrome too — masks the greeting timestamp and any
  // live counters so only structural regressions (a KPI label leaking back
  // in, layout collapse) will fail this assertion.
  await expect(hero).toHaveScreenshot(`hero-${testInfo.project.name}.png`, {
    maxDiffPixelRatio: 0.01,
    mask: volatileMasks(hero),
    animations: "disabled",
    scale: "css",
  });
});


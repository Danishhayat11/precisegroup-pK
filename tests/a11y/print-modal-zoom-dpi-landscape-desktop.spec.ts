/**
 * End-to-end regression: extends print-modal-zoom-dpi.spec.ts coverage
 * beyond portrait mobile to two additional viewports where the
 * auto-fit math has historically drifted:
 *
 *   - **Landscape mobile** (844×390): the preview container is now
 *     wider than tall, so the fit tick flips from width-bound to
 *     height-bound. Any code path that assumes width dominates (or
 *     caches a portrait aspect) regresses here first.
 *   - **Desktop** (1440×900): a wide container with abundant vertical
 *     room. Bugs where the sheet under-scales (e.g. dividing by
 *     device pixels instead of CSS pixels on hi-DPI) show up as
 *     visibleRatio dropping below the floor even though there's
 *     ample space.
 *
 * Each viewport is swept across the same axes as the portrait-mobile
 * suite:
 *   - browser-zoom ∈ { 0.9, 1.25 } via `document.documentElement.style.zoom`
 *   - devicePixelRatio ∈ { 2, 3 } via `test.use({ deviceScaleFactor })`
 *
 * Contracts (per viewport × zoom/DPR case):
 *   1. Short receipt renders exactly one .pp-sheet with visibleRatio
 *      ≥ MIN_VISIBLE_RATIO inside its scroller.
 *   2. Long receipt paginates into ≥ 2 sheets, the first still fits,
 *      and the "Ready · N page(s)" chip count matches the DOM sheet
 *      count (no desync from the DPI/zoom-driven reflow).
 *
 * Run:  bunx playwright test tests/a11y/print-modal-zoom-dpi-landscape-desktop.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const MIN_VISIBLE_RATIO = 0.5;

const VIEWPORTS = [
  { label: "landscape mobile", viewport: { width: 844, height: 390 } },
  { label: "desktop", viewport: { width: 1440, height: 900 } },
] as const;

type ZoomCase = { kind: "zoom"; label: string; cssZoom: number };
type DprCase = { kind: "dpr"; label: string; dpr: number };
type Case = ZoomCase | DprCase;

const CASES: readonly Case[] = [
  { kind: "zoom", label: "browser zoom 90%", cssZoom: 0.9 },
  { kind: "zoom", label: "browser zoom 125%", cssZoom: 1.25 },
  { kind: "dpr", label: "devicePixelRatio 2 (Retina)", dpr: 2 },
  { kind: "dpr", label: "devicePixelRatio 3 (hi-DPI)", dpr: 3 },
] as const;

async function measureFirstSheet(page: Page): Promise<{
  visibleRatio: number;
  sheetWidth: number;
  containerWidth: number;
  sheetCount: number;
  dpr: number;
}> {
  return page.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll<HTMLElement>(".pp-sheet"));
    const sheet = sheets[0] ?? null;
    const dpr = window.devicePixelRatio;
    if (!sheet) return { visibleRatio: 0, sheetWidth: 0, containerWidth: 0, sheetCount: 0, dpr };
    let container: HTMLElement | null = sheet.parentElement;
    while (container && container !== document.body) {
      const oy = getComputedStyle(container).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      container = container.parentElement;
    }
    if (!container)
      return { visibleRatio: 0, sheetWidth: 0, containerWidth: 0, sheetCount: sheets.length, dpr };
    const s = sheet.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const w = Math.max(0, Math.min(s.right, c.right) - Math.max(s.left, c.left));
    const h = Math.max(0, Math.min(s.bottom, c.bottom) - Math.max(s.top, c.top));
    const overlap = w * h;
    const sheetArea = Math.max(1, s.width * s.height);
    return {
      visibleRatio: overlap / sheetArea,
      sheetWidth: s.width,
      containerWidth: c.width,
      sheetCount: sheets.length,
      dpr,
    };
  });
}

async function openWithCase(page: Page, doc: string, c: Case) {
  await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

  if (c.kind === "zoom") {
    await page.evaluate((z: number) => {
      (document.documentElement.style as unknown as { zoom: string }).zoom = String(z);
    }, c.cssZoom);
  }

  await page.getByTestId("open-modal").click();
  await expect(page.locator(".pp-sheet").first()).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /Ready/ }).first(),
  ).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(300);
}

for (const vp of VIEWPORTS) {
  for (const c of CASES) {
    const contextViewport = {
      viewport: vp.viewport,
      colorScheme: "light" as const,
      reducedMotion: "reduce" as const,
      ...(c.kind === "dpr" ? { deviceScaleFactor: c.dpr } : {}),
    };

    test.describe(`PrintPreviewModal — auto-fit @ ${vp.label} (${c.label})`, () => {
      test.use(contextViewport);

      test("short receipt: single sheet still fits the container", async ({ page }) => {
        await openWithCase(page, "short-receipt", c);

        const m = await measureFirstSheet(page);
        if (c.kind === "dpr") {
          expect(
            m.dpr,
            `[${vp.label} / ${c.label}] devicePixelRatio override did not take effect`,
          ).toBe(c.dpr);
        }
        expect(
          m.sheetCount,
          `[${vp.label} / ${c.label}] short receipt should render exactly 1 page`,
        ).toBe(1);
        expect(
          m.visibleRatio,
          `[${vp.label} / ${c.label}] short-receipt sheet should overlap the container by ≥ ${MIN_VISIBLE_RATIO}, got ${m.visibleRatio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);
      });

      test("long receipt: paginates, first sheet fits, page count stays in sync", async ({
        page,
      }) => {
        await openWithCase(page, "long-receipt", c);

        const m = await measureFirstSheet(page);
        if (c.kind === "dpr") {
          expect(
            m.dpr,
            `[${vp.label} / ${c.label}] devicePixelRatio override did not take effect`,
          ).toBe(c.dpr);
        }
        expect(
          m.sheetCount,
          `[${vp.label} / ${c.label}] long-receipt should paginate into ≥ 2 pages, got ${m.sheetCount}`,
        ).toBeGreaterThanOrEqual(2);
        expect(
          m.visibleRatio,
          `[${vp.label} / ${c.label}] long-receipt first page should overlap the container by ≥ ${MIN_VISIBLE_RATIO}, got ${m.visibleRatio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);

        const status = page
          .locator('[role="status"][aria-live="polite"]')
          .filter({ hasText: /Ready · \d+ page/i })
          .first();
        const text = ((await status.textContent()) ?? "").trim();
        const match = text.match(/Ready · (\d+) page/i);
        expect(
          match,
          `[${vp.label} / ${c.label}] expected "Ready · N page(s)" chip, got "${text}"`,
        ).not.toBeNull();
        expect(
          Number(match![1]),
          `[${vp.label} / ${c.label}] chip page count (${match![1]}) must match DOM sheet count (${m.sheetCount})`,
        ).toBe(m.sheetCount);
      });
    });
  }
}

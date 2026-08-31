/**
 * End-to-end regression: <PrintPreviewModal>'s auto-fit math reads
 * `clientWidth`/`clientHeight` from the preview scroller and divides
 * by the sheet's CSS-pixel dimensions. Two things can silently break
 * that on real user machines:
 *
 *   - **Browser zoom** (Ctrl +/-) rescales the CSS pixel grid. If the
 *     fit code caches a size, or uses layout units that don't respond
 *     to zoom, the sheet ends up over- or under-sized after the user
 *     zooms in / out. Simulated here by writing `document.documentElement.style.zoom`
 *     before opening the modal — Chromium's CSS `zoom` is the closest
 *     scriptable analogue to the Ctrl +/- gesture and drives the same
 *     layout path.
 *
 *   - **High-DPI screens** (`devicePixelRatio` 2× / 3× — Retina, most
 *     phones). If any measurement mixes device pixels with CSS pixels,
 *     the sheet scales wrong on hi-DPI. Playwright exposes this via
 *     the browser context's `deviceScaleFactor`.
 *
 * The spec sweeps both axes at both content-length extremes:
 *   - browser-zoom ∈ { 0.9, 1.25 } on portrait mobile (390×844) at DPR 1
 *   - DPR ∈ { 2, 3 } on portrait mobile at zoom 1.0
 *
 * Contracts (per zoom / DPR case):
 *   1. Short receipt renders exactly one .pp-sheet whose visibility
 *      ratio inside the container is ≥ MIN_VISIBLE_RATIO.
 *   2. Long receipt paginates into ≥ 2 sheets, the first still fits,
 *      and the "Ready · N page(s)" chip reports the same N as the DOM.
 *
 * Run:  bunx playwright test tests/a11y/print-modal-zoom-dpi.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const MIN_VISIBLE_RATIO = 0.5;
const MOBILE_VIEWPORT = { width: 390, height: 844 };

type ZoomCase = { kind: "zoom"; label: string; cssZoom: number };
type DprCase = { kind: "dpr"; label: string; dpr: number };
type Case = ZoomCase | DprCase;

const CASES: readonly Case[] = [
  { kind: "zoom", label: "browser zoom 90%", cssZoom: 0.9 },
  { kind: "zoom", label: "browser zoom 125%", cssZoom: 1.25 },
  { kind: "dpr", label: "devicePixelRatio 2 (Retina)", dpr: 2 },
  { kind: "dpr", label: "devicePixelRatio 3 (hi-DPI phone)", dpr: 3 },
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

  // Apply the CSS-zoom analogue BEFORE opening the modal so the very
  // first fit tick sees the zoomed layout, matching a user who opens
  // the modal with their browser already zoomed.
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
  // ResizeObserver may fire once more after `Ready`; wait for stable layout.
  await page.waitForTimeout(300);
}

for (const c of CASES) {
  // DPR is a browser-context property, so we can only override it via
  // test.use({ deviceScaleFactor }). Zoom is applied at runtime.
  const contextViewport = {
    viewport: MOBILE_VIEWPORT,
    colorScheme: "light" as const,
    reducedMotion: "reduce" as const,
    ...(c.kind === "dpr" ? { deviceScaleFactor: c.dpr } : {}),
  };

  test.describe(`PrintPreviewModal — auto-fit under DPI/zoom (${c.label})`, () => {
    test.use(contextViewport);

    test("short receipt: single sheet still fits the container", async ({ page }) => {
      await openWithCase(page, "short-receipt", c);

      const m = await measureFirstSheet(page);
      if (c.kind === "dpr") {
        expect(m.dpr, `[${c.label}] devicePixelRatio override did not take effect`).toBe(c.dpr);
      }
      expect(m.sheetCount, `[${c.label}] short receipt should render exactly 1 page`).toBe(1);
      expect(
        m.visibleRatio,
        `[${c.label}] short-receipt sheet should overlap the container by ≥ ${MIN_VISIBLE_RATIO} at ${c.label}, got ${m.visibleRatio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);
    });

    test("long receipt: paginates and the first sheet still fits, page count stays in sync", async ({
      page,
    }) => {
      await openWithCase(page, "long-receipt", c);

      const m = await measureFirstSheet(page);
      if (c.kind === "dpr") {
        expect(m.dpr, `[${c.label}] devicePixelRatio override did not take effect`).toBe(c.dpr);
      }
      expect(
        m.sheetCount,
        `[${c.label}] long-receipt should paginate into ≥ 2 pages, got ${m.sheetCount}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        m.visibleRatio,
        `[${c.label}] long-receipt first page should overlap the container by ≥ ${MIN_VISIBLE_RATIO}, got ${m.visibleRatio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_RATIO);

      // Chip count must equal DOM sheet count — DPR/zoom must not
      // desync pagination measurement from the announcement.
      const status = page
        .locator('[role="status"][aria-live="polite"]')
        .filter({ hasText: /Ready · \d+ page/i })
        .first();
      const text = ((await status.textContent()) ?? "").trim();
      const match = text.match(/Ready · (\d+) page/i);
      expect(match, `[${c.label}] expected "Ready · N page(s)" chip, got "${text}"`).not.toBeNull();
      expect(
        Number(match![1]),
        `[${c.label}] chip page count (${match![1]}) must match DOM sheet count (${m.sheetCount})`,
      ).toBe(m.sheetCount);
    });
  });
}

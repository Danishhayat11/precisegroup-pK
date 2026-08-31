/**
 * Numeric layout-metrics regression for <PrintPreviewModal>.
 *
 * The visual spec (`print-modal-zoom-dpi-visual.spec.ts`) catches
 * pixel-level drift, but a bad regression can also express itself as
 * *invisible* clipping — a sheet whose scrollHeight exceeds its
 * clientHeight (content spilling past the page edge that pagination
 * should have moved to the next sheet), or a descendant element whose
 * right edge extends past the sheet's right edge (horizontal overflow
 * hidden by `overflow: hidden` but still a print-fidelity bug).
 *
 * For every zoom/DPR case and every rendered `.pp-sheet` this spec
 * asserts:
 *
 *   1. **Non-zero geometry:** width > 0 and height > 0. A collapsed
 *      sheet passes the visual diff (blank raster == blank baseline)
 *      but is a real bug.
 *   2. **No internal vertical clipping:** `scrollHeight <= clientHeight
 *      + CLIP_TOLERANCE_PX`. If the pagination code drops a row, the
 *      sheet's own scrollHeight grows past its box.
 *   3. **No internal horizontal clipping:** `scrollWidth <= clientWidth
 *      + CLIP_TOLERANCE_PX`. Same story on the horizontal axis; a
 *      wide table or long unbreakable string would trip this.
 *   4. **No descendant overflows the sheet's right edge:** every
 *      element inside the sheet has `getBoundingClientRect().right <=
 *      sheet.right + CLIP_TOLERANCE_PX`. Complements #3 by catching
 *      absolutely-positioned children (letterhead badges, watermarks)
 *      that escape the normal-flow scrollWidth check.
 *   5. **Consistent sheet width across pages** (long receipt): the
 *      widest and narrowest `.pp-sheet` differ by ≤ WIDTH_VARIANCE_PX.
 *      Every fitted page must share the same scaled width or the
 *      preview looks broken.
 *
 * CLIP_TOLERANCE_PX is 1 px to swallow sub-pixel rounding on hi-DPI
 * without accepting real overflow. WIDTH_VARIANCE_PX is 1 px for the
 * same reason.
 *
 * Run:  bunx playwright test tests/a11y/print-modal-zoom-dpi-layout-metrics.spec.ts
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const CLIP_TOLERANCE_PX = 1;
const WIDTH_VARIANCE_PX = 1;
/**
 * Directory the CI workflow scans to build the `$GITHUB_STEP_SUMMARY`
 * markdown table. One JSON file per (browser, case, doc) — written on
 * success AND failure so the summary always shows the measured values,
 * not just the failing ones.
 */
const SUMMARY_DIR = join(process.cwd(), "test-results", "layout-metrics-summary");

type ZoomCase = { kind: "zoom"; slug: string; label: string; cssZoom: number };
type DprCase = { kind: "dpr"; slug: string; label: string; dpr: number };
type Case = ZoomCase | DprCase;

const CASES: readonly Case[] = [
  { kind: "zoom", slug: "zoom-090", label: "browser zoom 90%", cssZoom: 0.9 },
  { kind: "zoom", slug: "zoom-125", label: "browser zoom 125%", cssZoom: 1.25 },
  { kind: "dpr", slug: "dpr-2", label: "devicePixelRatio 2 (Retina)", dpr: 2 },
  { kind: "dpr", slug: "dpr-3", label: "devicePixelRatio 3 (hi-DPI phone)", dpr: 3 },
] as const;

type SheetMetrics = {
  index: number;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  /** worst descendant overflow in px past the sheet's right edge (>= 0) */
  worstRightOverflowPx: number;
  /** tag+class of the worst overflower, for failure messages */
  worstRightOverflowElement: string | null;
};

async function measureAllSheets(page: Page): Promise<SheetMetrics[]> {
  return page.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll<HTMLElement>(".pp-sheet"));
    return sheets.map((sheet, index) => {
      const rect = sheet.getBoundingClientRect();
      let worstRightOverflowPx = 0;
      let worstRightOverflowElement: string | null = null;
      const descendants = sheet.querySelectorAll<HTMLElement>("*");
      descendants.forEach((el) => {
        // Skip elements that are display:none (rect will be 0-sized).
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const overflow = r.right - rect.right;
        if (overflow > worstRightOverflowPx) {
          worstRightOverflowPx = overflow;
          const cls =
            el.className && typeof el.className === "string"
              ? `.${el.className.split(/\s+/).slice(0, 2).join(".")}`
              : "";
          worstRightOverflowElement = `${el.tagName.toLowerCase()}${cls}`;
        }
      });
      return {
        index,
        width: rect.width,
        height: rect.height,
        scrollWidth: sheet.scrollWidth,
        scrollHeight: sheet.scrollHeight,
        clientWidth: sheet.clientWidth,
        clientHeight: sheet.clientHeight,
        worstRightOverflowPx,
        worstRightOverflowElement,
      };
    });
  });
}

async function bringSheetIntoView(page: Page, index: number) {
  await page.evaluate((i: number) => {
    const s = document.querySelectorAll<HTMLElement>(".pp-sheet")[i];
    if (!s) return;
    s.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
  }, index);
  await page.waitForTimeout(150);
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

/** Shared per-sheet assertions used by both short and long receipt tests. */
function assertNoClipping(label: string, m: SheetMetrics) {
  expect(m.width, `[${label}] sheet #${m.index + 1} width must be > 0`).toBeGreaterThan(0);
  expect(m.height, `[${label}] sheet #${m.index + 1} height must be > 0`).toBeGreaterThan(0);

  const vClip = m.scrollHeight - m.clientHeight;
  expect(
    vClip,
    `[${label}] sheet #${m.index + 1} vertical clipping: scrollHeight=${m.scrollHeight} > clientHeight=${m.clientHeight} (over by ${vClip}px). Pagination should have flowed this content to the next page.`,
  ).toBeLessThanOrEqual(CLIP_TOLERANCE_PX);

  const hClip = m.scrollWidth - m.clientWidth;
  expect(
    hClip,
    `[${label}] sheet #${m.index + 1} horizontal clipping: scrollWidth=${m.scrollWidth} > clientWidth=${m.clientWidth} (over by ${hClip}px).`,
  ).toBeLessThanOrEqual(CLIP_TOLERANCE_PX);

  expect(
    m.worstRightOverflowPx,
    `[${label}] sheet #${m.index + 1}: descendant "${m.worstRightOverflowElement ?? "?"}" extends ${m.worstRightOverflowPx.toFixed(2)}px past the sheet's right edge.`,
  ).toBeLessThanOrEqual(CLIP_TOLERANCE_PX);
}

for (const c of CASES) {
  const contextViewport = {
    viewport: MOBILE_VIEWPORT,
    colorScheme: "light" as const,
    reducedMotion: "reduce" as const,
    ...(c.kind === "dpr" ? { deviceScaleFactor: c.dpr } : {}),
  };

  test.describe(`PrintPreviewModal — layout metrics (${c.label})`, () => {
    test.use(contextViewport);

    test("short receipt: single sheet has no clipping and non-zero geometry", async ({
      page,
    }, testInfo) => {
      await openWithCase(page, "short-receipt", c);
      const metrics = await measureAllSheets(page);
      let sheetCountOk = true;
      try {
        expect(metrics.length, `[${c.label}] expected 1 sheet, got ${metrics.length}`).toBe(1);
      } catch (err) {
        sheetCountOk = false;
        writeSummaryRecord(testInfo, c, "short-receipt", metrics, {
          sheetCountOk,
          expectedSheets: 1,
        });
        throw err;
      }
      try {
        await runSheetCheck(testInfo, page, c.label, c.slug, metrics.length, metrics[0]!);
      } finally {
        writeSummaryRecord(testInfo, c, "short-receipt", metrics, {
          sheetCountOk,
          expectedSheets: 1,
        });
      }
    });

    test("long receipt: every sheet has no clipping and pages share the same fitted width", async ({
      page,
    }, testInfo) => {
      await openWithCase(page, "long-receipt", c);

      const initial = await page.locator(".pp-sheet").count();
      expect(
        initial,
        `[${c.label}] long-receipt must paginate to ≥ 2 pages`,
      ).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < initial; i += 1) {
        await bringSheetIntoView(page, i);
      }
      await bringSheetIntoView(page, 0);
      const metrics = await measureAllSheets(page);

      try {
        expect(
          metrics.length,
          `[${c.label}] sheet count changed after scroll walk (was ${initial}, now ${metrics.length})`,
        ).toBe(initial);

        for (const m of metrics) {
          await runSheetCheck(testInfo, page, c.label, c.slug, metrics.length, m);
        }

        const widths = metrics.map((m) => m.width);
        const spread = Math.max(...widths) - Math.min(...widths);
        try {
          expect(
            spread,
            `[${c.label}] fitted-sheet width variance across ${metrics.length} pages is ${spread.toFixed(2)}px (min=${Math.min(...widths).toFixed(2)}, max=${Math.max(...widths).toFixed(2)}). All pages must share the same fitted width.`,
          ).toBeLessThanOrEqual(WIDTH_VARIANCE_PX);
        } catch (err) {
          await testInfo.attach(`width-spread-${c.slug}.json`, {
            contentType: "application/json",
            body: Buffer.from(JSON.stringify({ case: c.label, widths, spread }, null, 2)),
          });
          throw err;
        }
      } finally {
        writeSummaryRecord(testInfo, c, "long-receipt", metrics, {
          sheetCountOk: true,
          expectedSheets: initial,
        });
      }
    });
  });
}

/**
 * Write a single JSON record summarizing this (browser, case, doc)
 * run's measured metrics. The CI workflow aggregates every record in
 * `test-results/layout-metrics-summary/` into a `$GITHUB_STEP_SUMMARY`
 * markdown table so reviewers can spot regressions (fitted height/width
 * drift, growing clip/overflow deltas) at a glance without opening the
 * HTML report. Emitted on success AND failure — the file is the source
 * of truth for the CI summary.
 */
function writeSummaryRecord(
  testInfo: TestInfo,
  c: Case,
  doc: "short-receipt" | "long-receipt",
  metrics: SheetMetrics[],
  extras: { sheetCountOk: boolean; expectedSheets: number },
) {
  try {
    mkdirSync(SUMMARY_DIR, { recursive: true });
    const widths = metrics.map((m) => m.width);
    const heights = metrics.map((m) => m.height);
    const worstVClipPx = metrics.reduce(
      (max, m) => Math.max(max, m.scrollHeight - m.clientHeight),
      0,
    );
    const worstHClipPx = metrics.reduce(
      (max, m) => Math.max(max, m.scrollWidth - m.clientWidth),
      0,
    );
    const worstRightOverflowPx = metrics.reduce(
      (max, m) => Math.max(max, m.worstRightOverflowPx),
      0,
    );
    const worstRightOverflowSheet =
      metrics.find(
        (m) => m.worstRightOverflowPx === worstRightOverflowPx && worstRightOverflowPx > 0,
      )?.index ?? null;
    const widthSpread = widths.length ? Math.max(...widths) - Math.min(...widths) : 0;
    const record = {
      browser: testInfo.project.name,
      caseSlug: c.slug,
      caseLabel: c.label,
      doc,
      status: testInfo.status ?? "unknown",
      sheetCount: metrics.length,
      expectedSheets: extras.expectedSheets,
      sheetCountOk: extras.sheetCountOk,
      fittedWidthPx: {
        min: widths.length ? Math.min(...widths) : 0,
        max: widths.length ? Math.max(...widths) : 0,
        spread: widthSpread,
      },
      fittedHeightPx: {
        min: heights.length ? Math.min(...heights) : 0,
        max: heights.length ? Math.max(...heights) : 0,
      },
      worstVerticalClipPx: worstVClipPx,
      worstHorizontalClipPx: worstHClipPx,
      worstRightOverflowPx,
      worstRightOverflowSheet, // 0-indexed sheet, or null if no overflow
      clipTolerancePx: CLIP_TOLERANCE_PX,
      widthVariancePx: WIDTH_VARIANCE_PX,
      perSheet: metrics.map((m) => ({
        page: m.index + 1,
        width: m.width,
        height: m.height,
        vClipPx: m.scrollHeight - m.clientHeight,
        hClipPx: m.scrollWidth - m.clientWidth,
        rightOverflowPx: m.worstRightOverflowPx,
        rightOverflowElement: m.worstRightOverflowElement,
      })),
      // Full, unabridged per-sheet metrics so downstream tooling
      // (--summary-json aggregator, replay/audit scripts) can reconstruct
      // the run without going back to the Playwright artifacts. `perSheet`
      // above is the reviewer-friendly derived view; `rawMetrics` is the
      // authoritative source captured straight from the DOM.
      rawMetrics: metrics,
      capturedAt: new Date().toISOString(),
      schemaVersion: 2,
    };
    const file = join(SUMMARY_DIR, `${testInfo.project.name}__${c.slug}__${doc}.json`);
    writeFileSync(file, JSON.stringify(record, null, 2));
  } catch {
    // Never let summary bookkeeping fail the test.
  }
}

/**
 * Wrap a single sheet's assertion block in a `test.step` so the trace
 * has a named entry per sheet. On failure, attach:
 *   - An element screenshot of the offending sheet (`sheet-<slug>-page-<n>.png`)
 *   - The raw metrics JSON (`sheet-<slug>-page-<n>.json`)
 * Both land in the CI trace artifact and are shown next to the failing
 * step in the HTML report — reviewers can identify which page regressed
 * without downloading the full trace.
 */

async function runSheetCheck(
  testInfo: TestInfo,
  page: Page,
  label: string,
  slug: string,
  totalSheets: number,
  m: SheetMetrics,
) {
  const pageNo = m.index + 1;
  await test.step(`sheet ${pageNo} of ${totalSheets}`, async () => {
    try {
      assertNoClipping(label, m);
    } catch (err) {
      // Attach a targeted screenshot of just the failing sheet.
      const attachmentName = `sheet-${slug}-page-${pageNo}-of-${totalSheets}`;
      try {
        const png = await page.locator(".pp-sheet").nth(m.index).screenshot();
        await testInfo.attach(`${attachmentName}.png`, {
          contentType: "image/png",
          body: png,
        });
      } catch {
        // Screenshot capture itself can fail if the sheet detached; the
        // failure re-throw below still surfaces the original error.
      }
      await testInfo.attach(`${attachmentName}.json`, {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify(m, null, 2)),
      });
      throw err;
    }
  });
}

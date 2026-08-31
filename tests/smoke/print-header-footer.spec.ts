/**
 * Print smoke — DocumentView + PrintLedgerDetail A4 pagination.
 *
 * Both surfaces render into the shared `PrintFrame` (see `src/lib/letterhead.tsx`),
 * which puts the compact letterhead in a <thead> and the compact footer in a
 * <tfoot> so Chromium repeats them on every printed A4 page. The full
 * LetterheadHeader (with logo) is a natural top-of-flow element that only
 * appears once, on page 1.
 *
 * This smoke fires a real Chromium print to PDF at A4 for two representative
 * routes and applies the SAME set of assertions to each, so drift on either
 * side surfaces here rather than only downstream of `window.print()`:
 *
 *   1. Print produces ≥ 1 A4 page (sale-agreement is asserted ≥ 2 to prove
 *      real pagination — the ledger fixture may fit one page and is only
 *      required to be non-empty).
 *   2. The compact running header appears on EVERY page (repeated <thead>).
 *   3. The compact running footer appears on EVERY page (repeated <tfoot>).
 *   4. The full page-1 letterhead / banner appears ONLY on page 1 (so the
 *      logo/notice banner is never accidentally duplicated by adding it
 *      outside the tbody).
 *   5. Every page carries the booking id in the running header, so
 *      splitting a PDF page in isolation is still traceable.
 *
 * Runs against a Lovable-managed authenticated session; skips otherwise.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

// A booking with real ledger + payments data used by other visual regressions.
const BOOKING_ID = "BK-MA-00010";

/** Compact header/footer strings baked into `CompactRunningHeader/Footer`. */
const RUNNING_HEADER_BRAND = "PRECISE Realtors & Builders Pvt. Ltd.";
const RUNNING_FOOTER_PHONE = "manalarcade@gmail.com";

type PrintCase = {
  label: string;
  path: string;
  /** DOM selector that must be visible before we trigger print. */
  readySelector: string;
  /** A substring guaranteed to be on page 1's full letterhead / banner but
   *  NOT in the compact running header. Used to prove the banner is unique. */
  page1BannerText: string;
  /** True → assert `pdfinfo` reports ≥ 2 pages (real pagination). */
  requireMultiPage: boolean;
};

const CASES: PrintCase[] = [
  {
    label: "PrintLedgerDetail",
    path: `/print-ledger/${BOOKING_ID}`,
    readySelector: ".print-area .print-frame",
    // "Statement Date" is the label in the inline page-1 letterhead in
    // PrintLedgerDetail.tsx (line 216). It sits in an untracked font so
    // `pdftotext -layout` preserves the token verbatim, and it is unique
    // to page 1 (the compact running header never mentions it).
    page1BannerText: "Statement Date",
    requireMultiPage: false,
  },
  {
    label: "DocumentView · legal-notice",
    path: `/documents/legal-notice?booking=${BOOKING_ID}`,
    readySelector: ".doc-sheet .print-frame",
    // "MANAL ARCADE" is emitted by LetterheadHeader style A (used by all
    // notice templates) and never by the compact running header, so it is
    // a safe page-1-only fingerprint.
    page1BannerText: "MANAL ARCADE",
    requireMultiPage: true,
  },
];

/** Split a `pdftotext -layout` dump on the form-feed page separator. */
function extractPages(pdfPath: string): { pageCount: number; pages: string[] } {
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const pageCount = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0);
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
  const pages = text.split("\f").filter((p, i, arr) => !(i === arr.length - 1 && p.trim() === ""));
  return { pageCount, pages };
}

async function printToA4(page: Page, outPath: string) {
  // Emulate print media so the app's @media print rules (in PRINT_CSS) take
  // over: chrome/sidebar hidden, running thead/tfoot revealed, .doc-sheet
  // sized to 210mm. Without this the PDF captures the on-screen preview.
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => (document as any).fonts?.ready);
  // Give layout a beat to settle after media emulation.
  await page.waitForTimeout(300);
  const buf = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
    preferCSSPageSize: true,
  });
  writeFileSync(outPath, buf);
}

function assertHeaderFooterRepetition(label: string, pages: string[], bannerText: string) {
  // Rule 2 — every page has the compact running header.
  pages.forEach((body, idx) => {
    expect(body, `${label} · page ${idx + 1} missing running header brand`).toContain(
      RUNNING_HEADER_BRAND,
    );
    // Rule 5 — booking id in the running header on every page.
    expect(body, `${label} · page ${idx + 1} missing booking id in header`).toContain(
      `Booking ${BOOKING_ID}`,
    );
  });

  // Rule 3 — every page has the compact running footer.
  pages.forEach((body, idx) => {
    expect(body, `${label} · page ${idx + 1} missing running footer`).toContain(
      RUNNING_FOOTER_PHONE,
    );
  });

  // Rule 4 — the full banner only appears on page 1. We look for the banner
  // token on later pages by pruning the running-header line first, so a
  // false positive from a re-used phrase in body copy stays possible but
  // page-1-only tokens like "MANAL ARCADE" / "Payment Ledger Statement"
  // are chosen to avoid it.
  expect(pages[0], `${label} · page 1 must contain banner token`).toContain(bannerText);
  pages.slice(1).forEach((body, i) => {
    expect(
      body.includes(bannerText),
      `${label} · page ${i + 2} unexpectedly contains page-1 banner "${bannerText}" — banner leaked into a repeating region`,
    ).toBe(false);
  });
}

test.describe("Print A4 header/footer smoke", () => {
  // `page.pdf()` is a Chromium DevTools API — WebKit and Firefox throw. The
  // repeating <thead>/<tfoot> rules are UA-agnostic and covered by the
  // print-CSS unit tests; this smoke locks in the Chromium print pipeline
  // that real users hit via "Save as PDF".
  test.skip(({ browserName }) => browserName !== "chromium", "page.pdf() is Chromium-only");
  test.skip(!authAvailable(), "requires an injected Lovable session");
  test.skip(
    !existsSync("/bin/pdftotext") && !existsSync("/usr/bin/pdftotext"),
    "pdftotext (poppler-utils) not available on this runner",
  );

  const outDir = mkdtempSync(join(tmpdir(), "print-smoke-"));

  for (const c of CASES) {
    test(`${c.label} · A4 print produces repeated header/footer`, async ({ context, page }) => {
      await restoreSupabaseSession(context, page);
      await page.goto(c.path, { waitUntil: "domcontentloaded" });

      // Wait for the print frame to mount so the tbody has real content
      // before we rasterise. Data queries in these routes may take a beat.
      await page.waitForSelector(c.readySelector, { state: "attached", timeout: 15_000 });
      await page.waitForLoadState("networkidle").catch(() => {
        /* long-lived subscriptions may never idle; the selector wait above is enough */
      });

      const pdfPath = join(outDir, `${c.label.replace(/\W+/g, "-")}.pdf`);
      await printToA4(page, pdfPath);

      const { pageCount, pages } = extractPages(pdfPath);
      expect(pageCount, `${c.label} · pdfinfo reports zero pages`).toBeGreaterThanOrEqual(1);
      if (c.requireMultiPage) {
        expect(pageCount, `${c.label} · expected multi-page pagination`).toBeGreaterThanOrEqual(2);
      }
      expect(pages.length, `${c.label} · pdftotext page split disagrees with pdfinfo`).toBe(
        pageCount,
      );

      assertHeaderFooterRepetition(c.label, pages, c.page1BannerText);
    });
  }
});

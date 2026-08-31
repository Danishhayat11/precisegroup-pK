/**
 * End-to-end regression: after the print round-trip completes, every
 * `aria-live` region and every sonner announcement region in the document
 * must be fully empty. A screen reader landing on the page after print
 * must not hear any stale "Preparing for print…" / "Print ready" /
 * "Loading…" status messages.
 *
 * Covers every printable document type exposed by /test-print-modal so a
 * regression in any single template (or in preparePrint()'s cleanup) is
 * caught.
 *
 * Run:  bunx playwright test tests/a11y/print-live-region-cleanup.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const TOAST_LABEL = "Preparing for print…";
const DOCS = ["receipt", "ledger", "plan", "notice", "statement"] as const;

async function installPrintMock(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __printCalls: number; print: () => void };
    w.__printCalls = 0;
    w.print = () => {
      w.__printCalls += 1;
      window.dispatchEvent(new Event("afterprint"));
    };
  });
}

/**
 * Returns the visible text content of every announcement surface a screen
 * reader could pick up: aria-live regions (polite/assertive/off-but-still
 * announced via role=status/alert), role=status, role=alert, and sonner's
 * own toast + live region containers.
 *
 * Whitespace-only / empty entries are filtered out so we are only asserting
 * on text a screen reader would actually announce.
 */
async function readAnnouncements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selectors = [
      "[aria-live]",
      '[role="status"]',
      '[role="alert"]',
      "[data-sonner-toaster]",
      "[data-sonner-toast]",
      "ol[data-sonner-toaster] li",
    ];
    const nodes = new Set<Element>();
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((n) => nodes.add(n));
    }
    const out: string[] = [];
    nodes.forEach((n) => {
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t.length > 0) out.push(t);
    });
    return out;
  });
}

test.describe("Print round-trip leaves no stale announcements in any live region", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "pp-print-checklist-v1",
          JSON.stringify({ paper: true, margins: true, bg: true, scale: true, headers: true }),
        );
      } catch {
        /* ignore */
      }
    });
  });

  for (const doc of DOCS) {
    test(`aria-live + sonner regions are empty after print for doc="${doc}"`, async ({ page }) => {
      page.on("pageerror", () => {});

      await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "load" });
      await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

      await page.getByTestId("open-modal").click();
      const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
      await expect(printBtn).toBeVisible({ timeout: 15_000 });

      await installPrintMock(page);
      await printBtn.click();

      // Wait for the print mock to have fired (proves preparePrint ran),
      // then for cleanup to remove the runtime style.
      await expect
        .poll(
          async () =>
            page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls),
          { timeout: 5_000 },
        )
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(async () => page.evaluate(() => !!document.getElementById("pp-print-runtime")), {
          timeout: 3_000,
        })
        .toBe(false);

      // Give sonner a tick to flush its exit animation / DOM removal.
      await page.waitForTimeout(400);

      // No announcement region anywhere on the page may still contain the
      // "Preparing for print…" toast text, nor any generic loading copy.
      const announcements = await readAnnouncements(page);
      const stale = announcements.filter((t) =>
        /Preparing for print|Loading\b|Please wait|Printing\b/i.test(t),
      );
      expect(
        stale,
        `stale announcement text remained after print for doc=${doc}: ${JSON.stringify(stale)}`,
      ).toEqual([]);

      // Specifically: no sonner toast row may still carry the print label.
      await expect(
        page.locator("[data-sonner-toast]").filter({ hasText: TOAST_LABEL }),
      ).toHaveCount(0);

      // Sonner's hidden live-region (the one screen readers actually read)
      // must be empty. Sonner renders it as a child of [data-sonner-toaster]
      // with aria-live; assert every aria-live region on the page is empty
      // of textual content.
      const liveRegionTexts = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[aria-live]"))
          .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
          .filter((t) => t.length > 0),
      );
      expect(
        liveRegionTexts,
        `aria-live regions still hold text after print for doc=${doc}`,
      ).toEqual([]);

      // role=status / role=alert nodes must also be empty (sonner uses
      // role=status on individual toasts; a leftover would re-announce
      // on the next focus/landmark navigation).
      const statusAlertTexts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="status"], [role="alert"]'))
          .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
          .filter((t) => t.length > 0),
      );
      expect(
        statusAlertTexts,
        `role=status / role=alert nodes still hold text after print for doc=${doc}`,
      ).toEqual([]);
    });
  }
});

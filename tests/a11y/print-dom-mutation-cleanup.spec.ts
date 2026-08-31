/**
 * End-to-end regression: every DOM mutation `preparePrint()` performs
 * (and any mutation the surrounding print modal performs while the
 * browser print dialog is "open") must be reverted after `afterprint`
 * cleanup, for every printable document type.
 *
 * Strategy: snapshot the "mutation surface" of the document AFTER the
 * modal has opened (so the open-dialog DOM is part of the baseline)
 * but BEFORE the print flow runs. Trigger print + synthetic
 * `afterprint`, then snapshot again. The two snapshots must match.
 *
 * Surfaces snapshotted (covers everything preparePrint touches plus
 * any class/attribute side-effects a future regression might introduce):
 *   - document.title
 *   - <html> attributes + classList
 *   - <body>  attributes + classList
 *   - count of <style> / <link rel=stylesheet> nodes in <head> and in <body>
 *   - id list of every <style id="..."> node (catches pp-print-runtime
 *     and any future temp stylesheet)
 *   - presence of the runtime style id specifically (belt + braces)
 *   - count of [data-sonner-toast] rows (no leftover print toast)
 *
 * Run:  bunx playwright test tests/a11y/print-dom-mutation-cleanup.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
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

type DomSnapshot = {
  title: string;
  htmlAttrs: Record<string, string>;
  htmlClasses: string[];
  bodyAttrs: Record<string, string>;
  bodyClasses: string[];
  headStyleCount: number;
  headLinkStylesheetCount: number;
  bodyStyleCount: number;
  styleIds: string[];
  hasRuntimePrintStyle: boolean;
  sonnerToastCount: number;
};

async function snapshot(page: Page): Promise<DomSnapshot> {
  return page.evaluate((): DomSnapshot => {
    const attrs = (el: Element): Record<string, string> => {
      const o: Record<string, string> = {};
      for (const a of Array.from(el.attributes)) o[a.name] = a.value;
      // class is captured separately as a sorted list to avoid order-only diffs.
      delete o.class;
      return o;
    };
    const classList = (el: Element): string[] => Array.from(el.classList).sort();

    const head = document.head;
    const body = document.body;

    return {
      title: document.title,
      htmlAttrs: attrs(document.documentElement),
      htmlClasses: classList(document.documentElement),
      bodyAttrs: attrs(body),
      bodyClasses: classList(body),
      headStyleCount: head.querySelectorAll("style").length,
      headLinkStylesheetCount: head.querySelectorAll('link[rel="stylesheet"]').length,
      bodyStyleCount: body.querySelectorAll("style").length,
      styleIds: Array.from(document.querySelectorAll("style[id]"))
        .map((n) => (n as HTMLStyleElement).id)
        .sort(),
      hasRuntimePrintStyle: !!document.getElementById("pp-print-runtime"),
      sonnerToastCount: document.querySelectorAll("[data-sonner-toast]").length,
    };
  });
}

test.describe("Print round-trip reverts every DOM mutation it performs", () => {
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
    test(`DOM mutation surface is restored after print for doc="${doc}"`, async ({ page }) => {
      page.on("pageerror", () => {});

      await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "load" });
      await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

      // Open the modal — baseline includes the open Dialog so we are only
      // measuring print-flow mutations, not modal-open mutations.
      await page.getByTestId("open-modal").click();
      const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
      await expect(printBtn).toBeVisible({ timeout: 15_000 });

      // Let any sonner toasts that opened during navigation flush out so
      // they don't pollute the baseline sonnerToastCount.
      await page.waitForTimeout(300);

      const before = await snapshot(page);
      // Sanity: the runtime print style must not be present in the baseline.
      expect(before.hasRuntimePrintStyle).toBe(false);
      expect(before.styleIds).not.toContain("pp-print-runtime");

      await installPrintMock(page);
      await printBtn.click();

      // Wait for the print mock to have fired AND for cleanup to remove
      // the runtime style (the most observable cleanup side-effect).
      await expect
        .poll(
          async () =>
            page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls),
          { timeout: 5_000 },
        )
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(async () => (await snapshot(page)).hasRuntimePrintStyle, {
          timeout: 3_000,
        })
        .toBe(false);

      // Let sonner finish its exit animation before snapshotting.
      await page.waitForTimeout(400);

      const after = await snapshot(page);

      // Per-field diffs first, for readable failure messages, then a
      // full deep-equal as a catch-all for any field we add later.
      expect(after.title, "document.title not restored").toBe(before.title);
      expect(after.htmlAttrs, "<html> attributes drifted").toEqual(before.htmlAttrs);
      expect(after.htmlClasses, "<html> classList drifted").toEqual(before.htmlClasses);
      expect(after.bodyAttrs, "<body> attributes drifted").toEqual(before.bodyAttrs);
      expect(after.bodyClasses, "<body> classList drifted").toEqual(before.bodyClasses);
      expect(after.headStyleCount, "extra <style> tag left in <head> after print").toBe(
        before.headStyleCount,
      );
      expect(
        after.headLinkStylesheetCount,
        "extra <link rel=stylesheet> left in <head> after print",
      ).toBe(before.headLinkStylesheetCount);
      expect(after.bodyStyleCount, "extra <style> tag left in <body> after print").toBe(
        before.bodyStyleCount,
      );
      expect(after.styleIds, "set of <style id=...> nodes changed after print").toEqual(
        before.styleIds,
      );
      expect(after.hasRuntimePrintStyle).toBe(false);
      expect(after.sonnerToastCount, "leftover sonner toast row(s) after print").toBe(
        before.sonnerToastCount,
      );

      // Catch-all: full snapshot equality.
      expect(after).toEqual(before);
    });
  }
});

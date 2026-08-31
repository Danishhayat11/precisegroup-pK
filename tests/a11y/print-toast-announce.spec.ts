/**
 * End-to-end regression: while `preparePrint()` is running, the
 * "Preparing for print…" status must be announceable by screen readers
 * (i.e. live in an `aria-live`-eligible node and exposed on the
 * accessibility tree), and after `afterprint` cleanup it must be gone
 * from BOTH the DOM live regions AND the accessibility tree — for every
 * printable document type.
 *
 * Why both surfaces: a stale node hidden via `display:none`/`opacity:0`
 * but still announced (or vice-versa) is still a screen-reader bug.
 * Playwright's `page.accessibility.snapshot()` is the only API that
 * confirms a node is actually removed from the a11y tree the AT consumes.
 *
 * Run:  bunx playwright test tests/a11y/print-toast-announce.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const TOAST_LABEL = "Preparing for print…";
const DOCS = ["receipt", "ledger", "plan", "notice", "statement"] as const;

/**
 * Mock window.print so it records the call, then dispatches `afterprint`
 * after `delayMs`. The delay gives the test a deterministic observation
 * window in which the toast is still on screen and announceable.
 */
async function installDelayedPrintMock(page: Page, delayMs: number) {
  await page.evaluate((delay) => {
    const w = window as unknown as { __printCalls: number; print: () => void };
    w.__printCalls = 0;
    w.print = () => {
      w.__printCalls += 1;
      window.setTimeout(() => {
        window.dispatchEvent(new Event("afterprint"));
      }, delay);
    };
  }, delayMs);
}

/**
 * Flatten the chromium a11y tree to (role, name) tuples via CDP, since
 * `page.accessibility` is not exposed on every Playwright build.
 */
type AxFlat = { role: string; name: string };
async function getAxFlat(page: Page): Promise<AxFlat[]> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Accessibility.enable");
    const { nodes } = (await session.send("Accessibility.getFullAXTree")) as {
      nodes: Array<{
        role?: { value?: string };
        name?: { value?: string };
        ignored?: boolean;
      }>;
    };
    return nodes
      .filter((n) => !n.ignored)
      .map((n) => ({
        role: String(n.role?.value ?? ""),
        name: String(n.name?.value ?? ""),
      }));
  } finally {
    await session.detach().catch(() => {});
  }
}

/**
 * Find a node in the page's DOM that is *both* announceable
 * (aria-live polite/assertive, role=status, role=alert, or inside
 * sonner's toaster) AND whose text contains the print label.
 */
async function findAnnouncedPrintLabel(page: Page): Promise<{
  count: number;
  sample: string | null;
}> {
  return page.evaluate((label) => {
    const candidates = Array.from(
      document.querySelectorAll(
        '[aria-live="polite"], [aria-live="assertive"], [role="status"], [role="alert"], [data-sonner-toaster] *',
      ),
    );
    const hits = candidates
      .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((t) => t.includes(label));
    return { count: hits.length, sample: hits[0] ?? null };
  }, TOAST_LABEL);
}

test.describe("'Preparing for print…' toast is announced live and removed from the a11y tree after cleanup", () => {
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
    test(`toast is live-announced during print and removed from a11y tree after cleanup for doc="${doc}"`, async ({
      page,
    }) => {
      page.on("pageerror", () => {});

      await page.goto(`${BASE}/test-print-modal?doc=${doc}`, { waitUntil: "load" });
      await expect(page.getByTestId("hydrated")).toBeAttached({ timeout: 15_000 });

      await page.getByTestId("open-modal").click();
      const printBtn = page.getByRole("button", { name: "Open browser print dialog" });
      await expect(printBtn).toBeVisible({ timeout: 15_000 });

      // Baseline: the print label is NOT already announceable.
      const baselineHit = await findAnnouncedPrintLabel(page);
      expect(baselineHit.count, "print label was already announceable before clicking Print").toBe(
        0,
      );

      // 1500 ms gives us a stable window to observe the announcement
      // before cleanup fires.
      await installDelayedPrintMock(page, 1500);
      await printBtn.click();

      // Wait for preparePrint to actually invoke window.print() (proves
      // the toast was scheduled to render).
      await expect
        .poll(
          async () =>
            page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls),
          { timeout: 5_000 },
        )
        .toBeGreaterThanOrEqual(1);

      // ── DURING-PRINT assertions ─────────────────────────────────────
      // DOM: at least one announceable node contains the label.
      await expect
        .poll(async () => (await findAnnouncedPrintLabel(page)).count, {
          timeout: 2_000,
        })
        .toBeGreaterThan(0);
      const liveHit = await findAnnouncedPrintLabel(page);
      expect(liveHit.sample, "live region did not surface the print label").toContain(TOAST_LABEL);

      // Accessibility tree: the toast is exposed to assistive tech.
      // We accept *any* node whose accessible name includes the label —
      // sonner exposes the toast row as role=status with name=label.
      const axFlatDuring = await getAxFlat(page);
      const announcedDuring = axFlatDuring.filter((n) => n.name.includes(TOAST_LABEL));
      expect(
        announcedDuring.length,
        `print label not present in a11y tree during print for doc=${doc}`,
      ).toBeGreaterThan(0);
      // The DOM check above already proved the label is inside an
      // announceable container (aria-live / role=status / sonner toaster).
      // We do not further constrain the role on the AX node, because
      // sonner's row role varies across versions (status / generic with
      // live=polite). Presence-in-tree + presence-in-live-region is the
      // SR-relevant guarantee.

      // ── AFTER-CLEANUP assertions ────────────────────────────────────
      // Wait for the delayed afterprint to fire and cleanup to remove
      // the runtime style.
      await expect
        .poll(async () => page.evaluate(() => !!document.getElementById("pp-print-runtime")), {
          timeout: 5_000,
        })
        .toBe(false);
      // Sonner exit animation buffer.
      await page.waitForTimeout(500);

      // DOM: no announceable node carries the label anymore.
      const afterHit = await findAnnouncedPrintLabel(page);
      expect(
        afterHit.count,
        `stale 'Preparing for print…' announcement remained after cleanup for doc=${doc}: ${afterHit.sample}`,
      ).toBe(0);

      // Accessibility tree: the label is gone from the tree entirely —
      // not just visually hidden.
      const axFlatAfter = await getAxFlat(page);
      const announcedAfter = axFlatAfter.filter((n) => n.name.includes(TOAST_LABEL));
      expect(
        announcedAfter,
        `'Preparing for print…' still in a11y tree after cleanup for doc=${doc}`,
      ).toEqual([]);
    });
  }
});

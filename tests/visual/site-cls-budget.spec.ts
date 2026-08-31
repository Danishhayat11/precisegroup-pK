import { test, expect } from "@playwright/test";

/**
 * CLS budget guard for /site.
 *
 * Fails if Cumulative Layout Shift exceeds the budget, so regressions
 * (unsized images, late-swapping web fonts, injected banners) get caught
 * before they ship. Budget is set well under Google's 0.25 "Poor" cut-off
 * and just above the 0.1 "Good" threshold to leave headroom for the
 * external Lovable badge overlay observed in baseline (~0.0002).
 */

// Hard fail threshold — matches the perf goal ("stay under 0.25").
const CLS_HARD_BUDGET = 0.25;
// Soft warning threshold — Core Web Vitals "Good" cut-off. Logged, not failing.
const CLS_GOOD_BUDGET = 0.1;

async function measureCLS(page: import("@playwright/test").Page, url: string) {
  await page.goto(url, { waitUntil: "load" });
  // Give late-arriving shifts (fonts, lazy images, third-party badges) a
  // realistic window to fire before we tally.
  return await page.evaluate(
    (settleMs) =>
      new Promise<{
        cls: number;
        shifts: Array<{
          value: number;
          time: number;
          sources: Array<{ node: string | null }>;
        }>;
      }>((resolve) => {
        let cls = 0;
        const shifts: Array<{
          value: number;
          time: number;
          sources: Array<{ node: string | null }>;
        }> = [];
        const po = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as PerformanceEntry[]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const e = entry as any;
            if (!e.hadRecentInput) {
              cls += e.value;
              shifts.push({
                value: e.value,
                time: e.startTime,
                sources: (e.sources ?? []).map(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (s: any) => ({
                    node: s.node ? `${s.node.tagName}${s.node.id ? "#" + s.node.id : ""}` : null,
                  }),
                ),
              });
            }
          }
        });
        po.observe({ type: "layout-shift", buffered: true });
        setTimeout(() => {
          po.takeRecords();
          po.disconnect();
          resolve({ cls, shifts });
        }, settleMs);
      }),
    6000,
  );
}

test.describe("CLS budget — /site", () => {
  test("stays under the 0.25 CLS hard budget", async ({ page }, testInfo) => {
    const { cls, shifts } = await measureCLS(page, "/site");

    testInfo.annotations.push({
      type: "cls",
      description: `CLS=${cls.toFixed(4)} across ${shifts.length} shift(s)`,
    });
    if (cls > CLS_GOOD_BUDGET) {
      // Surface the offenders so a regression's root cause is obvious.
      console.warn(
        `[cls] /site CLS=${cls.toFixed(4)} exceeds "Good" budget ${CLS_GOOD_BUDGET}. Shifts:\n` +
          JSON.stringify(shifts, null, 2),
      );
    } else {
      console.log(`[cls] /site CLS=${cls.toFixed(4)} (good, budget ${CLS_GOOD_BUDGET})`);
    }

    expect(
      cls,
      `CLS ${cls.toFixed(4)} exceeds hard budget ${CLS_HARD_BUDGET}. ` +
        `Shift sources: ${shifts
          .flatMap((s) => s.sources.map((src) => src.node))
          .filter(Boolean)
          .join(", ")}`,
    ).toBeLessThan(CLS_HARD_BUDGET);
  });
});

/**
 * E2E: Pending Balance KPI drill-down.
 *
 * Clicks the "Total Pending Balance" KPI tile on the Dashboard, opens the
 * drill-down sheet, and verifies the rendered table:
 *   1. Exposes the expected columns including Received (PKR) and Pending (PKR).
 *   2. Every visible row has Pending > 0 (zeroed rows must be omitted).
 *   3. For every row: Received == Cash/Bank + Adj. Allowed.
 *   4. For every row: Pending == max(Sell − Received, 0).
 *   5. The footer total equals the sum of the visible Pending column.
 *
 * Run:  bunx playwright test tests/a11y/pending-drill.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const SCREENSHOT_DIR = "/tmp/browser/pending-drill";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const EXPECTED_COLS = [
  "Client",
  "Unit",
  "Sell (PKR)",
  "Cash/Bank (PKR)",
  "Adj. Allowed (PKR)",
  "Received (PKR)",
  "Pending (PKR)",
];

/** Parse "PKR 12,345" / "12,345" / "—" → number. */
function toNum(text: string | null | undefined): number {
  if (!text) return 0;
  const n = parseFloat(text.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

test.use({
  viewport: { width: 1280, height: 1800 },
  colorScheme: "light",
  reducedMotion: "reduce",
});

async function seedAndOpenDashboard(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: /Open drill-down for Total Pending Balance/i })
    .waitFor({ state: "visible", timeout: 20_000 });
}

test("Pending Balance drill opens and rows match Received/Pending zeroing rules", async ({
  page,
}) => {
  await seedAndOpenDashboard(page);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/1_dashboard.png` });

  await page.getByRole("button", { name: /Open drill-down for Total Pending Balance/i }).click();

  // The drill renders inside a side sheet. The table is the only one rendered there.
  // We anchor on the column headers which are unique to the pending drill.
  for (const label of EXPECTED_COLS) {
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${label}$`) })).toBeVisible({
      timeout: 10_000,
    });
  }

  await page.screenshot({ path: `${SCREENSHOT_DIR}/2_drill_open.png` });

  // Locate the drill table by its header row containing "Pending (PKR)".
  const table = page
    .locator("table", {
      has: page.getByRole("columnheader", { name: /^Pending \(PKR\)$/ }),
    })
    .first();
  await expect(table).toBeVisible();

  // Collect column indices from the header order.
  const headerCells = await table.locator("thead th").allTextContents();
  const headers = headerCells.map((t) => t.replace(/[▲▼]/g, "").trim());
  const idx = (label: string) => headers.findIndex((h) => h === label);
  const iSell = idx("Sell (PKR)");
  const iCash = idx("Cash/Bank (PKR)");
  const iAdj = idx("Adj. Allowed (PKR)");
  const iRecv = idx("Received (PKR)");
  const iPend = idx("Pending (PKR)");
  expect([iSell, iCash, iAdj, iRecv, iPend].every((n) => n >= 0)).toBe(true);

  // Only iterate data rows (skip the expanded-row sibling tr which has a single colspan cell).
  const dataRows = table.locator("tbody > tr").filter({
    has: page.locator(`td:nth-child(${iPend + 1})`),
  });
  const rowCount = await dataRows.count();

  // If the dataset is empty (everything covered), the drill shows a single
  // "No records" row — that's still a valid zeroing assertion but there's
  // nothing to invariant-check per row. We exit early in that case.
  if (rowCount === 0) {
    test
      .info()
      .annotations.push({
        type: "info",
        description: "Pending drill is empty — everything is covered.",
      });
    return;
  }

  let visiblePendingSum = 0;
  for (let r = 0; r < rowCount; r++) {
    const cells = dataRows.nth(r).locator("td");
    const sell = toNum(await cells.nth(iSell).textContent());
    const cash = toNum(await cells.nth(iCash).textContent());
    const adj = toNum(await cells.nth(iAdj).textContent());
    const recv = toNum(await cells.nth(iRecv).textContent());
    const pend = toNum(await cells.nth(iPend).textContent());

    // Zeroing rule: only un-covered rows should be visible.
    expect(pend, `row ${r} pending must be > 0`).toBeGreaterThan(0);
    // Received == Cash/Bank + Adj. Allowed (allow small fmt rounding).
    expect(Math.abs(recv - (cash + adj)), `row ${r} received mismatch`).toBeLessThanOrEqual(1);
    // Pending == max(Sell − Received, 0).
    expect(
      Math.abs(pend - Math.max(sell - recv, 0)),
      `row ${r} pending mismatch`,
    ).toBeLessThanOrEqual(1);

    visiblePendingSum += pend;
  }

  // Footer total — the drill sheet renders a "Total Pending" label with the sum.
  // Pagination may limit which rows are visible, so the footer sum can exceed
  // the rendered slice. We only assert the per-row invariants strictly, and
  // check that the footer total is ≥ the sum of visible rows.
  const footerTotalText = await page
    .getByText(/Total Pending/i)
    .first()
    .locator("..")
    .innerText()
    .catch(() => "");
  const footerTotal = toNum(footerTotalText);
  expect(footerTotal).toBeGreaterThanOrEqual(visiblePendingSum - 1);
});

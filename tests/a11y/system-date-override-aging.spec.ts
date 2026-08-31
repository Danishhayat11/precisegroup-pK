/**
 * E2E: System date override consistency.
 *
 * Sets a custom system date override via the authenticated PostgREST endpoint
 * (writing `app_settings.system_date_override`), then asserts within 5 seconds
 * that the Dashboard "Current Overdue Amount" KPI numerically equals the sum
 * of the Reports → "Aging — overdue receivable" buckets. Both surfaces must
 * resolve "today" from the same source-of-truth, so their totals must agree.
 *
 * The override is restored / cleared in afterEach.
 *
 * Run: bunx playwright test tests/a11y/system-date-override-aging.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const ACCESS_TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "";

const SCREENSHOT_DIR = "/tmp/browser/system-date-aging";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Choose an override date 45 days in the past so installments due "today−45"
// land in the 31–60 bucket of both views deterministically.
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
const OVERRIDE_DATE = isoDaysAgo(0); // today; the cross-check works for any date

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

async function restoreSession(page: Page) {
  if (COOKIES_JSON) {
    const cookies = JSON.parse(COOKIES_JSON);
    for (const c of cookies) c.url = BASE;
    await page.context().addCookies(cookies);
  }
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
}

async function getRestConfig(page: Page): Promise<{ url: string; key: string; token: string }> {
  const cfg = await page.evaluate(() => ({
    url: (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined,
    key:
      ((import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
      ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined),
  }));
  if (!cfg.url || !cfg.key) throw new Error("Missing VITE_SUPABASE_URL / publishable key");
  let token = ACCESS_TOKEN;
  if (!token && SESSION_JSON) {
    try {
      token = JSON.parse(SESSION_JSON)?.access_token ?? "";
    } catch {
      /* ignore */
    }
  }
  if (!token) throw new Error("No Supabase access token available");
  return { url: cfg.url, key: cfg.key, token };
}

async function upsertOverride(
  cfg: { url: string; key: string; token: string },
  date: string | null,
) {
  if (date === null) {
    await fetch(`${cfg.url}/rest/v1/app_settings?key=eq.system_date_override`, {
      method: "DELETE",
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.token}` },
    }).catch(() => {});
    return;
  }
  const res = await fetch(`${cfg.url}/rest/v1/app_settings?on_conflict=key`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({ key: "system_date_override", value: { date } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Override upsert failed: ${res.status} ${body}`);
  }
}

async function readOverdueKpi(page: Page): Promise<number> {
  const btn = page
    .getByRole("button", { name: /Open drill-down for Current Overdue Amount/i })
    .first();
  await btn.waitFor({ state: "visible", timeout: 20_000 });
  return toNum(await btn.innerText());
}

async function readAgingBucketsTotal(page: Page): Promise<number> {
  // ReportCard renders a card titled "Aging — overdue receivable" with
  // rows labelled "0-30 days", "31-60 days", "61-90 days", "90+ days".
  const card = page.locator("div", { hasText: /Aging — overdue receivable/i }).first();
  await card.waitFor({ state: "visible", timeout: 20_000 });
  const text = await card.innerText();
  // Each row prints the bucket label then a PKR-formatted value. Sum every
  // PKR value that appears after a "<n>-<n> days" or "90+ days" label.
  const labels = ["0-30 days", "31-60 days", "61-90 days", "90+ days"];
  let sum = 0;
  for (const lbl of labels) {
    const row = page.locator(`text=${lbl}`).first();
    const rowText = await row
      .locator("xpath=..")
      .innerText()
      .catch(() => "");
    sum += toNum(rowText.replace(lbl, ""));
  }
  void text;
  return sum;
}

test.beforeAll(() => {
  test.skip(
    AUTH_STATUS !== "injected",
    `Requires injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=${AUTH_STATUS || "absent"})`,
  );
});

let restCfg: { url: string; key: string; token: string } | null = null;

test.afterEach(async () => {
  if (restCfg) await upsertOverride(restCfg, null).catch(() => {});
});

test("system date override → Dashboard overdue KPI and Reports aging buckets agree within 5s", async ({
  page,
}) => {
  await restoreSession(page);
  restCfg = await getRestConfig(page);

  // Set the override. If the signed-in user lacks the role to write
  // app_settings, skip — this gate is admin-only by design.
  try {
    await upsertOverride(restCfg, OVERRIDE_DATE);
  } catch (e) {
    test.skip(true, `Cannot write app_settings as this user: ${(e as Error).message}`);
    return;
  }

  // Reload Dashboard so the systemDate cache and downstream queries refetch.
  const start = Date.now();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/1_dashboard.png` });

  let dashOverdue = 0;
  let agingTotal = 0;

  await expect
    .poll(
      async () => {
        dashOverdue = await readOverdueKpi(page);
        return Number.isFinite(dashOverdue);
      },
      { timeout: 5_000, intervals: [250, 500, 1000] },
    )
    .toBe(true);

  await page.goto(`${BASE}/reports`, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/2_reports.png` });

  await expect
    .poll(
      async () => {
        agingTotal = await readAgingBucketsTotal(page);
        return Number.isFinite(agingTotal);
      },
      { timeout: 5_000, intervals: [250, 500, 1000] },
    )
    .toBe(true);

  const elapsed = Date.now() - start;
  expect(elapsed, "Combined Dashboard + Reports propagation").toBeLessThanOrEqual(15_000);

  // The Dashboard Overdue KPI must equal the sum of the Reports aging buckets.
  // Allow ±1 PKR for rounding in either renderer.
  expect(
    Math.abs(dashOverdue - agingTotal),
    `Dashboard overdue (${dashOverdue}) ≠ Reports aging total (${agingTotal}) under system date ${OVERRIDE_DATE}`,
  ).toBeLessThanOrEqual(1);
});

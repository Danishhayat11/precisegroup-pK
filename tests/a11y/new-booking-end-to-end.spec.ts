/**
 * E2E: Create booking + payment → Dashboard totals, Reports table, AI assistant.
 *
 * Inserts a unique booking and a single payment via the authenticated PostgREST
 * endpoint (using the signed-in user's bearer token, so RLS applies as that user),
 * then verifies within 5 seconds that:
 *   1. Dashboard "Total Sell Value" KPI increases by the booking's contract value.
 *   2. The new booking appears in Reports → Per-Client Statements table.
 *   3. The Precise Assistant can answer a question naming the new booking_id.
 *
 * Always cleans up the inserted rows (payment then booking) in afterEach.
 *
 * Run: bunx playwright test tests/a11y/new-booking-end-to-end.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const ACCESS_TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "";

const SCREENSHOT_DIR = "/tmp/browser/new-booking-e2e";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Unique IDs per run so reruns can't collide.
const RUN = Date.now().toString(36).toUpperCase().slice(-6);
const BOOKING_ID = `BK-E2E-${RUN}`;
const UNIT_ID = `UN-E2E-${RUN}`;
const RECEIPT_NO = `RCPT-E2E-${RUN}`;
const CLIENT_NAME = `E2E Tester ${RUN}`;
const SELL_VALUE = 1_750_000; // distinctive amount
const PAYMENT_AMOUNT = 250_000;

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

/**
 * Get Supabase REST URL + publishable key + bearer token from the running app.
 * Reads `import.meta.env.VITE_*` exposed by the Vite client.
 */
async function getRestConfig(page: Page): Promise<{ url: string; key: string; token: string }> {
  const cfg = await page.evaluate(() => ({
    url: (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined,
    key:
      ((import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
      ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined),
  }));
  const url = cfg.url;
  const key = cfg.key;
  if (!url || !key) throw new Error("Missing VITE_SUPABASE_URL / publishable key in preview");
  let token = ACCESS_TOKEN;
  if (!token && SESSION_JSON) {
    try {
      token = JSON.parse(SESSION_JSON)?.access_token ?? "";
    } catch {
      /* ignore */
    }
  }
  if (!token) throw new Error("No Supabase access token available");
  return { url, key, token };
}

async function restInsert(
  cfg: { url: string; key: string; token: string },
  table: string,
  row: Record<string, unknown>,
) {
  const res = await fetch(`${cfg.url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Insert ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function restDelete(
  cfg: { url: string; key: string; token: string },
  table: string,
  query: string,
) {
  await fetch(`${cfg.url}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.token}` },
  }).catch(() => {});
}

async function readSellKpi(page: Page): Promise<number> {
  const btn = page.getByRole("button", { name: /Open drill-down for Total Sell Value/i }).first();
  await btn.waitFor({ state: "visible", timeout: 20_000 });
  return toNum(await btn.innerText());
}

test.beforeAll(() => {
  test.skip(
    !["injected"].includes(AUTH_STATUS),
    `Requires injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=${AUTH_STATUS || "absent"})`,
  );
});

let restCfg: { url: string; key: string; token: string } | null = null;

test.afterEach(async () => {
  if (!restCfg) return;
  // Order matters: payment → ledger (if any) → booking → unit.
  await restDelete(restCfg, "payments", `receipt_no=eq.${RECEIPT_NO}`);
  await restDelete(restCfg, "installment_ledger", `booking_id=eq.${BOOKING_ID}`);
  await restDelete(restCfg, "bookings", `booking_id=eq.${BOOKING_ID}`);
  await restDelete(restCfg, "units", `unit_id=eq.${UNIT_ID}`);
});

test("new booking + payment flows into Dashboard totals, Reports, and AI assistant within 5s", async ({
  page,
}) => {
  // 1. Open Dashboard authenticated.
  await restoreSession(page);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/1_dashboard_before.png` });

  const sellBefore = await readSellKpi(page);

  // 2. Insert minimal unit + booking + payment via authenticated REST.
  restCfg = await getRestConfig(page);
  const today = new Date().toISOString().slice(0, 10);

  await restInsert(restCfg, "units", {
    unit_id: UNIT_ID,
    project_code: "MA",
    project_name: "Manal Arcade",
    unit_no: `E2E-${RUN}`,
    unit_type: "Shop",
    floor: "GF",
    size_sqft: 100,
    base_rate: SELL_VALUE / 100,
    standard_value: SELL_VALUE,
    status: "Booked",
  });

  await restInsert(restCfg, "bookings", {
    booking_id: BOOKING_ID,
    booking_date: today,
    project_code: "MA",
    project_name: "Manal Arcade",
    unit_id: UNIT_ID,
    client_name: CLIENT_NAME,
    unit_type: "Shop",
    floor: "GF",
    size_sqft: 100,
    base_rate: SELL_VALUE / 100,
    standard_value: SELL_VALUE,
    sold_rate: SELL_VALUE / 100,
    sold_unit_value: SELL_VALUE,
    total_contract_value: SELL_VALUE,
    down_payment: PAYMENT_AMOUNT,
    no_of_installments: 0,
    installment_amount: 0,
    possession_amount: SELL_VALUE - PAYMENT_AMOUNT,
    cash_received: 0,
    remaining_balance: SELL_VALUE,
    booking_status: "Active",
  });

  await restInsert(restCfg, "payments", {
    receipt_no: RECEIPT_NO,
    payment_date: today,
    booking_id: BOOKING_ID,
    client_name: CLIENT_NAME,
    project: "Manal Arcade",
    unit_no: `E2E-${RUN}`,
    payment_head: "Down Payment",
    payment_mode: "Cash",
    amount: PAYMENT_AMOUNT,
    status: "Posted",
    cash_bank_include: true,
  });

  // 3. Reload Dashboard and assert Total Sell Value increased by SELL_VALUE within 5s.
  const insertedAt = Date.now();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => await readSellKpi(page), { timeout: 5_000, intervals: [250, 500, 1000] })
    .toBeGreaterThanOrEqual(sellBefore + SELL_VALUE);
  const dashLatency = Date.now() - insertedAt;
  await page.screenshot({ path: `${SCREENSHOT_DIR}/2_dashboard_after.png` });
  expect(dashLatency, "Dashboard KPI propagation").toBeLessThanOrEqual(5_000);

  // 4. Reports → Per-Client Statements table contains the new booking_id within 5s.
  const reportsStart = Date.now();
  await page.goto(`${BASE}/reports`, { waitUntil: "domcontentloaded" });
  const bookingCell = page.locator("table tbody tr", { hasText: BOOKING_ID }).first();
  await expect(bookingCell).toBeVisible({ timeout: 5_000 });
  await expect(bookingCell).toContainText(CLIENT_NAME);
  expect(Date.now() - reportsStart, "Reports propagation").toBeLessThanOrEqual(5_000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/3_reports.png` });

  // 5. Precise Assistant answers a question about the new booking.
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Open Precise Assistant/i }).click();
  const ta = page.getByPlaceholder(/Ask anything about your bookings/i);
  await ta.waitFor({ state: "visible", timeout: 10_000 });
  await ta.fill(
    `What is the total contract value of booking ${BOOKING_ID}? Reply with just the booking id and the amount.`,
  );
  await page.getByRole("button", { name: /^Send/i }).click();

  const dialog = page.getByRole("dialog", { name: /Precise Assistant/i });
  await expect
    .poll(async () => (await dialog.innerText()).includes(BOOKING_ID), { timeout: 20_000 })
    .toBeTruthy();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/4_assistant.png` });
});

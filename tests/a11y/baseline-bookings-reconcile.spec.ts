/**
 * E2E: Baseline reconciliation for BK-MA-00002…BK-MA-00018.
 *
 * Triggers `public.recompute_all_bookings()` (FIFO + overdue + risk recompute)
 * via authenticated PostgREST, then reads back the 17 baseline bookings and
 * asserts each row matches the canonical figures captured after the
 * BK-MA-00014 / BK-MA-00015 reconciliations. Any drift (count, amount, or
 * risk level) fails the test for that specific booking_id.
 *
 * Run: bunx playwright test tests/a11y/baseline-bookings-reconcile.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const ACCESS_TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "";

type Risk = "LOW" | "MEDIUM" | "HIGH";
type Expected = { count: number; amount: number; risk: Risk };

/**
 * Canonical baseline figures (post-reconciliation snapshot).
 * Source of truth: production DB after `recompute_all_bookings()` on the
 * cleaned data set. Update intentionally if business rules legitimately move.
 */
const CANONICAL: Record<string, Expected> = {
  "BK-MA-00002": { count: 1, amount: 357500, risk: "MEDIUM" },
  "BK-MA-00003": { count: 6, amount: 5884462.5, risk: "HIGH" },
  "BK-MA-00004": { count: 0, amount: 0, risk: "LOW" },
  "BK-MA-00005": { count: 1, amount: 475000, risk: "MEDIUM" },
  "BK-MA-00006": { count: 0, amount: 0, risk: "LOW" },
  "BK-MA-00007": { count: 0, amount: 0, risk: "LOW" },
  "BK-MA-00008": { count: 1, amount: 40500, risk: "MEDIUM" },
  "BK-MA-00009": { count: 2, amount: 1677500, risk: "MEDIUM" },
  "BK-MA-00010": { count: 0, amount: 0, risk: "LOW" },
  "BK-MA-00011": { count: 6, amount: 3512500, risk: "HIGH" },
  "BK-MA-00012": { count: 0, amount: 0, risk: "LOW" },
  "BK-MA-00013": { count: 2, amount: 1653000, risk: "MEDIUM" },
  "BK-MA-00014": { count: 0, amount: 0, risk: "MEDIUM" },
  "BK-MA-00015": { count: 0, amount: 0, risk: "LOW" },
  "BK-MA-00016": { count: 4, amount: 27526250, risk: "HIGH" },
  "BK-MA-00017": { count: 8, amount: 1500000, risk: "HIGH" },
  "BK-MA-00018": { count: 0, amount: 0, risk: "LOW" },
};

const BOOKING_IDS = Object.keys(CANONICAL).sort();

test.use({ viewport: { width: 1280, height: 800 } });

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

async function getRestConfig(page: Page) {
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

test.beforeAll(() => {
  test.skip(
    AUTH_STATUS !== "injected",
    `Requires injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=${AUTH_STATUS || "absent"})`,
  );
});

test("17 baseline bookings match canonical overdue counts, amounts, and risk levels after recompute", async ({
  page,
}) => {
  await restoreSession(page);
  const cfg = await getRestConfig(page);

  // 1. Trigger the FIFO + overdue + risk recompute for every booking.
  const rpc = await fetch(`${cfg.url}/rest/v1/rpc/recompute_all_bookings`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  expect(
    rpc.ok,
    `recompute_all_bookings RPC failed: ${rpc.status} ${await rpc.text().catch(() => "")}`,
  ).toBeTruthy();

  // 2. Read back the 17 baseline rows.
  const idsList = BOOKING_IDS.map((id) => `"${id}"`).join(",");
  const url =
    `${cfg.url}/rest/v1/bookings` +
    `?select=booking_id,current_overdue_count,total_overdue_amount,risk_level` +
    `&booking_id=in.(${encodeURIComponent(idsList)})` +
    `&order=booking_id.asc`;
  const res = await fetch(url, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.token}` },
  });
  expect(
    res.ok,
    `bookings read failed: ${res.status} ${await res.text().catch(() => "")}`,
  ).toBeTruthy();
  const rows = (await res.json()) as Array<{
    booking_id: string;
    current_overdue_count: number | null;
    total_overdue_amount: number | string | null;
    risk_level: string | null;
  }>;

  // 3. Every baseline id must be present.
  const present = new Set(rows.map((r) => r.booking_id));
  const missing = BOOKING_IDS.filter((id) => !present.has(id));
  expect(missing, `Missing baseline bookings: ${missing.join(", ")}`).toEqual([]);

  // 4. Collect drift per booking, then fail with the full diff (one assertion
  //    so a single regression report lists every off-canon row at once).
  const drift: string[] = [];
  for (const row of rows) {
    const want = CANONICAL[row.booking_id];
    if (!want) continue;
    const gotCount = Number(row.current_overdue_count ?? 0);
    const gotAmount = Number(row.total_overdue_amount ?? 0);
    const gotRisk = (row.risk_level ?? "").toUpperCase();
    const problems: string[] = [];
    if (gotCount !== want.count) problems.push(`count ${gotCount} ≠ ${want.count}`);
    if (Math.abs(gotAmount - want.amount) > 0.5)
      problems.push(`amount ${gotAmount} ≠ ${want.amount}`);
    if (gotRisk !== want.risk) problems.push(`risk ${gotRisk || "(null)"} ≠ ${want.risk}`);
    if (problems.length) drift.push(`${row.booking_id}: ${problems.join("; ")}`);
  }
  expect(drift, `Baseline drift detected:\n  ${drift.join("\n  ")}`).toEqual([]);
});

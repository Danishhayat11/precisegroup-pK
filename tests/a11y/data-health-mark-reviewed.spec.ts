/**
 * E2E: Data Health "Mark Reviewed" persistence + summary exclusion.
 *
 * 1. Loads /health, scans for issues.
 * 2. Captures the first issue's row (booking_id + type) and the "Critical/Warnings/Info"
 *    summary counts.
 * 3. Clicks "Mark Reviewed" on that row.
 * 4. Reloads the page (full nav).
 * 5. Asserts the issue is excluded from the default list AND the summary card for its
 *    severity decreased by exactly 1.
 * 6. Clicks the "show" toggle on the reviewed badge → asserts the issue reappears
 *    and the summary card returns to the original count.
 * 7. afterEach clears the reviewed marks the test created so it can run repeatedly.
 *
 * Run: bunx playwright test tests/a11y/data-health-mark-reviewed.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const ACCESS_TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "";

const SHOTS = "/tmp/browser/data-health-reviewed";
fs.mkdirSync(SHOTS, { recursive: true });

test.use({ viewport: { width: 1280, height: 1800 }, reducedMotion: "reduce" });

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

async function clearReviewedForUser(cfg: { url: string; key: string; token: string }) {
  // RLS scopes audit_reviewed_issues to auth.uid(), so a blanket DELETE only
  // removes rows belonging to the current test user.
  await fetch(
    `${cfg.url}/rest/v1/audit_reviewed_issues?id=neq.00000000-0000-0000-0000-000000000000`,
    {
      method: "DELETE",
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.token}` },
    },
  ).catch(() => {});
}

function toInt(s: string | null | undefined): number {
  if (!s) return 0;
  const n = parseInt(s.replace(/[^\d\-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

async function readSummary(
  page: Page,
): Promise<{ critical: number; warning: number; info: number }> {
  const get = async (label: RegExp) => {
    const card = page.getByRole("button").filter({ hasText: label }).first();
    await card.waitFor({ state: "visible", timeout: 15_000 });
    // Big number is the only multi-digit numeric line in the card.
    const txt = await card.innerText();
    const m = txt.match(/\n(\d+)\n/) ?? txt.match(/(\d+)/);
    return toInt(m?.[1] ?? "0");
  };
  return {
    critical: await get(/Critical Issues/i),
    warning: await get(/^Warnings/im),
    info: await get(/^Info/im),
  };
}

async function gotoHealth(page: Page) {
  await page.goto(`${BASE}/health`, { waitUntil: "domcontentloaded" });
  // Wait for either the issues table or the "All clean" state.
  await expect(page.getByText(/^Issues \(\d+\)/).or(page.getByText(/All clean/i))).toBeVisible({
    timeout: 30_000,
  });
}

test.beforeAll(() => {
  test.skip(
    AUTH_STATUS !== "injected",
    `Requires injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=${AUTH_STATUS || "absent"})`,
  );
});

let restCfg: { url: string; key: string; token: string } | null = null;

test.afterEach(async () => {
  if (restCfg) await clearReviewedForUser(restCfg).catch(() => {});
});

test("Mark Reviewed hides the issue across refresh and counts drop; 'show' restores both", async ({
  page,
}) => {
  await restoreSession(page);
  restCfg = await getRestConfig(page);

  // Start from a clean reviewed set so the test is order-independent.
  await clearReviewedForUser(restCfg);

  await gotoHealth(page);
  await page.screenshot({ path: `${SHOTS}/1_initial.png` });

  // If there are no issues at all, nothing to verify — skip gracefully.
  if (
    await page
      .getByText(/All clean/i)
      .isVisible()
      .catch(() => false)
  ) {
    test.skip(true, "Audit reports zero issues — cannot exercise Mark Reviewed flow");
    return;
  }

  const before = await readSummary(page);

  // Grab the first data row and capture its booking id + issue type so we can
  // re-identify it after reload regardless of ordering.
  const firstRow = page.locator("table tbody tr").first();
  await firstRow.waitFor({ state: "visible" });
  const bookingCell = firstRow.locator("td").nth(1);
  const typeCell = firstRow.locator("td").nth(2);
  const bookingId = (await bookingCell.innerText()).split("\n")[0].trim();
  const issueType = (await typeCell.innerText()).trim();

  // Read the severity from the first cell (badge text: CRITICAL/WARNING/INFO).
  const sevText = (await firstRow.locator("td").first().innerText()).trim().toUpperCase();
  const sevKey = sevText.includes("CRITICAL")
    ? ("critical" as const)
    : sevText.includes("WARNING")
      ? ("warning" as const)
      : ("info" as const);

  const initialCount = toInt(
    (await page.getByText(/^Issues \(\d+\)/).innerText()).match(/\((\d+)\)/)?.[1] ?? "0",
  );

  // Click "Mark Reviewed" on the captured row.
  await firstRow.getByRole("button", { name: /Mark Reviewed/i }).click();
  // Wait for the button label to flip to "Reviewed" (mutation success).
  await expect(firstRow.getByRole("button", { name: /^Reviewed$/i })).toBeVisible({
    timeout: 5_000,
  });
  await page.screenshot({ path: `${SHOTS}/2_marked.png` });

  // Hard reload to verify persistence.
  await gotoHealth(page);
  await page.screenshot({ path: `${SHOTS}/3_after_reload.png` });

  // The marked issue must NOT appear in the default list.
  const matchingRowsDefault = page
    .locator("table tbody tr")
    .filter({ hasText: bookingId })
    .filter({ hasText: issueType });
  await expect(matchingRowsDefault, "Reviewed issue should be hidden after reload").toHaveCount(0);

  // Summary card for that severity must have dropped by exactly 1.
  const afterHidden = await readSummary(page);
  expect(
    afterHidden[sevKey],
    `${sevKey} count: before=${before[sevKey]} after-hidden=${afterHidden[sevKey]} (expected -1)`,
  ).toBe(before[sevKey] - 1);

  // Issues row count must drop by 1 as well.
  const hiddenCount = toInt(
    (await page.getByText(/^Issues \(\d+\)/).innerText()).match(/\((\d+)\)/)?.[1] ?? "0",
  );
  expect(hiddenCount, "Issues (n) total should drop by 1 when reviewed is hidden").toBe(
    initialCount - 1,
  );

  // Reviewed badge should be visible and offer a "show" toggle.
  const reviewedBadge = page.getByText(/\d+ reviewed \(hidden\)/i).first();
  await expect(reviewedBadge).toBeVisible();
  await reviewedBadge.getByRole("button", { name: /^show$/i }).click();
  await page.screenshot({ path: `${SHOTS}/4_shown.png` });

  // After toggling, the issue reappears in the table.
  await expect(
    matchingRowsDefault,
    "Reviewed issue should reappear when 'show reviewed' is toggled on",
  ).toHaveCount(1);

  // Summary returns to the raw scan totals.
  const afterShown = await readSummary(page);
  expect(afterShown[sevKey], `${sevKey} should restore when reviewed is shown`).toBe(
    before[sevKey],
  );
});

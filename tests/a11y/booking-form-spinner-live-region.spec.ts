/**
 * BookingForm — spinner-driven cross-field violations are announced via
 * the aria-live banner and clear immediately on the next spinner tick.
 *
 * This spec is the intersection of:
 *   - booking-form-spinner-boundaries.spec.ts (ArrowUp/Down step by 1
 *     and flip the strict `<` / `>` cross-field guards), and
 *   - booking-form-boundary-live-region.spec.ts (the summary banner is
 *     the announced channel — role="alert" + aria-live="assertive" on
 *     `[data-testid="booking-form-error"]`, cleared on any edit via
 *     `set()` → `setFormError(null)`).
 *
 * We assert the announcement path end-to-end when the only user input
 * is a spinner tick:
 *   1. Spin the field across the boundary, click Save → banner appears
 *      as a live region and names the offending field.
 *   2. Spin the same field back across the boundary (no Save yet) →
 *      the live region empties immediately, so the next Save produces
 *      a fresh insertion → announcement rather than a stale identical
 *      one (which some SRs skip).
 *   3. Save again → boundary is now inside the allowed range, so the
 *      cross-field text is gone from the banner (either no banner at
 *      all, or a banner naming only unrelated schema errors).
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "";

const MIN_ERROR = /Sale price must be at least/i;
const DP_ERROR = /Down payment cannot exceed sale price/i;

test.use({
  viewport: { width: 1280, height: 1800 },
  colorScheme: "light",
  reducedMotion: "reduce",
});

test.beforeAll(() => {
  test.skip(
    AUTH_STATUS !== "injected",
    `Requires injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=${AUTH_STATUS || "absent"})`,
  );
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

async function openNewBookingDialog(page: Page) {
  await page.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /New booking/i }).click();
  const dialog = page.getByRole("dialog", { name: /New booking/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

function fieldByLabel(dialog: Locator, labelText: string | RegExp) {
  return dialog
    .locator("div", { has: dialog.locator("label", { hasText: labelText }) })
    .filter({ has: dialog.locator("input, textarea") })
    .first()
    .locator("input, textarea")
    .first();
}

async function fillIdentity(dialog: Locator) {
  await fieldByLabel(dialog, /Client Name/i).fill("Spinner Announce Client");
  await dialog.getByPlaceholder("XXXXX-XXXXXXX-X").pressSequentially("4210112345671");
  await dialog.getByPlaceholder("03XX-XXXXXXX").pressSequentially("03001234567");
}

async function stepBy(input: Locator, delta: number) {
  const key = delta > 0 ? "ArrowUp" : "ArrowDown";
  await input.focus();
  for (let i = 0; i < Math.abs(delta); i++) {
    await input.press(key);
  }
}

function liveBanner(dialog: Locator) {
  return dialog.locator('[data-testid="booking-form-error"]');
}

async function assertBannerAnnounces(banner: Locator, fieldLabel: RegExp, message: RegExp) {
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(banner).toHaveAttribute("aria-live", "assertive");
  await expect(banner).toContainText(fieldLabel);
  // The per-field cross-field message renders under the input itself,
  // in the same dialog — assert it as the "what to fix" text SR users
  // navigate to after the banner announces "N fields need attention".
  await expect(banner.page().getByText(message)).toBeVisible();
}

async function clickSave(dialog: Locator) {
  await dialog.getByRole("button", { name: /Create booking/i }).click();
}

test.describe("BookingForm — spinner ticks drive live-region announcements", () => {
  test("Sold Rate: spin 99,999 → 99,998 across the min → banner announces, next spin clears the region, next Save is clean", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");

    const soldRate = fieldByLabel(dialog, /Sold Rate \/ Sqft/i);
    // Start just above min so a single ArrowDown crosses the boundary.
    await soldRate.fill("100000");
    await stepBy(soldRate, -1);
    await expect(soldRate).toHaveValue("99999");

    await clickSave(dialog);
    await assertBannerAnnounces(liveBanner(dialog), /Sold Rate/i, MIN_ERROR);

    // Tick back across the boundary — no Save. The banner must clear
    // immediately (setFormError(null) in the onChange handler) so the
    // next announcement is a fresh DOM insertion.
    await stepBy(soldRate, 1);
    await expect(soldRate).toHaveValue("100000");
    await expect(liveBanner(dialog)).toHaveCount(0);

    // Save again — sale price is now at the inclusive boundary, so
    // the min-contract text must be absent from the DOM entirely
    // (regardless of whether the banner reappears for other schema
    // errors like missing project/unit).
    await clickSave(dialog);
    await expect(page.getByText(MIN_ERROR)).toHaveCount(0);
  });

  test("Down Payment: spin sale → sale+1 → banner announces, spin back → region clears, next Save is clean", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("200000");

    const dp = fieldByLabel(dialog, /Down Payment Cash/i);
    await dp.fill("200000"); // inclusive boundary
    await stepBy(dp, 1); // → 200,001, one over
    await expect(dp).toHaveValue("200001");

    await clickSave(dialog);
    await assertBannerAnnounces(liveBanner(dialog), /Down Payment/i, DP_ERROR);

    // Tick back to the inclusive boundary — banner clears on the edit.
    await stepBy(dp, -1);
    await expect(dp).toHaveValue("200000");
    await expect(liveBanner(dialog)).toHaveCount(0);

    await clickSave(dialog);
    await expect(page.getByText(DP_ERROR)).toHaveCount(0);
  });
});

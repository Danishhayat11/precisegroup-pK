/**
 * BookingForm — cross-field boundary messages are exposed to assistive
 * tech via an aria-live region.
 *
 * BookingForm.handleSave surfaces boundary violations two ways:
 *   1. Per-field text under the offending input (visual only).
 *   2. A summary banner at the top of the dialog with
 *      role="alert" + aria-live="assertive", rendered from `formError`
 *      (data-testid="booking-form-error"). This is the announced channel.
 *
 * Screen readers announce the banner because:
 *   - it's inserted into the DOM after user interaction (Save click),
 *   - it carries role="alert" (implicit aria-live="assertive"), AND
 *   - it carries an explicit aria-live="assertive" for redundancy.
 *
 * This spec asserts the *contract* — banner presence, ARIA attributes,
 * and text mentioning the offending field — for both cross-field guards.
 * It also pins the clearing behavior: the moment the user edits either
 * sale price or down payment, `setFormError(null)` fires and the live
 * region empties, so the next violation is a fresh announcement rather
 * than a no-op change to identical text (which some SRs skip).
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "";

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
  await fieldByLabel(dialog, /Client Name/i).fill("Live-Region Client");
  await dialog.getByPlaceholder("XXXXX-XXXXXXX-X").pressSequentially("4210112345671");
  await dialog.getByPlaceholder("03XX-XXXXXXX").pressSequentially("03001234567");
}

async function setPricing(dialog: Locator, salePrice: number, downPayment: number) {
  await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
  await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill(String(salePrice));
  await fieldByLabel(dialog, /Down Payment Cash/i).fill(String(downPayment));
}

/**
 * The announced summary banner. `role="alert"` is a live region with
 * implicit aria-live="assertive"; the component also sets aria-live
 * explicitly. We assert both so a future refactor that drops either
 * attribute (and silently regresses SR announcement) fails here.
 */
function liveBanner(dialog: Locator) {
  return dialog.locator('[data-testid="booking-form-error"]');
}

async function assertBannerAnnounces(banner: Locator, fieldLabel: RegExp) {
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(banner).toHaveAttribute("aria-live", "assertive");
  // The banner's detail text lists offending field labels; confirm the
  // one we tripped is mentioned so SR users know what to fix.
  await expect(banner).toContainText(fieldLabel);
}

test.describe("BookingForm — boundary errors are announced via aria-live", () => {
  test("sale price below minimum → banner is a live region and names Sold Rate", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);

    // Baseline: no banner before Save.
    await expect(liveBanner(dialog)).toHaveCount(0);

    await setPricing(dialog, 99_999, 0);
    await dialog.getByRole("button", { name: /Create booking/i }).click();

    await assertBannerAnnounces(liveBanner(dialog), /Sold Rate/i);
  });

  test("down payment over sale price → banner is a live region and names Down Payment", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);

    await setPricing(dialog, 200_000, 200_001);
    await dialog.getByRole("button", { name: /Create booking/i }).click();

    await assertBannerAnnounces(liveBanner(dialog), /Down Payment/i);
  });

  test("editing Sold Rate after a violation clears the live region so the next announcement is fresh", async ({
    page,
  }) => {
    // Screen readers may debounce announcements of identical text into
    // an already-populated live region. BookingForm's `set()` clears
    // formError on every change; assert that contract so consecutive
    // Save attempts always produce a fresh insertion → announcement.
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await setPricing(dialog, 99_999, 0);
    await dialog.getByRole("button", { name: /Create booking/i }).click();
    await expect(liveBanner(dialog)).toBeVisible();

    // Any edit to sold rate should tear down the banner entirely.
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("50000");
    await expect(liveBanner(dialog)).toHaveCount(0);
  });

  test("editing Down Payment after a violation clears the live region", async ({ page }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await setPricing(dialog, 200_000, 200_001);
    await dialog.getByRole("button", { name: /Create booking/i }).click();
    await expect(liveBanner(dialog)).toBeVisible();

    await fieldByLabel(dialog, /Down Payment Cash/i).fill("100000");
    await expect(liveBanner(dialog)).toHaveCount(0);
  });
});

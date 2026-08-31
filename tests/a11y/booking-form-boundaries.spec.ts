/**
 * BookingForm — cross-field boundary cases for sale price and down payment.
 *
 * The two cross-field guards live in BookingForm.handleSave:
 *
 *   if (calc.soldUnitValue > 0 && calc.soldUnitValue < MIN_CONTRACT_VALUE) {
 *     crossErrs.sold_rate = `Sale price must be at least ${fmtPKR(MIN_CONTRACT_VALUE)}`;
 *   }
 *   if (form.down_payment > calc.soldUnitValue && calc.soldUnitValue > 0) {
 *     crossErrs.down_payment = "Down payment cannot exceed sale price";
 *   }
 *
 * MIN_CONTRACT_VALUE = 100,000. `soldUnitValue = size_sqft × sold_rate`.
 * The comparisons are strict `<` / `>`, so the interesting boundaries
 * for the messaging contract are:
 *
 *   sale-price min:
 *     - 99,999  → error appears  (below)
 *     - 100,000 → NO error       (equal — inclusive boundary)
 *     - 100,001 → NO error       (above)
 *
 *   down-payment vs sale price (sale price fixed at 200,000):
 *     - 199,999 → NO error       (below)
 *     - 200,000 → NO error       (equal — inclusive boundary)
 *     - 200,001 → error appears  (over by 1)
 *
 * These specs only assert presence/absence of the two specific
 * cross-field messages. Other schema errors (missing project/unit) may
 * still surface on Save — we don't care; we're pinning the boundary
 * contract, not full-form validity.
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

/**
 * Prep the identity fields so schema validation doesn't drown out the
 * cross-field messages we're inspecting. We deliberately DON'T set
 * project/unit — those live in async-loaded Select components and are
 * unrelated to the numeric cross-field guards under test.
 */
async function fillIdentity(dialog: Locator) {
  await fieldByLabel(dialog, /Client Name/i).fill("Boundary Client");
  await dialog.getByPlaceholder("XXXXX-XXXXXXX-X").pressSequentially("4210112345671");
  await dialog.getByPlaceholder("03XX-XXXXXXX").pressSequentially("03001234567");
}

/**
 * Configure sale price and down payment. `salePrice = size × soldRate`;
 * we pin size = 1 so `soldRate` sets the sale price directly and every
 * boundary case is a single-value change.
 */
async function setPricing(dialog: Locator, salePrice: number, downPayment: number) {
  await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
  await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill(String(salePrice));
  await fieldByLabel(dialog, /Down Payment Cash/i).fill(String(downPayment));
}

async function clickSave(dialog: Locator) {
  await dialog.getByRole("button", { name: /Create booking/i }).click();
}

test.describe("BookingForm cross-field boundaries — sale price minimum", () => {
  test("sale price 99,999 — one under → min-contract error appears", async ({ page }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await setPricing(dialog, 99_999, 0);
    await clickSave(dialog);
    await expect(dialog.getByText(MIN_ERROR)).toBeVisible();
  });

  test("sale price 100,000 — exactly at minimum → NO min-contract error (inclusive)", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await setPricing(dialog, 100_000, 0);
    await clickSave(dialog);
    // Other schema errors (project/unit) are fine — pin the specific message.
    await expect(dialog.getByText(MIN_ERROR)).toHaveCount(0);
  });

  test("sale price 100,001 — one over → NO min-contract error", async ({ page }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await setPricing(dialog, 100_001, 0);
    await clickSave(dialog);
    await expect(dialog.getByText(MIN_ERROR)).toHaveCount(0);
  });
});

test.describe("BookingForm cross-field boundaries — down payment vs sale price", () => {
  const SALE = 200_000;

  test(`down payment ${SALE - 1} (one under sale) → NO down-payment error`, async ({ page }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await setPricing(dialog, SALE, SALE - 1);
    await clickSave(dialog);
    await expect(dialog.getByText(DP_ERROR)).toHaveCount(0);
  });

  test(`down payment ${SALE} (equal to sale) → NO down-payment error (inclusive)`, async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await setPricing(dialog, SALE, SALE);
    await clickSave(dialog);
    await expect(dialog.getByText(DP_ERROR)).toHaveCount(0);
  });

  test(`down payment ${SALE + 1} (one over sale) → down-payment error appears`, async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await setPricing(dialog, SALE, SALE + 1);
    await clickSave(dialog);
    await expect(dialog.getByText(DP_ERROR)).toBeVisible();
  });

  test("sale price 0 with any down payment → NO down-payment error (guard requires sale > 0)", async ({
    page,
  }) => {
    // The second guard's `calc.soldUnitValue > 0` clause deliberately
    // suppresses the down-payment message while the user hasn't entered
    // pricing yet — otherwise every fresh form would flash the message
    // on the first Save. Pin that behavior.
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await setPricing(dialog, 0, 500_000);
    await clickSave(dialog);
    await expect(dialog.getByText(DP_ERROR)).toHaveCount(0);
    // And the min-contract guard is also gated on sale > 0 — no error either.
    await expect(dialog.getByText(MIN_ERROR)).toHaveCount(0);
  });
});

/**
 * BookingForm — spinner (arrow-key) increments respect the same
 * cross-field boundary thresholds as typed values.
 *
 * Sold Rate and Down Payment render as native `<input type="number"
 * min={0}>` with no `max` or `step` attribute, so:
 *
 *   - ArrowUp / ArrowDown step by 1 (the browser default).
 *   - `min="0"` clamps ArrowDown at 0 — the input can never spin into
 *     negative territory even though the numeric guard would accept it.
 *   - There is NO slider (role="slider") anywhere on this form; the
 *     only "drag" affordance for these fields is the native spinner
 *     buttons, which fire the same input events as the keyboard arrows.
 *
 * The cross-field guards in BookingForm.handleSave use strict `<` / `>`
 * comparisons around MIN_CONTRACT_VALUE (100,000) and sale price, so
 * stepping by ±1 across the threshold must flip the corresponding
 * error on the very next Save. Pin that end-to-end so a future
 * `step={100}` or `max={...}` refactor is forced to update these tests.
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
  await fieldByLabel(dialog, /Client Name/i).fill("Spinner Client");
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

async function clickSave(dialog: Locator) {
  await dialog.getByRole("button", { name: /Create booking/i }).click();
}

test.describe("BookingForm — numeric inputs enforce boundary thresholds via spinner controls", () => {
  test("Sold Rate and Down Payment expose type=number with min=0 and no slider role", async ({
    page,
  }) => {
    // Pins the shape of the affordance: keyboard-steppable spinner,
    // clamped at zero, with no ARIA slider anywhere in the dialog.
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);

    const soldRate = fieldByLabel(dialog, /Sold Rate \/ Sqft/i);
    const dp = fieldByLabel(dialog, /Down Payment Cash/i);

    await expect(soldRate).toHaveAttribute("type", "number");
    await expect(soldRate).toHaveAttribute("min", "0");
    await expect(dp).toHaveAttribute("type", "number");
    await expect(dp).toHaveAttribute("min", "0");

    // No slider is rendered for these fields — the whole dialog has
    // zero elements with role="slider".
    await expect(dialog.getByRole("slider")).toHaveCount(0);
  });

  test("ArrowDown on Down Payment clamps at 0 (native min='0'), never goes negative", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    const dp = fieldByLabel(dialog, /Down Payment Cash/i);
    await dp.fill("1");
    await stepBy(dp, -5); // try to spin well past zero
    // Browsers hold the value at min="0"; we allow "" as an acceptable
    // representation of the empty-but-not-negative state some engines
    // emit when the field is first cleared past min.
    const value = await dp.inputValue();
    expect(["0", ""]).toContain(value);
  });

  test("Sold Rate stepped from 99,998 → 99,999 (still below min) → min-contract error fires on Save", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
    const soldRate = fieldByLabel(dialog, /Sold Rate \/ Sqft/i);
    await soldRate.fill("99998");
    await stepBy(soldRate, 1); // → 99,999, one under min
    await expect(soldRate).toHaveValue("99999");
    await clickSave(dialog);
    await expect(dialog.getByText(MIN_ERROR)).toBeVisible();
  });

  test("Sold Rate stepped from 99,999 → 100,000 (exactly at min) → NO min-contract error", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
    const soldRate = fieldByLabel(dialog, /Sold Rate \/ Sqft/i);
    await soldRate.fill("99999");
    await stepBy(soldRate, 1); // → 100,000, inclusive boundary
    await expect(soldRate).toHaveValue("100000");
    await clickSave(dialog);
    await expect(dialog.getByText(MIN_ERROR)).toHaveCount(0);
  });

  test("Down Payment spun UP one past sale price → dp error fires; spun DOWN one back → error clears", async ({
    page,
  }) => {
    // Full round-trip across the strict `>` boundary using only the
    // spinner. Also verifies the announcement banner clears on the
    // next edit (see booking-form-boundary-live-region.spec.ts for the
    // aria-live contract itself).
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("200000");
    const dp = fieldByLabel(dialog, /Down Payment Cash/i);

    await dp.fill("200000"); // equal — inclusive boundary, no error
    await stepBy(dp, 1); // → 200,001, one over
    await expect(dp).toHaveValue("200001");
    await clickSave(dialog);
    await expect(dialog.getByText(DP_ERROR)).toBeVisible();

    await stepBy(dp, -1); // back to 200,000
    await expect(dp).toHaveValue("200000");
    await clickSave(dialog);
    await expect(dialog.getByText(DP_ERROR)).toHaveCount(0);
  });
});

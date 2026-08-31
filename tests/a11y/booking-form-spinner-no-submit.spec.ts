/**
 * BookingForm — spinner-driven boundary violations must NOT hit the API.
 *
 * Intersection of:
 *   - booking-form-spinner-boundaries.spec.ts (ArrowUp/Down step by 1
 *     across the strict `<` / `>` cross-field guards), and
 *   - booking-form-no-submit-on-boundary-errors.spec.ts (mutating
 *     requests to /rest/v1/bookings must be zero while a cross-field
 *     guard is tripped).
 *
 * The "invalid increment" cases we care about:
 *   - Sold Rate spun DOWN from 100,000 → 99,999 (one under min).
 *   - Down Payment spun UP from sale → sale+1 (one over sale).
 *
 * For each, we click Save, then assert:
 *   (a) the corresponding error banner is visible, and
 *   (b) zero POST/PATCH/PUT requests to /rest/v1/bookings were made.
 *
 * GET requests to /rest/v1/bookings (list refresh on dialog open) are
 * intentionally ignored — only mutating verbs count as "submission".
 */
import { test, expect, type Page, type Locator, type Request } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "";

const MIN_ERROR = /Sale price must be at least/i;
const DP_ERROR = /Down payment cannot exceed sale price/i;
const MUTATING = new Set(["POST", "PATCH", "PUT"]);
const BOOKINGS_ENDPOINT = /\/rest\/v1\/bookings(\?|$)/;

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
  await fieldByLabel(dialog, /Client Name/i).fill("Spinner No-Submit Client");
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

/**
 * Record mutating writes to /rest/v1/bookings scoped to the window
 * between Save click and settle. Attach AFTER dialog open so the
 * initial list fetch (a GET anyway) never enters the buffer.
 */
function trackBookingWrites(page: Page) {
  const writes: Array<{ method: string; url: string }> = [];
  const onRequest = (req: Request) => {
    if (MUTATING.has(req.method()) && BOOKINGS_ENDPOINT.test(req.url())) {
      writes.push({ method: req.method(), url: req.url() });
    }
  };
  page.on("request", onRequest);
  return { writes, stop: () => page.off("request", onRequest) };
}

async function clickSaveAndSettle(page: Page, dialog: Locator) {
  await dialog.getByRole("button", { name: /Create booking/i }).click();
  // Any submission fires in the same tick as the click handler; a
  // short settle window is enough to catch it if it happens.
  await page.waitForTimeout(500);
}

test.describe("BookingForm — invalid spinner increments do not POST bookings", () => {
  test("Sold Rate spun 100,000 → 99,999 (ArrowDown crosses min) → error shown, no bookings write", async ({
    page,
  }) => {
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("1");

    const soldRate = fieldByLabel(dialog, /Sold Rate \/ Sqft/i);
    await soldRate.fill("100000");
    await stepBy(soldRate, -1); // → 99,999, one under min
    await expect(soldRate).toHaveValue("99999");

    const tracker = trackBookingWrites(page);
    await clickSaveAndSettle(page, dialog);
    tracker.stop();

    await expect(dialog.getByText(MIN_ERROR)).toBeVisible();
    expect(
      tracker.writes,
      `Expected no mutating requests to /rest/v1/bookings, got: ${JSON.stringify(tracker.writes)}`,
    ).toEqual([]);
  });

  test("Down Payment spun 200,000 → 200,001 (ArrowUp crosses sale) → error shown, no bookings write", async ({
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

    const tracker = trackBookingWrites(page);
    await clickSaveAndSettle(page, dialog);
    tracker.stop();

    await expect(dialog.getByText(DP_ERROR)).toBeVisible();
    expect(
      tracker.writes,
      `Expected no mutating requests to /rest/v1/bookings, got: ${JSON.stringify(tracker.writes)}`,
    ).toEqual([]);
  });

  test("Repeated ArrowDown on Down Payment clamps at 0 (min='0') and never posts", async ({
    page,
  }) => {
    // Native min="0" prevents the spinner from producing a negative
    // value at all; combined with the cross-field guards this means
    // no path via ArrowDown alone can produce a submittable state
    // from a fresh dialog. Pin that the network stays quiet.
    await restoreSession(page);
    const dialog = await openNewBookingDialog(page);
    await fillIdentity(dialog);
    const dp = fieldByLabel(dialog, /Down Payment Cash/i);
    await dp.fill("2");
    await stepBy(dp, -10); // try to blow past zero

    const value = await dp.inputValue();
    expect(["0", ""]).toContain(value);

    const tracker = trackBookingWrites(page);
    await clickSaveAndSettle(page, dialog);
    tracker.stop();

    expect(
      tracker.writes,
      `Expected no mutating requests to /rest/v1/bookings, got: ${JSON.stringify(tracker.writes)}`,
    ).toEqual([]);
  });
});

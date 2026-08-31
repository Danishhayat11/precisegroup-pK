/**
 * BookingForm — successful submission flow.
 *
 * Fills the New Booking dialog with fully valid data, intercepts the
 * Supabase REST insert so no row is persisted, and verifies the app
 * signals success:
 *   - the "Booking created" toast appears with the assigned Booking ID,
 *   - the dialog closes,
 *   - no destructive error banner is shown.
 *
 * The dialog needs at least one project and one available unit to exist
 * in the environment. When either is missing (or when the injected
 * Supabase session is absent) the test skips rather than failing — the
 * happy-path shape is what we're asserting, not seed data.
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

/** Match `<div><Label>…</Label><Input/></div>`; see validation spec. */
function fieldByLabel(dialog: Locator, labelText: string | RegExp) {
  return dialog
    .locator("div", { has: dialog.locator("label", { hasText: labelText }) })
    .filter({ has: dialog.locator("input, textarea") })
    .first()
    .locator("input, textarea")
    .first();
}

/**
 * Radix <Select> renders a hidden native <select> for form submission and
 * a button trigger for UI. Pick the first non-placeholder option by
 * opening the listbox and clicking the first enabled item.
 */
async function pickFirstSelectOption(page: Page, trigger: Locator): Promise<string | null> {
  await trigger.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible({ timeout: 5_000 });
  const options = listbox.getByRole("option");
  const count = await options.count();
  if (count === 0) {
    // Close listbox before returning.
    await page.keyboard.press("Escape");
    return null;
  }
  const first = options.first();
  const label = (await first.textContent())?.trim() ?? null;
  await first.click();
  return label;
}

test.describe("BookingForm success flow", () => {
  test("valid submission shows success toast, closes dialog, and does not persist", async ({
    page,
  }) => {
    await restoreSession(page);

    // Intercept the bookings insert so this test never writes a real row.
    // Supabase-js POSTs to `/rest/v1/bookings` with `Prefer: return=…`.
    // We reply 201 with a synthesized row so `.insert(payload)` resolves
    // without an `error`, driving the component into its success branch.
    let insertSeen = false;
    await page.route("**/rest/v1/bookings**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        insertSeen = true;
        let body: unknown = {};
        try {
          body = req.postDataJSON();
        } catch {
          /* ignore */
        }
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: { "content-range": "0-0/1" },
          body: JSON.stringify(Array.isArray(body) ? body : [body]),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /New booking/i }).click();
    const dialog = page.getByRole("dialog", { name: /New booking/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Project — the header may pre-select an active project. If the
    // Project trigger already shows a code, keep it; otherwise pick the
    // first option from the dropdown.
    const projectTrigger = dialog
      .locator("div", { has: dialog.locator("label", { hasText: /^Project \*/i }) })
      .locator('button[role="combobox"]')
      .first();
    const projectLabel = (await projectTrigger.textContent())?.trim() ?? "";
    if (!projectLabel || /select|choose/i.test(projectLabel)) {
      const picked = await pickFirstSelectOption(page, projectTrigger);
      test.skip(picked === null, "No projects available in this environment");
    }

    // Unit — depends on projects having at least one Available unit.
    const unitTrigger = dialog
      .locator("div", { has: dialog.locator("label", { hasText: /Unit ID/i }) })
      .locator('button[role="combobox"]')
      .first();
    await expect(unitTrigger).toBeEnabled({ timeout: 10_000 });
    const pickedUnit = await pickFirstSelectOption(page, unitTrigger);
    test.skip(
      pickedUnit === null,
      "No available units for the selected project — cannot exercise happy path",
    );

    // Identity + client fields — pass all schema checks.
    await fieldByLabel(dialog, /Client Name/i).fill("Playwright Success Client");
    await dialog.getByPlaceholder("XXXXX-XXXXXXX-X").pressSequentially("4210112345671");
    await dialog.getByPlaceholder("03XX-XXXXXXX").pressSequentially("03001234567");

    // Pricing: 20 sqft × 10,000 = 200,000 (>= 100,000 minimum).
    // Down payment 200,000 makes the plan sum to contract value with
    // zero installments (installment_amount defaults to 0), satisfying
    // the `planMatches` cross-field check.
    await fieldByLabel(dialog, /Size \(Sqft\)/i).fill("20");
    await fieldByLabel(dialog, /Sold Rate \/ Sqft/i).fill("10000");
    await fieldByLabel(dialog, /Down Payment Cash/i).fill("200000");

    // Capture the auto-issued Booking ID so we can assert the success
    // toast description points at it.
    const bookingIdInput = fieldByLabel(dialog, /Booking ID/i);
    await expect(bookingIdInput).toHaveValue(/^BK-.+-\d{5}$/, { timeout: 10_000 });
    const bookingId = await bookingIdInput.inputValue();

    await dialog.getByRole("button", { name: /Create booking/i }).click();

    // Success toast — the component calls
    // `toast({ title: "Booking created", description: form.booking_id })`.
    const successToast = page.getByText(/^Booking created$/i);
    await expect(successToast).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(bookingId, { exact: true })).toBeVisible();

    // No error banner should have appeared.
    await expect(
      page.getByText(/Please fix the highlighted fields|Save failed|Unit already booked/i),
    ).toHaveCount(0);

    // Dialog closes on success (`onSaved` triggers the parent to unmount).
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // And the insert POST actually fired — otherwise we've only proven
    // that the client-side validation gate passed, not the full flow.
    expect(insertSeen, "expected a POST to /rest/v1/bookings").toBe(true);
  });
});

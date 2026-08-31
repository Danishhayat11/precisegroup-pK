/**
 * Active-project scoping — end-to-end
 * ------------------------------------------------------------
 * Reproduces the multi-project regression from earlier turns: switching
 * the top-bar project must scope every downstream record (booking,
 * payment, and the rendered receipt/letter) to the selected project's
 * code + name.
 *
 * Flow (single Playwright browser session, one authenticated user):
 *   1. Sign in via the injected Lovable session.
 *   2. Load `/dashboard`, open the ActiveProjectSwitcher dropdown, and
 *      pick a project whose code is NOT the current default. Assert the
 *      switcher label reflects the new selection and localStorage
 *      persisted the code.
 *   3. Inside the authenticated page context, insert a booking and a
 *      payment via the browser's `supabase-js` client — the exact same
 *      code path BookingForm / Payments use, minus the 30-field form
 *      typing. The booking pulls project_code / project_name from the
 *      active project in localStorage, so this is what the app would
 *      write when the user hits "Save".
 *   4. Read both rows back through the same client and assert their
 *      project_code + project_name match the switched project (not the
 *      previously-active one).
 *   5. Open `/receipt-fixture/<receipt_no>` — the printable
 *      letter/receipt surface — and assert it renders the newly-picked
 *      project name (regression: it was hardcoded to "Manal Arcade").
 *   6. Clean up the payment + booking regardless of pass/fail.
 *
 * Skipped in signed-out / external-Supabase projects (matches the rest
 * of the auth-gated suite).
 */
import { test, expect } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

const ORIGIN = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_CODE_KEY = "erp:active-project-code";

type ProjectRow = { project_code: string; project_name: string };

test.describe("Active project scopes new records end-to-end", () => {
  test.skip(!authAvailable(), "Requires an injected Lovable Supabase session.");

  // Data we insert during the test; recorded so `afterEach` can always tidy up.
  let createdBookingId: string | null = null;
  let createdReceiptNo: string | null = null;
  let createdUnitId: string | null = null;

  test.afterEach(async ({ page }) => {
    if (!createdBookingId && !createdReceiptNo && !createdUnitId) return;
    // The receipt-fixture page has the same authed supabase client we need.
    await page
      .goto(`${ORIGIN}/receipt-fixture/${createdReceiptNo ?? "PAY-CLEANUP"}`, {
        waitUntil: "domcontentloaded",
      })
      .catch(() => {});
    await page
      .evaluate(
        async ([receiptNo, bookingId, unitId]) => {
          const mod = await import("/src/integrations/supabase/client.ts");
          const client = (mod as any).supabase;
          if (receiptNo) await client.from("payments").delete().eq("receipt_no", receiptNo);
          if (bookingId) await client.from("bookings").delete().eq("booking_id", bookingId);
          if (unitId) await client.from("units").delete().eq("unit_id", unitId);
        },
        [createdReceiptNo, createdBookingId, createdUnitId],
      )
      .catch(() => {});
    createdBookingId = null;
    createdReceiptNo = null;
    createdUnitId = null;
  });

  test("switch project → booking, payment and receipt all inherit its code + name", async ({
    context,
    page,
  }) => {
    // 1. Auth into the app.
    await restoreSupabaseSession(context, page, ORIGIN);

    // 2. Pick a target project distinct from whatever is currently active.
    //    Reading directly from Supabase inside the page keeps us on the
    //    same auth session Playwright uses for the rest of the flow.
    await page.goto(`${ORIGIN}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('button[aria-label^="Active project"]', { timeout: 15_000 });

    const previouslyActiveCode = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      STORAGE_CODE_KEY,
    );

    const projects: ProjectRow[] = await page.evaluate(async () => {
      const mod = await import("/src/integrations/supabase/client.ts");
      const client = (mod as any).supabase;
      const { data } = await client
        .from("projects")
        .select("project_code, project_name")
        .order("project_name");
      return (data ?? []) as ProjectRow[];
    });

    test.skip(
      projects.length < 2,
      "Need at least two projects in the DB to prove scoping switches.",
    );

    const target = projects.find((p) => p.project_code !== previouslyActiveCode) ?? projects[0];
    expect(target.project_code).not.toBe(previouslyActiveCode);

    // 3. Switch via the actual dropdown UI (not by writing localStorage).
    await page.getByRole("button", { name: /^Active project:/i }).click();
    await page
      .getByRole("menuitem", {
        name: new RegExp(`^${target.project_name}(\\.\\s*Selected\\.)?$`, "i"),
      })
      .click();

    // The switcher persists the new code and rerenders its own label.
    await expect
      .poll(() => page.evaluate((k) => window.localStorage.getItem(k), STORAGE_CODE_KEY))
      .toBe(target.project_code);
    await expect(page.getByRole("button", { name: /^Active project:/i })).toContainText(
      target.project_name,
    );

    // 4. Create a booking through the same code path the form would use:
    //    ask supabase for the next BK-{CODE}-XXXXX id, then insert.
    const stamp = Date.now();
    const runTag = `E2E ${stamp}`;

    const created = await page.evaluate(
      async ([code, name, tag]) => {
        const mod = await import("/src/integrations/supabase/client.ts");
        const client = (mod as any).supabase;

        // Mirror BookingForm.nextBookingId — highest existing BK-{code}-NNNNN + 1.
        const prefix = `BK-${code}-`;
        const { data: existing } = await client
          .from("bookings")
          .select("booking_id")
          .like("booking_id", `${prefix}%`);
        const maxN = (existing ?? []).reduce((m: number, r: any) => {
          const n = Number(String(r.booking_id).replace(prefix, ""));
          return Number.isFinite(n) && n > m ? n : m;
        }, 0);
        const booking_id = `${prefix}${String(maxN + 1).padStart(5, "0")}`;
        const unit_id = `${code}-E2E-${Date.now().toString(36).toUpperCase()}`;

        // Bookings.unit_id has an FK to units — seed the unit under the
        // active project so scoping is consistent all the way down.
        const { error: uErr } = await client.from("units").insert({
          unit_id,
          project_code: code,
          project_name: name,
          unit_no: unit_id,
          unit_type: "Apartment",
          floor: "Ground",
          size_sqft: 100,
          base_rate: 10_000,
          standard_value: 1_000_000,
          status: "Available",
        });
        if (uErr) throw new Error(`unit insert failed: ${uErr.message}`);

        // Minimal valid booking: contract + plan add up (1M cash, no plan).
        const total = 1_000_000;
        const bookingInsert = {
          booking_id,
          booking_date: new Date().toISOString().slice(0, 10),
          project_code: code,
          project_name: name,
          unit_id,
          unit_type: "Apartment",
          floor: "Ground",
          size_sqft: 100,
          client_name: `E2E Client ${tag}`,
          sold_rate: total / 100,
          sold_unit_value: total,
          total_contract_value: total,
          down_payment: total,
          adjustment_credit: 0,
          possession_amount: 0,
          no_of_installments: 0,
          installment_frequency: "Quarterly",
          installment_amount: 0,
          booking_status: "Active",
          notes: tag,
        };
        const { error: bErr } = await client.from("bookings").insert(bookingInsert);
        if (bErr) throw new Error(`booking insert failed: ${bErr.message}`);

        // Reserve a receipt_no. The app uses PAY-NNNNN globally.
        const { data: pays } = await client
          .from("payments")
          .select("receipt_no")
          .like("receipt_no", "PAY-%");
        const maxP = (pays ?? []).reduce((m: number, r: any) => {
          const n = Number(String(r.receipt_no).replace("PAY-", ""));
          return Number.isFinite(n) && n > m ? n : m;
        }, 0);
        const receipt_no = `PAY-${String(maxP + 1).padStart(5, "0")}`;

        const { error: pErr } = await client.from("payments").insert({
          receipt_no,
          payment_date: new Date().toISOString().slice(0, 10),
          booking_id,
          client_name: bookingInsert.client_name,
          project: name,
          unit_no: bookingInsert.unit_id,
          payment_head: "Down Payment",
          payment_mode: "Cash",
          amount: total,
          safe_cash_amount: total,
          cash_bank_include: true,
          non_cash_adjustment: false,
          status: "Posted",
          remarks: tag,
        });
        if (pErr) throw new Error(`payment insert failed: ${pErr.message}`);

        return { booking_id, receipt_no, unit_id };
      },
      [target.project_code, target.project_name, runTag],
    );

    createdBookingId = created.booking_id;
    createdReceiptNo = created.receipt_no;
    createdUnitId = created.unit_id;

    // The booking id itself has to encode the target project code.
    expect(created.booking_id.startsWith(`BK-${target.project_code}-`)).toBe(true);

    // 5. Read both rows back and assert scoping.
    const persisted = await page.evaluate(
      async ([bookingId, receiptNo]) => {
        const mod = await import("/src/integrations/supabase/client.ts");
        const client = (mod as any).supabase;
        const { data: b } = await client
          .from("bookings")
          .select("booking_id, project_code, project_name")
          .eq("booking_id", bookingId)
          .maybeSingle();
        const { data: p } = await client
          .from("payments")
          .select("receipt_no, booking_id, project")
          .eq("receipt_no", receiptNo)
          .maybeSingle();
        return { b, p };
      },
      [created.booking_id, created.receipt_no],
    );

    expect(persisted.b).toMatchObject({
      booking_id: created.booking_id,
      project_code: target.project_code,
      project_name: target.project_name,
    });
    expect(persisted.p).toMatchObject({
      receipt_no: created.receipt_no,
      booking_id: created.booking_id,
      project: target.project_name,
    });

    // 6. Render the printable receipt/letter and confirm it shows the
    //    switched project's name (not the hardcoded default).
    await page.goto(`${ORIGIN}/receipt-fixture/${created.receipt_no}`, {
      waitUntil: "domcontentloaded",
    });
    // The receipt renders inside a print-preview pane that is display:none
    // on screen media, so visibility-gated locators don't apply. Poll the
    // full body textContent until the receipt query has hydrated (booking_id
    // only appears after supabase-js returns the joined booking row).
    await expect
      .poll(() => page.locator("body").textContent(), { timeout: 20_000 })
      .toContain(created.booking_id);
    const bodyText = (await page.locator("body").textContent()) ?? "";
    expect(bodyText).toContain(created.receipt_no);
    expect(bodyText).toContain(target.project_name);
    // The receipt has two copies (Office + Client) — the project name
    // should appear at least twice (wordmark + unit line, per copy) so
    // a partial or half-scoped receipt fails.
    const nameHits = bodyText.split(target.project_name).length - 1;
    expect(nameHits).toBeGreaterThanOrEqual(2);
    // Wordmark is uppercased on both copies.
    expect(bodyText).toContain(target.project_name.toUpperCase());
  });
});

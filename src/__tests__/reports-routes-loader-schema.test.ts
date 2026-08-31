/**
 * Strict schema assertions for every loader result.
 *
 * For each report route with a loader we mock the underlying server fn
 * with a multi-row fixture and validate that the loader's return value:
 *
 *  1. matches a **strict** Zod schema for the top-level container
 *     (no unexpected keys),
 *  2. every row contains **all required fields** (including nested
 *     objects) with the correct types,
 *  3. nullable fields accept `null` but never `undefined` — missing
 *     required keys fail the assertion.
 *
 * Server functions are mocked so this exercises the route wiring, not
 * the database.
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// ---------- Fixtures ----------

const overdueFixture = [
  {
    ledger_id: "led-1",
    booking_id: "bk-1",
    client_name: "Ada Lovelace",
    project: "Skyline Tower",
    unit_no: "A-101",
    term_no: 3,
    due_date: "2026-06-01",
    due_amount: 100_000,
    paid_amount: 25_000,
    days_overdue: 47,
    status: "overdue",
  },
  {
    // Nullable-heavy row: every optional field is null, required ID present.
    ledger_id: "led-2",
    booking_id: null,
    client_name: null,
    project: null,
    unit_no: null,
    term_no: null,
    due_date: null,
    due_amount: null,
    paid_amount: null,
    days_overdue: null,
    status: null,
  },
];

const paymentFixture = [
  {
    receipt_no: "R-0001",
    payment_date: "2026-07-10",
    client_name: "Ada Lovelace",
    project: "Skyline Tower",
    unit_no: "A-101",
    payment_head: "installment",
    payment_mode: "bank",
    amount: 25_000,
    status: "posted",
  },
  {
    receipt_no: "R-0002",
    payment_date: null,
    client_name: null,
    project: null,
    unit_no: null,
    payment_head: null,
    payment_mode: null,
    amount: null,
    status: null,
  },
];

vi.mock("@/lib/reports.functions", () => ({
  listOverdueInstallments: vi.fn(async () => overdueFixture),
  listPaymentCollections: vi.fn(async () => paymentFixture),
}));

// ---------- Strict schemas ----------
//
// `.strict()` — reject unknown keys, guarding against loader-level leakage
// of raw DB columns.
// Nullable required fields are declared `z.<t>().nullable()` so a missing
// key (undefined) is a schema violation, but explicit `null` is accepted.

const overdueRowSchema = z
  .object({
    ledger_id: z.string().min(1),
    booking_id: z.string().nullable(),
    client_name: z.string().nullable(),
    project: z.string().nullable(),
    unit_no: z.string().nullable(),
    term_no: z.number().int().nullable(),
    due_date: z.string().nullable(),
    due_amount: z.number().nullable(),
    paid_amount: z.number().nullable(),
    days_overdue: z.number().int().nullable(),
    status: z.string().nullable(),
  })
  .strict();

const paymentRowSchema = z
  .object({
    receipt_no: z.string().min(1),
    payment_date: z.string().nullable(),
    client_name: z.string().nullable(),
    project: z.string().nullable(),
    unit_no: z.string().nullable(),
    payment_head: z.string().nullable(),
    payment_mode: z.string().nullable(),
    amount: z.number().nullable(),
    status: z.string().nullable(),
  })
  .strict();

const overdueLoaderSchema = z.object({ rows: z.array(overdueRowSchema) }).strict();

const paymentLoaderSchema = z.object({ rows: z.array(paymentRowSchema) }).strict();

// ---------- Route table ----------

type RouteCase = {
  path: string;
  routeModule: string;
  schema: z.ZodTypeAny;
  rowSchema: z.ZodTypeAny;
  requiredKeys: readonly string[];
  minRows: number;
};

const routeCases: RouteCase[] = [
  {
    path: "/_authenticated/reports/overdue",
    routeModule: "@/routes/_authenticated/reports.overdue",
    schema: overdueLoaderSchema,
    rowSchema: overdueRowSchema,
    requiredKeys: [
      "ledger_id",
      "booking_id",
      "client_name",
      "project",
      "unit_no",
      "term_no",
      "due_date",
      "due_amount",
      "paid_amount",
      "days_overdue",
      "status",
    ],
    minRows: 2,
  },
  {
    path: "/_authenticated/reports/payments",
    routeModule: "@/routes/_authenticated/reports.payments",
    schema: paymentLoaderSchema,
    rowSchema: paymentRowSchema,
    requiredKeys: [
      "receipt_no",
      "payment_date",
      "client_name",
      "project",
      "unit_no",
      "payment_head",
      "payment_mode",
      "amount",
      "status",
    ],
    minRows: 2,
  },
];

function stubLoaderArgs() {
  return {
    params: {},
    deps: {},
    context: {},
    location: { pathname: "/", search: {}, searchStr: "", hash: "", state: {}, href: "/" },
    abortController: new AbortController(),
    preload: false,
    cause: "enter" as const,
    parentMatchPromise: Promise.resolve(),
    route: {} as unknown,
    signal: new AbortController().signal,
  };
}

describe("report loaders — strict schema conformance", () => {
  for (const rc of routeCases) {
    describe(rc.path, () => {
      it("returns a value matching the strict top-level schema", async () => {
        const mod = (await import(rc.routeModule)) as {
          Route: { options: { loader?: (...a: never[]) => unknown } };
        };
        const loader = mod.Route.options.loader;
        expect(typeof loader).toBe("function");
        const result = await Promise.resolve(loader!(stubLoaderArgs() as never));
        const parsed = rc.schema.safeParse(result);
        if (!parsed.success) {
          throw new Error(
            `Strict schema failed for ${rc.path}: ${JSON.stringify(parsed.error.issues, null, 2)}`,
          );
        }
        expect(parsed.success).toBe(true);
      });

      it("every row contains all required fields with declared types", async () => {
        const mod = (await import(rc.routeModule)) as {
          Route: { options: { loader?: (...a: never[]) => unknown } };
        };
        const loader = mod.Route.options.loader!;
        const result = (await Promise.resolve(loader(stubLoaderArgs() as never))) as {
          rows: Record<string, unknown>[];
        };
        expect(result.rows.length).toBeGreaterThanOrEqual(rc.minRows);
        for (const [i, row] of result.rows.entries()) {
          for (const key of rc.requiredKeys) {
            expect(
              Object.prototype.hasOwnProperty.call(row, key),
              `${rc.path} row[${i}] missing key "${key}"`,
            ).toBe(true);
            expect(
              (row as Record<string, unknown>)[key],
              `${rc.path} row[${i}].${key} must not be undefined`,
            ).not.toBeUndefined();
          }
          const parsed = rc.rowSchema.safeParse(row);
          if (!parsed.success) {
            throw new Error(
              `Row ${i} of ${rc.path} failed schema: ${JSON.stringify(parsed.error.issues)}`,
            );
          }
        }
      });

      it("rejects a row missing a required field (schema is authoritative)", () => {
        // Meta-check: prove the schema catches shape drift, so a green
        // suite genuinely means loaders match the contract.
        const goodRow =
          rc.path === "/_authenticated/reports/overdue" ? overdueFixture[0] : paymentFixture[0];
        const idKey = rc.requiredKeys[0];

        const { [idKey]: _dropped, ...missing } = goodRow as Record<string, unknown>;
        const parsed = rc.rowSchema.safeParse(missing);
        expect(parsed.success).toBe(false);
      });

      it("rejects extra unknown keys (strict schema)", () => {
        const goodRow =
          rc.path === "/_authenticated/reports/overdue" ? overdueFixture[0] : paymentFixture[0];
        const extra = { ...goodRow, __leak__: "should not be here" };
        const parsed = rc.rowSchema.safeParse(extra);
        expect(parsed.success).toBe(false);
      });
    });
  }
});

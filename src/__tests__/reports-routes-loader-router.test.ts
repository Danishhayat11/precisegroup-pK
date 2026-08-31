/**
 * Router-level loader test.
 *
 * For every report route we import the route module (the same one the
 * generated router tree consumes) and invoke `Route.options.loader` — the
 * exact function TanStack Router calls during navigation — then validate
 * the returned JSON against a Zod schema. Routes without a loader are
 * asserted as such so the invariant "loader present ⇒ schema-conformant"
 * is enforced across the whole reports surface without throwing.
 *
 * Server functions used by loaders are mocked to fixtures so we test the
 * route wiring, not Supabase network access.
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// Mock the server-fn module BEFORE the route modules import it.
vi.mock("@/lib/reports.functions", () => {
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
  ];
  return {
    listOverdueInstallments: vi.fn(async () => overdueFixture),
    listPaymentCollections: vi.fn(async () => paymentFixture),
  };
});

const overdueRowSchema = z.object({
  ledger_id: z.string(),
  booking_id: z.string().nullable(),
  client_name: z.string().nullable(),
  project: z.string().nullable(),
  unit_no: z.string().nullable(),
  term_no: z.number().nullable(),
  due_date: z.string().nullable(),
  due_amount: z.number().nullable(),
  paid_amount: z.number().nullable(),
  days_overdue: z.number().nullable(),
  status: z.string().nullable(),
});

const paymentRowSchema = z.object({
  receipt_no: z.string(),
  payment_date: z.string().nullable(),
  client_name: z.string().nullable(),
  project: z.string().nullable(),
  unit_no: z.string().nullable(),
  payment_head: z.string().nullable(),
  payment_mode: z.string().nullable(),
  amount: z.number().nullable(),
  status: z.string().nullable(),
});

const loaderReturnSchemas: Record<string, z.ZodTypeAny> = {
  "/_authenticated/reports/overdue": z.object({ rows: z.array(overdueRowSchema) }),
  "/_authenticated/reports/payments": z.object({ rows: z.array(paymentRowSchema) }),
};

type RouteCase = {
  path: string;
  load: () => Promise<Record<string, unknown>>;
};

const routeCases: RouteCase[] = [
  {
    path: "/_authenticated/reports/overdue",
    load: () => import("@/routes/_authenticated/reports.overdue"),
  },
  {
    path: "/_authenticated/reports/payments",
    load: () => import("@/routes/_authenticated/reports.payments"),
  },
  {
    path: "/_authenticated/reports/bookings",
    load: () => import("@/routes/_authenticated/reports.bookings"),
  },
  {
    path: "/_authenticated/reports/cashflow",
    load: () => import("@/routes/_authenticated/reports.cashflow"),
  },
  {
    path: "/_authenticated/reports/outstanding",
    load: () => import("@/routes/_authenticated/reports.outstanding"),
  },
  {
    path: "/_authenticated/reports/adjustments",
    load: () => import("@/routes/_authenticated/reports.adjustments"),
  },
];

/** Minimal loader arg shape sufficient for our synchronous, no-input loaders. */
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

describe("report routes — router-level loader shape", () => {
  for (const { path, load } of routeCases) {
    it(`${path} loader returns JSON matching its schema (or has no loader)`, async () => {
      const mod = (await load()) as { Route: { options: { loader?: (...a: never[]) => unknown } } };
      const loader = mod.Route?.options?.loader;
      const schema = loaderReturnSchemas[path];

      if (typeof loader !== "function") {
        // Documented invariant: only routes with a corresponding server fn
        // ship a loader today. Assert explicitly so a silent regression
        // (loader added but no schema entry) is caught.
        expect(schema).toBeUndefined();
        return;
      }

      // A router-level call: exactly what `router.load({ to: path })` would do.
      const result = await Promise.resolve(loader(stubLoaderArgs() as never));
      expect(schema).toBeDefined();
      const parsed = schema!.safeParse(result);
      if (!parsed.success) {
        throw new Error(`Loader for ${path} returned an unexpected shape: ${parsed.error.message}`);
      }
      expect(parsed.success).toBe(true);
    });
  }

  it("every report route module exports a Route with an options object", async () => {
    for (const { path, load } of routeCases) {
      const mod = (await load()) as { Route?: { options?: unknown } };
      expect(mod.Route, `module ${path} must export Route`).toBeDefined();
      expect(mod.Route?.options).toBeDefined();
    }
  });
});

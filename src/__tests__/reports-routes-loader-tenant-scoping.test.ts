/**
 * Router-level tenant-scoping test.
 *
 * Invokes each report route's `Route.options.loader` — the same function
 * the router calls during navigation — under three simulated sessions:
 *
 *   • tenant "A" user  → sees only tenant-A rows
 *   • tenant "B" user  → sees only tenant-B rows
 *   • super admin      → sees rows from both tenants
 *
 * We don't hit Supabase. Instead we mock `@/lib/reports.functions` with a
 * fixture that mirrors the RLS + super-admin rules enforced at the DB
 * layer (`company_id = current_company_id()` for tenants, no filter for
 * super_admin). If a loader forgets to await the server fn, ignores its
 * result, or accidentally cross-imports another tenant's data source,
 * the assertions here fail — catching tenant-leak regressions in wiring
 * that RLS integration tests can't see (routes/loaders don't run in SQL).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Session = { companyId: string; superAdmin: boolean };

// Mutable session, flipped per test case.
let currentSession: Session = { companyId: "tenant-a", superAdmin: false };

const overdueFixture = [
  {
    ledger_id: "led-a-1",
    booking_id: "bk-a-1",
    client_name: "Ada Lovelace",
    project: "Skyline Tower",
    unit_no: "A-101",
    term_no: 3,
    due_date: "2026-06-01",
    due_amount: 100_000,
    paid_amount: 25_000,
    days_overdue: 47,
    status: "overdue",
    _company_id: "tenant-a",
  },
  {
    ledger_id: "led-b-1",
    booking_id: "bk-b-1",
    client_name: "Grace Hopper",
    project: "Ocean View",
    unit_no: "B-202",
    term_no: 1,
    due_date: "2026-05-15",
    due_amount: 200_000,
    paid_amount: 0,
    days_overdue: 64,
    status: "overdue",
    _company_id: "tenant-b",
  },
];

const paymentFixture = [
  {
    receipt_no: "R-A-0001",
    payment_date: "2026-07-10",
    client_name: "Ada Lovelace",
    project: "Skyline Tower",
    unit_no: "A-101",
    payment_head: "installment",
    payment_mode: "bank",
    amount: 25_000,
    status: "posted",
    _company_id: "tenant-a",
  },
  {
    receipt_no: "R-B-0001",
    payment_date: "2026-07-11",
    client_name: "Grace Hopper",
    project: "Ocean View",
    unit_no: "B-202",
    payment_head: "installment",
    payment_mode: "bank",
    amount: 50_000,
    status: "posted",
    _company_id: "tenant-b",
  },
];

function scoped<T extends { _company_id: string }>(rows: T[]): Omit<T, "_company_id">[] {
  const visible = currentSession.superAdmin
    ? rows
    : rows.filter((r) => r._company_id === currentSession.companyId);
  return visible.map(({ _company_id: _c, ...rest }) => rest);
}

vi.mock("@/lib/reports.functions", () => ({
  listOverdueInstallments: vi.fn(async () => scoped(overdueFixture)),
  listPaymentCollections: vi.fn(async () => scoped(paymentFixture)),
}));

type LoaderRoute = {
  path: string;
  load: () => Promise<Record<string, unknown>>;
  expectedIds: {
    tenantA: string[];
    tenantB: string[];
    superAdmin: string[];
  };
  idField: string;
};

const loaderRoutes: LoaderRoute[] = [
  {
    path: "/_authenticated/reports/overdue",
    load: () => import("@/routes/_authenticated/reports.overdue"),
    idField: "ledger_id",
    expectedIds: {
      tenantA: ["led-a-1"],
      tenantB: ["led-b-1"],
      superAdmin: ["led-a-1", "led-b-1"],
    },
  },
  {
    path: "/_authenticated/reports/payments",
    load: () => import("@/routes/_authenticated/reports.payments"),
    idField: "receipt_no",
    expectedIds: {
      tenantA: ["R-A-0001"],
      tenantB: ["R-B-0001"],
      superAdmin: ["R-A-0001", "R-B-0001"],
    },
  },
];

const loaderlessRoutes = [
  "@/routes/_authenticated/reports.bookings",
  "@/routes/_authenticated/reports.cashflow",
  "@/routes/_authenticated/reports.outstanding",
  "@/routes/_authenticated/reports.adjustments",
];

function stubLoaderArgs() {
  return {
    params: {},
    deps: {},
    context: {},
    location: {
      pathname: "/",
      search: {},
      searchStr: "",
      hash: "",
      state: {},
      href: "/",
    },
    abortController: new AbortController(),
    preload: false,
    cause: "enter" as const,
    parentMatchPromise: Promise.resolve(),
    route: {} as unknown,
    signal: new AbortController().signal,
  };
}

async function runLoader(load: () => Promise<Record<string, unknown>>) {
  const mod = (await load()) as {
    Route: { options: { loader?: (...a: never[]) => unknown } };
  };
  const loader = mod.Route.options.loader;
  if (typeof loader !== "function") {
    throw new Error("expected a loader");
  }
  return (await Promise.resolve(loader(stubLoaderArgs() as never))) as {
    rows: Array<Record<string, unknown>>;
  };
}

describe("report route loaders — tenant scoping", () => {
  beforeEach(() => {
    currentSession = { companyId: "tenant-a", superAdmin: false };
  });

  for (const route of loaderRoutes) {
    describe(route.path, () => {
      it("tenant A sees only tenant-A rows", async () => {
        currentSession = { companyId: "tenant-a", superAdmin: false };
        const { rows } = await runLoader(route.load);
        expect(rows.map((r) => r[route.idField])).toEqual(route.expectedIds.tenantA);
      });

      it("tenant B sees only tenant-B rows (no leak from A)", async () => {
        currentSession = { companyId: "tenant-b", superAdmin: false };
        const { rows } = await runLoader(route.load);
        const ids = rows.map((r) => r[route.idField]);
        expect(ids).toEqual(route.expectedIds.tenantB);
        expect(ids).not.toContain(route.expectedIds.tenantA[0]);
      });

      it("super admin sees rows from both tenants", async () => {
        currentSession = { companyId: "tenant-a", superAdmin: true };
        const { rows } = await runLoader(route.load);
        const ids = rows.map((r) => r[route.idField]).sort();
        expect(ids).toEqual([...route.expectedIds.superAdmin].sort());
      });

      it("no returned row carries a raw company_id field to the client", async () => {
        currentSession = { companyId: "tenant-a", superAdmin: true };
        const { rows } = await runLoader(route.load);
        for (const row of rows) {
          expect(row).not.toHaveProperty("company_id");
          expect(row).not.toHaveProperty("_company_id");
        }
      });
    });
  }

  it("loader-less report routes stay loader-less (invariant tracker)", async () => {
    for (const spec of loaderlessRoutes) {
      const mod = (await import(/* @vite-ignore */ spec)) as {
        Route?: { options?: { loader?: unknown } };
      };
      expect(mod.Route?.options?.loader, `${spec} unexpectedly gained a loader`).toBeUndefined();
    }
  });
});

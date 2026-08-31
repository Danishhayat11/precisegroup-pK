/**
 * Loader resilience tests.
 *
 * For every report route that ships a loader, we simulate missing or
 * malformed data returned by the underlying server function, plus the
 * server function throwing, and assert the loader responds with the
 * documented fallback shape (`{ rows: [] }`) or propagates the error
 * so the route's `errorComponent` can render.
 *
 * Server-fn modules are re-mocked per scenario with `vi.resetModules` +
 * `vi.doMock` so each case exercises a fresh loader import.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

type LoaderMod = {
  Route: { options: { loader?: (...a: never[]) => unknown } };
};

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

const fallbackShape = z.object({ rows: z.array(z.unknown()).length(0) });

type Scenario = {
  name: string;
  value: unknown;
};

const malformedScenarios: Scenario[] = [
  { name: "null", value: null },
  { name: "undefined", value: undefined },
  { name: "plain object (missing array)", value: { foo: "bar" } },
  { name: "string", value: "not an array" },
  { name: "number", value: 42 },
  { name: "boolean", value: false },
];

type RouteCase = {
  path: string;
  routePath: string;
  serverFnName: "listOverdueInstallments" | "listPaymentCollections";
  siblingFnName: "listOverdueInstallments" | "listPaymentCollections";
};

const routeCases: RouteCase[] = [
  {
    path: "overdue",
    routePath: "@/routes/_authenticated/reports.overdue",
    serverFnName: "listOverdueInstallments",
    siblingFnName: "listPaymentCollections",
  },
  {
    path: "payments",
    routePath: "@/routes/_authenticated/reports.payments",
    serverFnName: "listPaymentCollections",
    siblingFnName: "listOverdueInstallments",
  },
];

async function loadRouteWithMock(
  routeCase: RouteCase,
  impl: () => Promise<unknown>,
): Promise<LoaderMod> {
  vi.resetModules();
  vi.doMock("@/lib/reports.functions", () => ({
    [routeCase.serverFnName]: vi.fn(impl),
    // Keep the sibling defined so co-imports in other modules don't blow up.
    [routeCase.siblingFnName]: vi.fn(async () => []),
  }));
  return (await import(routeCase.routePath)) as LoaderMod;
}

describe("report loaders — malformed / missing data fallback", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  for (const routeCase of routeCases) {
    describe(`/reports/${routeCase.path}`, () => {
      for (const scenario of malformedScenarios) {
        it(`falls back to { rows: [] } when server fn returns ${scenario.name}`, async () => {
          const mod = await loadRouteWithMock(routeCase, async () => scenario.value);
          const loader = mod.Route.options.loader;
          expect(typeof loader).toBe("function");
          const result = await Promise.resolve(loader!(stubLoaderArgs() as never));
          const parsed = fallbackShape.safeParse(result);
          if (!parsed.success) {
            throw new Error(
              `Expected fallback { rows: [] } for ${scenario.name}, got: ${JSON.stringify(result)}`,
            );
          }
          expect(parsed.success).toBe(true);
        });
      }

      it("propagates a thrown error so the route's errorComponent can render", async () => {
        const boom = new Error("simulated backend failure");
        const mod = await loadRouteWithMock(routeCase, async () => {
          throw boom;
        });
        const loader = mod.Route.options.loader;
        expect(typeof loader).toBe("function");
        await expect(Promise.resolve(loader!(stubLoaderArgs() as never))).rejects.toThrow(
          "simulated backend failure",
        );
      });

      it("returns { rows: [] } when server fn resolves to an empty array", async () => {
        const mod = await loadRouteWithMock(routeCase, async () => []);
        const loader = mod.Route.options.loader;
        const result = await Promise.resolve(loader!(stubLoaderArgs() as never));
        expect(result).toEqual({ rows: [] });
      });
    });
  }
});

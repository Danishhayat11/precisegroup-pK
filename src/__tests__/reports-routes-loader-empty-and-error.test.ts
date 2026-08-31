/**
 * Per-report loader tests for the two canonical edge cases:
 *
 *   1. The underlying server function (RPC wrapper) resolves with no rows —
 *      loader MUST return the documented JSON shape `{ rows: [] }` with
 *      `rows` as a real array (never null/undefined/omitted).
 *   2. The underlying server function rejects (RPC error) — loader MUST
 *      propagate the error so the route's `errorComponent` renders,
 *      never swallow it into a success shape.
 *
 * These invariants are what the client UI and downstream tests rely on.
 * The existing `reports-routes-loader-fallback.test.ts` covers malformed
 * inputs; this file is scoped tightly to the empty-rows and RPC-error
 * contracts the user asked us to lock down.
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

const emptyShape = z.object({ rows: z.array(z.unknown()).length(0) }).strict();

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
    [routeCase.siblingFnName]: vi.fn(async () => []),
  }));
  return (await import(routeCase.routePath)) as LoaderMod;
}

describe("report loaders — empty rows and RPC error contracts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  for (const routeCase of routeCases) {
    describe(`/reports/${routeCase.path}`, () => {
      it("returns the documented { rows: [] } JSON shape when the RPC has no rows", async () => {
        const mod = await loadRouteWithMock(routeCase, async () => []);
        const loader = mod.Route.options.loader;
        expect(typeof loader).toBe("function");

        const result = await Promise.resolve(loader!(stubLoaderArgs() as never));

        // Shape lock: exactly `{ rows: [] }`, no extra keys, no null rows.
        const parsed = emptyShape.safeParse(result);
        if (!parsed.success) {
          throw new Error(`Expected exact { rows: [] } shape, got: ${JSON.stringify(result)}`);
        }

        // Serializable, JSON-round-trippable — this is what the router
        // hands to the component tree.
        expect(JSON.parse(JSON.stringify(result))).toEqual({ rows: [] });

        const asObj = result as { rows: unknown };
        expect(Array.isArray(asObj.rows)).toBe(true);
        expect((asObj.rows as unknown[]).length).toBe(0);
      });

      it("propagates RPC errors instead of returning a success shape", async () => {
        const rpcError = Object.assign(new Error("RPC failed: relation missing"), {
          code: "PGRST301",
        });
        const mod = await loadRouteWithMock(routeCase, async () => {
          throw rpcError;
        });
        const loader = mod.Route.options.loader;
        expect(typeof loader).toBe("function");

        let caught: unknown;
        try {
          await Promise.resolve(loader!(stubLoaderArgs() as never));
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toBe("RPC failed: relation missing");
        expect((caught as { code?: string }).code).toBe("PGRST301");
      });

      it("propagates non-Error RPC rejections verbatim (e.g. PostgREST error objects)", async () => {
        const postgrestLike = {
          message: "permission denied for table x",
          code: "42501",
          details: null,
          hint: null,
        };
        const mod = await loadRouteWithMock(routeCase, async () => {
          throw postgrestLike;
        });
        const loader = mod.Route.options.loader;

        await expect(Promise.resolve(loader!(stubLoaderArgs() as never))).rejects.toBe(
          postgrestLike,
        );
      });
    });
  }
});

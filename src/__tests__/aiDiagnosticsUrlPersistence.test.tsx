/**
 * URL persistence contract for the AI Diagnostics page.
 *
 * The page persists every user-controlled bit of state — search text,
 * filters (status/retry/tool), sort (field + direction), and pagination
 * (page + size) — in the URL search string. That's what makes:
 *   • REFRESH        → the exact same view rehydrate,
 *   • SHARE          → a pasted link reproduce the sender's view, and
 *   • BACK / FORWARD → each intermediate view be re-created faithfully.
 *
 * These tests exercise both directions of that contract:
 *
 *   1. READ  (schema half): given a query string a browser hands us on
 *      refresh or from a pasted link, `aiDiagnosticsSearchSchema` parses
 *      it to the exact typed shape the page component reads.
 *   2. WRITE + HISTORY (integration half): mount TanStack Router with an
 *      in-memory history preloaded with the same schema on a stub route,
 *      then drive URL mutations the way the page does (via `navigate`),
 *      pop history entries with `history.back()` / `history.forward()`,
 *      and assert the surfaced search state matches at every step.
 *
 * Together they prove: whatever the page writes to the URL, the schema
 * later reads back identically — no drift possible on refresh, share,
 * or back/forward.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
  RouterProvider,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { aiDiagnosticsSearchSchema } from "@/routes/_authenticated/admin.ai-diagnostics";

// ---------------------------------------------------------------------------
// 1. READ half — pure schema tests.
// ---------------------------------------------------------------------------

describe("aiDiagnosticsSearchSchema (URL → state)", () => {
  it("parses an empty URL to all-undefined (i.e. every default)", () => {
    expect(aiDiagnosticsSearchSchema.parse({})).toEqual({});
  });

  it("round-trips a fully populated shared link", () => {
    const shared = {
      q: "invoice",
      status: "tool-error" as const,
      retry: "sanitized" as const,
      tool: "create_booking",
      sort: "tool" as const,
      dir: "asc" as const,
      page: 3,
      size: 50,
      limit: 100,
    };
    expect(aiDiagnosticsSearchSchema.parse(shared)).toEqual(shared);
  });

  it("coerces numeric strings (URLs are always strings) for page/size/limit", () => {
    expect(aiDiagnosticsSearchSchema.parse({ page: "4", size: "25", limit: "200" })).toEqual({
      page: 4,
      size: 25,
      limit: 200,
    });
  });

  it("rejects invalid enum values so a tampered link cannot inject state", () => {
    expect(() => aiDiagnosticsSearchSchema.parse({ status: "bogus" })).toThrow();
    expect(() => aiDiagnosticsSearchSchema.parse({ dir: "sideways" })).toThrow();
    expect(() => aiDiagnosticsSearchSchema.parse({ sort: "created_at" })).toThrow();
  });

  it("rejects non-positive page / size (guards refresh loops)", () => {
    expect(() => aiDiagnosticsSearchSchema.parse({ page: 0 })).toThrow();
    expect(() => aiDiagnosticsSearchSchema.parse({ size: -1 })).toThrow();
    expect(() => aiDiagnosticsSearchSchema.parse({ page: 1.5 })).toThrow();
  });

  it("accepts every legal (status, retry, sort, dir) combo", () => {
    const statuses = ["all", "success", "tool-error", "gateway-error", "in-flight"] as const;
    const retries = ["all", "primary", "sanitized", "safe-default", "non-primary"] as const;
    const sorts = ["time", "status", "tool"] as const;
    const dirs = ["asc", "desc"] as const;
    for (const status of statuses)
      for (const retry of retries)
        for (const sort of sorts)
          for (const dir of dirs)
            expect(aiDiagnosticsSearchSchema.parse({ status, retry, sort, dir })).toEqual({
              status,
              retry,
              sort,
              dir,
            });
  });
});

// ---------------------------------------------------------------------------
// 2. WRITE + HISTORY half — TanStack Router with in-memory history.
//
// We mount a *stub* route that reuses `aiDiagnosticsSearchSchema` verbatim
// and mirrors the AiDiagnosticsPage `patchSearch` behaviour (merge, drop
// undefined → strip from URL, replace: true). The router then owns the URL
// exactly as the real app does; we can pop history entries and assert.
// ---------------------------------------------------------------------------

// Mirrors the AiDiagnosticsPage `patchSearch` helper 1:1.
function usePatchSearch() {
  const navigate = useNavigate();
  return (patch: Record<string, string | number | undefined>) =>
    navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...prev, ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        return next;
      }) as never,
      replace: true,
    });
}

function Probe() {
  const search = useSearch({ strict: false });
  // Deterministic key ordering so text-content matches are stable.
  const sorted = Object.fromEntries(Object.entries(search).sort(([a], [b]) => a.localeCompare(b)));
  return <div data-testid="search-state">{JSON.stringify(sorted)}</div>;
}

// Exposes patch + navigate for the test to drive.
let patchRef:
  | ((patch: Record<string, string | number | undefined>) => Promise<unknown> | void)
  | null = null;
let navRef: ReturnType<typeof useNavigate> | null = null;
function Driver() {
  patchRef = usePatchSearch();
  navRef = useNavigate();
  return null;
}

function mountRouter(initialUrl: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Driver />
        <Outlet />
      </>
    ),
  });
  const stubRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/ai-diagnostics",
    validateSearch: aiDiagnosticsSearchSchema,
    component: Probe,
  });
  // Fallback for any other path (e.g. "/") so memory-history init cannot 404.
  const catchAll = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: Probe,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([stubRoute, catchAll]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  });
  return router;
}

async function readState(): Promise<Record<string, unknown>> {
  const raw = (await screen.findByTestId("search-state")).textContent ?? "{}";
  return JSON.parse(raw);
}

async function flush() {
  // Let router microtasks settle after a navigate().
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AiDiagnostics URL persistence — refresh / share / back / forward", () => {
  afterEach(() => {
    patchRef = null;
    navRef = null;
    cleanup();
  });

  it("REFRESH: mounting on a full URL rehydrates every field", async () => {
    const url =
      "/admin/ai-diagnostics?q=hello&status=tool-error&retry=sanitized&tool=t&sort=tool&dir=asc&page=2&size=50";
    const router = mountRouter(url);
    render(<RouterProvider router={router} />);
    await flush();
    expect(await readState()).toEqual({
      dir: "asc",
      page: 2,
      q: "hello",
      retry: "sanitized",
      size: 50,
      sort: "tool",
      status: "tool-error",
      tool: "t",
    });
  });

  it("SHARE: two independent mounts of the same URL yield identical state", async () => {
    const url = "/admin/ai-diagnostics?q=abc&status=success&page=4";
    const first = mountRouter(url);
    const { unmount } = render(<RouterProvider router={first} />);
    await flush();
    const senderState = await readState();
    unmount();

    const second = mountRouter(url);
    render(<RouterProvider router={second} />);
    await flush();
    expect(await readState()).toEqual(senderState);
  });

  it("WRITE: patchSearch adds params, and default values are stripped from the URL", async () => {
    const router = mountRouter("/admin/ai-diagnostics");
    render(<RouterProvider router={router} />);
    await flush();

    // Apply a filter + sort.
    await act(async () => {
      await patchRef!({ status: "tool-error", sort: "tool", dir: "asc", page: 3 });
    });
    await flush();
    expect(await readState()).toEqual({
      dir: "asc",
      page: 3,
      sort: "tool",
      status: "tool-error",
    });
    // The URL itself reflects the same state (no stray keys).
    expect(router.state.location.searchStr).toBe("?status=tool-error&sort=tool&dir=asc&page=3");

    // Setting a field back to its default (`dir: undefined`) removes it.
    await act(async () => {
      await patchRef!({ dir: undefined });
    });
    await flush();
    const afterReset = await readState();
    expect(afterReset).not.toHaveProperty("dir");
    expect(afterReset).toMatchObject({ status: "tool-error", sort: "tool", page: 3 });
  });

  it("BACK / FORWARD: history preserves prior URL search state at every step", async () => {
    // Start on a bare URL, then make TWO distinct navigations (non-replace)
    // so browser history has three entries to walk.
    const router = mountRouter("/admin/ai-diagnostics");
    render(<RouterProvider router={router} />);
    await flush();
    expect(await readState()).toEqual({});

    // Step 1: filter by status=tool-error (push, so back can return here).
    await act(async () => {
      await navRef!({
        to: ".",
        search: { status: "tool-error" } as never,
      });
    });
    await flush();
    expect(await readState()).toEqual({ status: "tool-error" });

    // Step 2: also change sort direction (push again).
    await act(async () => {
      await navRef!({
        to: ".",
        search: { status: "tool-error", sort: "tool", dir: "asc" } as never,
      });
    });
    await flush();
    expect(await readState()).toEqual({
      dir: "asc",
      sort: "tool",
      status: "tool-error",
    });

    // BACK once → step 1's URL.
    await act(async () => {
      router.history.back();
    });
    await flush();
    expect(await readState()).toEqual({ status: "tool-error" });

    // BACK again → initial empty state.
    await act(async () => {
      router.history.back();
    });
    await flush();
    expect(await readState()).toEqual({});

    // FORWARD → back to step 1.
    await act(async () => {
      router.history.forward();
    });
    await flush();
    expect(await readState()).toEqual({ status: "tool-error" });

    // FORWARD → back to step 2 (full sort applied).
    await act(async () => {
      router.history.forward();
    });
    await flush();
    expect(await readState()).toEqual({
      dir: "asc",
      sort: "tool",
      status: "tool-error",
    });
  });
});

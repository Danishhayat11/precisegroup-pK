/**
 * Integration test: AI Diagnostics "Reset filters" contract.
 *
 * Behaviour under test (mirrors AiDiagnosticsPage.resetFilters exactly):
 *   • Clears every FILTER-shaped URL param: q, status, retry, tool.
 *   • Returns to page 1 (strips ?page).
 *   • PRESERVES view preferences the user set separately: sort field,
 *     sort direction, page size. Losing those on reset would punish
 *     users who curated a "50 rows, sorted by tool asc" workspace.
 *   • Fires a SINGLE URL update — one history entry — so Back returns
 *     to the pre-reset state, not to each individually cleared field.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { aiDiagnosticsSearchSchema } from "../../routes/_authenticated/admin.ai-diagnostics";
import { useAiDiagnosticsSort, type SortDir, type SortKey } from "../aiDiagnosticsSort";

type StatusFilter = "all" | "success" | "tool-error" | "gateway-error" | "in-flight";
type RetryFilter = "all" | "primary" | "sanitized" | "safe-default" | "non-primary";

function ResetHarness() {
  const sp = useSearch({ strict: false }) as {
    q?: string;
    status?: StatusFilter;
    retry?: RetryFilter;
    tool?: string;
    sort?: SortKey;
    dir?: SortDir;
    page?: number;
    size?: number;
  };
  const navigate = useNavigate();

  const patchSearch = (patch: Record<string, string | number | undefined>) =>
    navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...prev, ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        return next;
      }) as never,
      replace: false, // real page uses default (history push) here.
    });

  const search = sp.q ?? "";
  const status: StatusFilter = sp.status ?? "all";
  const retry: RetryFilter = sp.retry ?? "all";
  const toolName = sp.tool ?? "all";
  const page = sp.page ?? 1;
  const size = sp.size ?? 25;

  const { sortKey, sortDir } = useAiDiagnosticsSort({
    urlSort: sp.sort,
    urlDir: sp.dir,
    patchSearch: (p) => patchSearch(p as Record<string, string | undefined>),
  });

  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    (status !== "all" ? 1 : 0) +
    (retry !== "all" ? 1 : 0) +
    (toolName !== "all" ? 1 : 0);

  // EXACT copy of AiDiagnosticsPage.resetFilters — sort/size/direction
  // intentionally omitted so we're testing the shipped contract, not a
  // re-invented one.
  const resetFilters = () =>
    patchSearch({
      q: undefined,
      status: undefined,
      retry: undefined,
      tool: undefined,
      page: undefined,
    });

  return (
    <div>
      <div data-testid="q">{search}</div>
      <div data-testid="status">{status}</div>
      <div data-testid="retry">{retry}</div>
      <div data-testid="tool">{toolName}</div>
      <div data-testid="page">{String(page)}</div>
      <div data-testid="size">{String(size)}</div>
      <div data-testid="sort">{`${sortKey}:${sortDir}`}</div>
      <div data-testid="active-filter-count">{String(activeFilterCount)}</div>
      {activeFilterCount > 0 && (
        <button type="button" onClick={resetFilters}>
          Reset filters
        </button>
      )}
    </div>
  );
}

function mountRouter(initialUrl: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const stubRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/ai-diagnostics",
    validateSearch: aiDiagnosticsSearchSchema,
    component: ResetHarness,
  });
  const catchAll = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([stubRoute, catchAll]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function currentUrl(router: ReturnType<typeof mountRouter>): string {
  const loc = router.state.location;
  return `${loc.pathname}${loc.searchStr ?? ""}`;
}

// ---------------------------------------------------------------------------
describe('AiDiagnostics "Reset filters" — URL contract', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("clears q, status, retry, tool AND resets page → 1 (all params stripped)", async () => {
    const user = userEvent.setup();
    const router = mountRouter(
      "/admin/ai-diagnostics?q=err&status=success&retry=sanitized&tool=list_bookings&page=4",
    );
    render(<RouterProvider router={router} />);
    await flush();

    // Precondition — everything hydrated from the URL.
    expect(screen.getByTestId("q").textContent).toBe("err");
    expect(screen.getByTestId("status").textContent).toBe("success");
    expect(screen.getByTestId("retry").textContent).toBe("sanitized");
    expect(screen.getByTestId("tool").textContent).toBe("list_bookings");
    expect(screen.getByTestId("page").textContent).toBe("4");
    expect(screen.getByTestId("active-filter-count").textContent).toBe("4");

    await user.click(screen.getByRole("button", { name: /reset filters/i }));
    await flush();

    // All four filters cleared to defaults.
    expect(screen.getByTestId("q").textContent).toBe("");
    expect(screen.getByTestId("status").textContent).toBe("all");
    expect(screen.getByTestId("retry").textContent).toBe("all");
    expect(screen.getByTestId("tool").textContent).toBe("all");
    // Page reset to 1.
    expect(screen.getByTestId("page").textContent).toBe("1");
    // Every param stripped from the URL — bare canonical path.
    const url = currentUrl(router);
    expect(url).not.toContain("q=");
    expect(url).not.toContain("status=");
    expect(url).not.toContain("retry=");
    expect(url).not.toContain("tool=");
    expect(url).not.toContain("page=");
    // Button hides once nothing is active.
    expect(screen.queryByRole("button", { name: /reset filters/i })).toBeNull();
    expect(screen.getByTestId("active-filter-count").textContent).toBe("0");
  });

  it("PRESERVES sort field + direction + page size across a reset", async () => {
    const user = userEvent.setup();
    // Filters set alongside a non-default sort AND non-default size.
    const router = mountRouter("/admin/ai-diagnostics?q=err&sort=tool&dir=asc&size=100&page=3");
    render(<RouterProvider router={router} />);
    await flush();

    expect(screen.getByTestId("sort").textContent).toBe("tool:asc");
    expect(screen.getByTestId("size").textContent).toBe("100");

    await user.click(screen.getByRole("button", { name: /reset filters/i }));
    await flush();

    // Sort + size survived the reset — that's the whole point.
    expect(screen.getByTestId("sort").textContent).toBe("tool:asc");
    expect(screen.getByTestId("size").textContent).toBe("100");
    expect(screen.getByTestId("page").textContent).toBe("1");
    const url = currentUrl(router);
    expect(url).toContain("sort=tool");
    expect(url).toContain("dir=asc");
    expect(url).toContain("size=100");
    // But the FILTER param is gone.
    expect(url).not.toContain("q=");
    expect(url).not.toContain("page=");
  });

  it("fires exactly ONE history entry so Back returns to the pre-reset view", async () => {
    const user = userEvent.setup();
    const router = mountRouter("/admin/ai-diagnostics?q=err&status=success&tool=list_bookings");
    render(<RouterProvider router={router} />);
    await flush();

    const historyLenBefore = router.history.length;

    await user.click(screen.getByRole("button", { name: /reset filters/i }));
    await flush();

    // Exactly one new entry, not one-per-cleared-field.
    expect(router.history.length).toBe(historyLenBefore + 1);
    expect(screen.getByTestId("q").textContent).toBe("");
    expect(screen.getByTestId("status").textContent).toBe("all");
    expect(screen.getByTestId("tool").textContent).toBe("all");

    // Back returns to the pre-reset state in a single step.
    await act(async () => {
      router.history.back();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(screen.getByTestId("q").textContent).toBe("err");
    expect(screen.getByTestId("status").textContent).toBe("success");
    expect(screen.getByTestId("tool").textContent).toBe("list_bookings");
  });

  it("with only sort/size non-default (no filters), the Reset button is not rendered", async () => {
    const router = mountRouter("/admin/ai-diagnostics?sort=tool&dir=asc&size=100");
    render(<RouterProvider router={router} />);
    await flush();

    expect(screen.getByTestId("active-filter-count").textContent).toBe("0");
    expect(screen.queryByRole("button", { name: /reset filters/i })).toBeNull();
  });
});

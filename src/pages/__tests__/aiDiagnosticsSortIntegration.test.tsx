/**
 * Integration test: sorting on the AI Diagnostics table.
 *
 * The real page composes THREE moving parts to make sorting stick
 * across refreshes and shared links:
 *
 *   1. `SortableColumnHeader` — the clickable / keyboard-operable UI
 *      that publishes the user's chosen sort via `onToggle`.
 *   2. `useAiDiagnosticsSort` — writes the choice to BOTH the URL
 *      (source of truth) and localStorage (fallback for the next
 *      visit), and hydrates the URL from localStorage on mount when
 *      the URL is bare.
 *   3. TanStack Router's search-params + memory history — makes the
 *      URL the app can be refreshed / shared from.
 *
 * We wire all three together against `aiDiagnosticsSearchSchema` and
 * an in-memory history so the test drives the same code the shipped
 * page runs, then asserts:
 *   • Click on a header → URL params update (defaults are stripped).
 *   • Click on a header → localStorage writes the exact same choice.
 *   • Refresh (unmount + remount) with the URL bare and localStorage
 *     populated → URL rehydrates from localStorage → the same column
 *     header still shows aria-sort matching the chosen direction.
 *   • An explicit URL sort always wins over localStorage (deep links
 *     are sacred).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import {
  useAiDiagnosticsSort,
  SORT_STORAGE_KEY,
  type SortKey,
  type SortDir,
} from "../aiDiagnosticsSort";
import { SortableColumnHeader } from "@/components/ai-diagnostics/SortableColumnHeader";

// ---------------------------------------------------------------------------
// Mounted UI that mirrors the sort surface of AiDiagnosticsPage. The three
// column headers, the URL patcher, and the hook are the exact ones the real
// page uses — nothing here is a re-implementation.
// ---------------------------------------------------------------------------
const COLUMNS: Array<{ key: SortKey; label: string; defaultDir: SortDir }> = [
  { key: "time", label: "Time", defaultDir: "desc" },
  { key: "status", label: "Status", defaultDir: "asc" },
  { key: "tool", label: "Tool name", defaultDir: "asc" },
];

function SortHarness() {
  const sp = useSearch({ strict: false }) as { sort?: SortKey; dir?: SortDir };
  const navigate = useNavigate();
  const patchSearch = (patch: { sort?: SortKey | undefined; dir?: SortDir | undefined }) =>
    navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...prev, ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        return next;
      }) as never,
      replace: true,
    });
  const { sortKey, sortDir, setSort } = useAiDiagnosticsSort({
    urlSort: sp.sort,
    urlDir: sp.dir,
    patchSearch,
  });
  return (
    <>
      <div data-testid="active-sort">{`${sortKey}:${sortDir}`}</div>
      <div role="row">
        {COLUMNS.map((c) => (
          <SortableColumnHeader
            key={c.key}
            columnKey={c.key}
            label={c.label}
            active={sortKey === c.key}
            sortDir={sortDir}
            defaultDir={c.defaultDir}
            onToggle={(next) => setSort(c.key, next)}
          />
        ))}
      </div>
    </>
  );
}

function mountRouter(initialUrl: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const stubRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/ai-diagnostics",
    validateSearch: aiDiagnosticsSearchSchema,
    component: SortHarness,
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
  // Two microtask ticks are enough for a navigate() + subsequent effect.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function readActiveSort(): string {
  return screen.getByTestId("active-sort").textContent ?? "";
}

function headerFor(label: string): HTMLElement {
  // The SortableColumnHeader wraps a native <button> in the columnheader div;
  // aria-sort lives on the wrapper.
  return screen
    .getByRole("button", { name: new RegExp(`^Sort by ${label}`, "i") })
    .closest('[role="columnheader"]') as HTMLElement;
}

function readStoredJson(): { sort?: SortKey; dir?: SortDir } | null {
  const raw = window.localStorage.getItem(SORT_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function currentUrl(router: ReturnType<typeof mountRouter>): string {
  const loc = router.state.location;
  return `${loc.pathname}${loc.searchStr ?? ""}`;
}

// ---------------------------------------------------------------------------

describe("AiDiagnostics sorting — URL, localStorage, refresh", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => cleanup());

  it("clicking Tool name pushes ?sort=tool&dir=asc AND writes localStorage", async () => {
    const user = userEvent.setup();
    const router = mountRouter("/admin/ai-diagnostics");
    render(<RouterProvider router={router} />);
    await flush();

    // Default state — no URL params, no storage.
    expect(readActiveSort()).toBe("time:desc");
    expect(headerFor("Time").getAttribute("aria-sort")).toBe("descending");
    expect(readStoredJson()).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Sort by Tool name/i }));
    await flush();

    // URL now carries the non-default sort choice.
    expect(currentUrl(router)).toContain("sort=tool");
    expect(currentUrl(router)).toContain("dir=asc");

    // Both the visible state and aria-sort reflect the pick.
    expect(readActiveSort()).toBe("tool:asc");
    expect(headerFor("Tool name").getAttribute("aria-sort")).toBe("ascending");
    expect(headerFor("Time").getAttribute("aria-sort")).toBe("none");

    // Storage mirrors the URL.
    expect(readStoredJson()).toEqual({ sort: "tool", dir: "asc" });
  });

  it("re-clicking the active header flips the direction in URL + storage", async () => {
    const user = userEvent.setup();
    const router = mountRouter("/admin/ai-diagnostics?sort=status&dir=asc");
    render(<RouterProvider router={router} />);
    await flush();

    expect(readActiveSort()).toBe("status:asc");
    await user.click(screen.getByRole("button", { name: /^Sort by Status/i }));
    await flush();

    expect(readActiveSort()).toBe("status:desc");
    expect(headerFor("Status").getAttribute("aria-sort")).toBe("descending");
    // desc on a non-time column is not the column's default dir here, so
    // it MUST stay in the URL — otherwise a refresh would flip back to asc.
    expect(currentUrl(router)).toContain("sort=status");
    expect(currentUrl(router)).not.toMatch(/dir=asc/);
    expect(readStoredJson()).toEqual({ sort: "status", dir: "desc" });
  });

  it("selecting the default sort (time desc) STRIPS both params from the URL", async () => {
    const user = userEvent.setup();
    const router = mountRouter("/admin/ai-diagnostics?sort=tool&dir=asc");
    render(<RouterProvider router={router} />);
    await flush();

    // From tool:asc, one click on Time switches to Time with its
    // defaultDir=desc — which happens to be the app default too.
    await user.click(screen.getByRole("button", { name: /^Sort by Time/i }));
    await flush();

    expect(readActiveSort()).toBe("time:desc");
    expect(currentUrl(router)).not.toContain("sort=");
    expect(currentUrl(router)).not.toContain("dir=");
    // Storage still holds the raw choice — it's a fallback, not a mirror
    // of URL-defaults-stripped state.
    expect(readStoredJson()).toEqual({ sort: "time", dir: "desc" });
  });

  it("REFRESH: bare URL + localStorage → header re-hydrates the same sort", async () => {
    const user = userEvent.setup();

    // Turn 1: user picks Tool asc.
    const first = mountRouter("/admin/ai-diagnostics");
    const { unmount } = render(<RouterProvider router={first} />);
    await flush();
    await user.click(screen.getByRole("button", { name: /^Sort by Tool name/i }));
    await flush();
    expect(readStoredJson()).toEqual({ sort: "tool", dir: "asc" });
    unmount();

    // Turn 2: user comes back to a bare URL (e.g. clicked the sidebar
    // link, no ?sort=...). localStorage should re-hydrate the URL AND
    // the header aria-sort should reflect it after the effect runs.
    const second = mountRouter("/admin/ai-diagnostics");
    render(<RouterProvider router={second} />);
    await flush();

    expect(readActiveSort()).toBe("tool:asc");
    expect(headerFor("Tool name").getAttribute("aria-sort")).toBe("ascending");
    // URL was written from storage on mount.
    expect(currentUrl(second)).toContain("sort=tool");
    expect(currentUrl(second)).toContain("dir=asc");
  });

  it("SHARE: explicit URL sort wins over a different localStorage preference", async () => {
    // Storage says tool:asc, but the shared link is status:desc — the
    // link must win, storage must NOT clobber it.
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ sort: "tool", dir: "asc" }));
    const router = mountRouter("/admin/ai-diagnostics?sort=status");
    render(<RouterProvider router={router} />);
    await flush();

    expect(readActiveSort()).toBe("status:desc");
    expect(headerFor("Status").getAttribute("aria-sort")).toBe("descending");
    expect(headerFor("Tool name").getAttribute("aria-sort")).toBe("none");
    // Deep link is preserved verbatim; storage was NOT written back.
    expect(currentUrl(router)).toContain("sort=status");
    expect(readStoredJson()).toEqual({ sort: "tool", dir: "asc" });
  });

  it("KEYBOARD: Tab to Tool header, Enter picks it, Space flips direction", async () => {
    const user = userEvent.setup();
    const router = mountRouter("/admin/ai-diagnostics");
    render(<RouterProvider router={router} />);
    await flush();

    // Focus the Tool name header button via keyboard only. userEvent.tab()
    // walks the natural tab order — Time, Status, Tool — so three tabs
    // land on the Tool name header.
    await user.tab();
    await user.tab();
    await user.tab();
    const tool = screen.getByRole("button", { name: /^Sort by Tool name/i });
    expect(document.activeElement).toBe(tool);

    // Enter activates the button (native <button> semantics).
    await user.keyboard("{Enter}");
    await flush();

    expect(readActiveSort()).toBe("tool:asc");
    expect(headerFor("Tool name").getAttribute("aria-sort")).toBe("ascending");
    expect(currentUrl(router)).toContain("sort=tool");
    expect(currentUrl(router)).toContain("dir=asc");
    expect(readStoredJson()).toEqual({ sort: "tool", dir: "asc" });

    // Space flips the direction on the already-active header.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Sort by Tool name/i }),
    );
    await user.keyboard(" ");
    await flush();

    expect(readActiveSort()).toBe("tool:desc");
    expect(headerFor("Tool name").getAttribute("aria-sort")).toBe("descending");
    // `dir=desc` matches the app-wide default direction, so the URL
    // patcher strips it — storage keeps the raw choice.
    expect(currentUrl(router)).toContain("sort=tool");
    expect(currentUrl(router)).not.toContain("dir=");
    expect(readStoredJson()).toEqual({ sort: "tool", dir: "desc" });
  });

  it("BACK/FORWARD: navigating history reruns the URL → display pipeline", async () => {
    // Two history entries: bare (default sort) then an explicit tool:asc
    // link. Start on the explicit one, then walk back and forward.
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const stubRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/admin/ai-diagnostics",
      validateSearch: aiDiagnosticsSearchSchema,
      component: SortHarness,
    });
    const catchAll = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => null,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([stubRoute, catchAll]),
      history: createMemoryHistory({
        initialEntries: ["/admin/ai-diagnostics", "/admin/ai-diagnostics?sort=tool&dir=asc"],
        initialIndex: 1,
      }),
    });
    render(<RouterProvider router={router} />);
    await flush();

    // Start: explicit tool:asc URL — display + aria-sort agree.
    expect(readActiveSort()).toBe("tool:asc");
    expect(headerFor("Tool name").getAttribute("aria-sort")).toBe("ascending");
    expect(currentUrl(router)).toContain("sort=tool");

    // Back → bare URL → default sort re-derived from the URL.
    await act(async () => {
      router.history.back();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(readActiveSort()).toBe("time:desc");
    expect(headerFor("Time").getAttribute("aria-sort")).toBe("descending");
    expect(headerFor("Tool name").getAttribute("aria-sort")).toBe("none");
    expect(currentUrl(router)).not.toContain("sort=");

    // Forward → back to tool:asc — display re-syncs from the URL, not
    // from stale state left over on the component.
    await act(async () => {
      router.history.forward();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(readActiveSort()).toBe("tool:asc");
    expect(headerFor("Tool name").getAttribute("aria-sort")).toBe("ascending");
    expect(headerFor("Time").getAttribute("aria-sort")).toBe("none");
    expect(currentUrl(router)).toContain("sort=tool");
    expect(currentUrl(router)).toContain("dir=asc");
  });
});

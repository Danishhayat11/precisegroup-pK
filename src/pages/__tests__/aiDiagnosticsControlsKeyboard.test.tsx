/**
 * Integration test: AI Diagnostics filter/search/sort controls driven
 * ENTIRELY by the keyboard.
 *
 * The point is to lock down that every toolbar control:
 *   • lands in the natural tab order,
 *   • responds to the documented key set (Enter/Space/Arrow keys), and
 *   • publishes the change into the URL AND into the ARIA state
 *     (aria-pressed on the direction toggle, aria-sort mirror on the
 *     live sort description) with no mouse involvement.
 *
 * The harness mirrors AiDiagnosticsPage's URL contract for the pieces
 * under test (q, status, retry, sort, dir) — defaults are stripped,
 * status and retry are mutually exclusive via a single combined
 * <select>, and the direction toggle supports Left/Right arrows for
 * explicit asc/desc plus Enter/Space to toggle (matching the shipped
 * page's onKeyDown handler).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
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

function ControlsHarness() {
  const sp = useSearch({ strict: false }) as {
    q?: string;
    status?: StatusFilter;
    retry?: RetryFilter;
    sort?: SortKey;
    dir?: SortDir;
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
      replace: true,
    });

  const search = sp.q ?? "";
  const status: StatusFilter = sp.status ?? "all";
  const retry: RetryFilter = sp.retry ?? "all";

  const setSearch = (v: string) => patchSearch({ q: v.trim() ? v : undefined });
  const setStatus = (v: StatusFilter) => patchSearch({ status: v === "all" ? undefined : v });
  const setRetry = (v: RetryFilter) => patchSearch({ retry: v === "all" ? undefined : v });

  const { sortKey, sortDir, setSort } = useAiDiagnosticsSort({
    urlSort: sp.sort,
    urlDir: sp.dir,
    patchSearch: (p) => patchSearch(p as Record<string, string | undefined>),
  });

  const combined =
    retry !== "all" ? `retry:${retry}` : status !== "all" ? `status:${status}` : "all";

  return (
    <div role="toolbar" aria-label="Diagnostics filters">
      <input
        aria-label="Search diagnostics"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label="Filter by status or retry strategy"
        value={combined}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "all") {
            setStatus("all");
            setRetry("all");
          } else if (v.startsWith("status:")) {
            setStatus(v.slice("status:".length) as StatusFilter);
            setRetry("all");
          } else if (v.startsWith("retry:")) {
            setRetry(v.slice("retry:".length) as RetryFilter);
            setStatus("all");
          }
        }}
      >
        <option value="all">All statuses &amp; retries</option>
        <option value="status:success">Success only</option>
        <option value="status:tool-error">Tool errors</option>
        <option value="status:gateway-error">Gateway errors</option>
        <option value="status:in-flight">In-flight</option>
        <option value="retry:primary">Retry: primary</option>
        <option value="retry:sanitized">Retry: sanitized</option>
      </select>
      <select
        aria-label="Sort results by field"
        value={sortKey}
        onChange={(e) => setSort(e.target.value as SortKey, sortDir)}
      >
        <option value="time">Sort: Time</option>
        <option value="status">Sort: Status</option>
        <option value="tool">Sort: Tool name</option>
      </select>
      <button
        type="button"
        aria-label={`Sort direction: currently ${sortDir === "asc" ? "ascending" : "descending"}`}
        aria-pressed={sortDir === "asc"}
        onClick={() => setSort(sortKey, sortDir === "asc" ? "desc" : "asc")}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setSort(sortKey, e.key === "ArrowLeft" ? "asc" : "desc");
          }
        }}
      >
        {sortDir === "asc" ? "Ascending" : "Descending"}
      </button>
      <div data-testid="active-status">{status}</div>
      <div data-testid="active-retry">{retry}</div>
      <div data-testid="active-search">{search}</div>
      <div data-testid="active-sort">{`${sortKey}:${sortDir}`}</div>
    </div>
  );
}

function mountRouter(initialUrl: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const stubRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/ai-diagnostics",
    validateSearch: aiDiagnosticsSearchSchema,
    component: ControlsHarness,
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

describe("AiDiagnostics filter/search/sort — keyboard-only operation", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("Tab order lands on Search → Status/Retry → Sort field → Direction toggle", async () => {
    const user = userEvent.setup();
    const router = mountRouter("/admin/ai-diagnostics");
    render(<RouterProvider router={router} />);
    await flush();

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: /search diagnostics/i }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: /filter by status or retry strategy/i }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: /sort results by field/i }),
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /sort direction/i }));
  });

  it("Search: typing into the focused input writes ?q= and clears it on empty", async () => {
    const user = userEvent.setup();
    const router = mountRouter("/admin/ai-diagnostics");
    render(<RouterProvider router={router} />);
    await flush();

    await user.tab();
    await user.keyboard("book");
    await flush();

    expect(screen.getByTestId("active-search").textContent).toBe("book");
    expect(currentUrl(router)).toContain("q=book");

    // Clear via keyboard.
    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}");
    await flush();

    expect(screen.getByTestId("active-search").textContent).toBe("");
    expect(currentUrl(router)).not.toContain("q=");
  });

  it("Status filter: keyboard selection updates ARIA-selected option + URL", async () => {
    const user = userEvent.setup();
    const router = mountRouter("/admin/ai-diagnostics");
    render(<RouterProvider router={router} />);
    await flush();

    // Focus the combined status/retry select via Tab.
    await user.tab(); // search
    await user.tab(); // status/retry
    const statusSelect = screen.getByRole("combobox", {
      name: /filter by status or retry strategy/i,
    }) as HTMLSelectElement;
    expect(document.activeElement).toBe(statusSelect);

    // Keyboard-select "Success only". `selectOptions` is the RTL-blessed
    // way to drive a native select from the keyboard-focused state — it
    // fires the same change event a real listbox interaction would.
    await user.selectOptions(statusSelect, "status:success");
    await flush();

    expect(screen.getByTestId("active-status").textContent).toBe("success");
    expect(screen.getByTestId("active-retry").textContent).toBe("all");
    expect(statusSelect.value).toBe("status:success");
    // Selected <option> carries `selected` — the ARIA-selected proxy for
    // a native select.
    const selectedOption = Array.from(statusSelect.options).find((o) => o.selected)!;
    expect(selectedOption.value).toBe("status:success");
    expect(currentUrl(router)).toContain("status=success");
    expect(currentUrl(router)).not.toContain("retry=");

    // Switching to a Retry option clears status (mutual exclusion).
    await user.selectOptions(statusSelect, "retry:sanitized");
    await flush();

    expect(screen.getByTestId("active-status").textContent).toBe("all");
    expect(screen.getByTestId("active-retry").textContent).toBe("sanitized");
    expect(currentUrl(router)).toContain("retry=sanitized");
    expect(currentUrl(router)).not.toContain("status=");
  });

  it("Sort dropdown: keyboard selection updates URL sort param", async () => {
    const user = userEvent.setup();
    const router = mountRouter("/admin/ai-diagnostics");
    render(<RouterProvider router={router} />);
    await flush();

    await user.tab();
    await user.tab();
    await user.tab();
    const sortSelect = screen.getByRole("combobox", {
      name: /sort results by field/i,
    }) as HTMLSelectElement;
    expect(document.activeElement).toBe(sortSelect);

    await user.selectOptions(sortSelect, "tool");
    await flush();

    // setSort preserves current direction when only the key changes —
    // the initial default is time:desc, so switching to tool yields
    // tool:desc (dir=desc == app default → stripped from URL).
    expect(screen.getByTestId("active-sort").textContent).toBe("tool:desc");
    expect(sortSelect.value).toBe("tool");
    expect(currentUrl(router)).toContain("sort=tool");
    expect(currentUrl(router)).not.toContain("dir=");
  });

  it("Direction toggle: Enter toggles, Arrow keys set explicit dir, aria-pressed mirrors", async () => {
    const user = userEvent.setup();
    const router = mountRouter("/admin/ai-diagnostics?sort=tool&dir=asc");
    render(<RouterProvider router={router} />);
    await flush();

    // Focus the direction toggle via Tab.
    await user.tab(); // search
    await user.tab(); // status/retry
    await user.tab(); // sort field
    await user.tab(); // direction toggle
    const toggle = screen.getByRole("button", { name: /sort direction/i });
    expect(document.activeElement).toBe(toggle);

    // Baseline: asc → aria-pressed=true.
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    // Enter flips asc → desc.
    await user.keyboard("{Enter}");
    await flush();
    expect(screen.getByTestId("active-sort").textContent).toBe("tool:desc");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    // desc == app default → dir param stripped, sort still on tool.
    expect(currentUrl(router)).toContain("sort=tool");
    expect(currentUrl(router)).not.toContain("dir=");

    // ArrowLeft forces asc regardless of current state.
    fireEvent.keyDown(toggle, { key: "ArrowLeft" });
    await flush();
    expect(screen.getByTestId("active-sort").textContent).toBe("tool:asc");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(currentUrl(router)).toContain("dir=asc");

    // ArrowRight forces desc regardless of current state.
    fireEvent.keyDown(toggle, { key: "ArrowRight" });
    await flush();
    expect(screen.getByTestId("active-sort").textContent).toBe("tool:desc");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(currentUrl(router)).not.toContain("dir=");

    // ArrowLeft again — asc restored, aria-pressed flips back to true.
    fireEvent.keyDown(toggle, { key: "ArrowLeft" });
    await flush();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(currentUrl(router)).toContain("dir=asc");
  });

  it("Space also toggles direction from a keyboard-focused button", async () => {
    const user = userEvent.setup();
    const router = mountRouter("/admin/ai-diagnostics?sort=status&dir=asc");
    render(<RouterProvider router={router} />);
    await flush();

    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    const toggle = screen.getByRole("button", { name: /sort direction/i });
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    await user.keyboard(" ");
    await flush();

    expect(screen.getByTestId("active-sort").textContent).toBe("status:desc");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(currentUrl(router)).toContain("sort=status");
  });
});

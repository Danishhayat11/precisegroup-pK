/**
 * Integration test: AI Diagnostics page-size + page-number URL contract.
 *
 * The real page keeps two view knobs in the URL:
 *   • `page` — 1-indexed pagination cursor; default 1 is STRIPPED.
 *   • `size` — rows-per-page; default 25 is STRIPPED.
 *
 * Behaviour under test (mirrors AiDiagnosticsPage exactly):
 *   1. Changing page size ALWAYS resets page to 1 — otherwise a user
 *      on page 5 of 25-per-page would land on page 5 of 100-per-page
 *      and skip most of their data. Reset is expressed as an effect
 *      that fires on any `size` change.
 *   2. Changing PAGE alone preserves the current `size` — pagination
 *      inside a fixed page-size selection must be sticky.
 *   3. URL defaults (page=1, size=25) are stripped so bare links look
 *      clean and equal states share equal URLs.
 *   4. A refresh / share (bare mount at an explicit URL) hydrates
 *      both values from the URL, not from any stored state.
 *   5. Browser back / forward re-derives page + size from each URL
 *      entry — the display never lags behind the address bar.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
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

// ---------------------------------------------------------------------------
// Harness — mirrors AiDiagnosticsPage's page/size URL contract exactly:
//   • defaults: page=1, size=25
//   • strip default values from URL
//   • reset page → 1 on any size change (via effect, like the real page)
// The harness is intentionally minimal so a broken URL contract shows up
// as a test failure, not a UI-only bug.
// ---------------------------------------------------------------------------
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function PageSizeHarness() {
  const sp = useSearch({ strict: false }) as { page?: number; size?: number };
  const navigate = useNavigate();
  const page = sp.page ?? 1;
  const size = sp.size ?? 25;

  const patchSearch = (patch: { page?: number | undefined; size?: number | undefined }) =>
    navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...prev, ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        return next;
      }) as never,
      replace: true,
    });

  const setPage = (n: number) => patchSearch({ page: n <= 1 ? undefined : n });
  const setSize = (n: number) => patchSearch({ size: n === 25 ? undefined : n });

  // Mirrors AiDiagnosticsPage's reset-to-page-1 on size change, guarded
  // against the initial mount so shared URLs (?page=4&size=100) hydrate
  // verbatim instead of being clobbered by the effect firing once with
  // its initial deps.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  return (
    <>
      <div data-testid="active-page">{String(page)}</div>
      <div data-testid="active-size">{String(size)}</div>
      <label>
        Page size
        <select
          aria-label="Rows per page"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => setPage(page + 1)}>
        Next page
      </button>
      <button type="button" onClick={() => setPage(page - 1)}>
        Prev page
      </button>
    </>
  );
}

function mountRouter(entries: string[], initialIndex = entries.length - 1) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const stubRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/ai-diagnostics",
    validateSearch: aiDiagnosticsSearchSchema,
    component: PageSizeHarness,
  });
  const catchAll = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([stubRoute, catchAll]),
    history: createMemoryHistory({ initialEntries: entries, initialIndex }),
  });
}

async function flush() {
  // Two microtask ticks cover a navigate() + subsequent effect (the size
  // effect calls patchSearch which is itself another navigate).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function readPage(): string {
  return screen.getByTestId("active-page").textContent ?? "";
}
function readSize(): string {
  return screen.getByTestId("active-size").textContent ?? "";
}
function currentUrl(router: ReturnType<typeof mountRouter>): string {
  const loc = router.state.location;
  return `${loc.pathname}${loc.searchStr ?? ""}`;
}

// ---------------------------------------------------------------------------

describe("AiDiagnostics page-size / page-number URL contract", () => {
  afterEach(() => cleanup());

  it("changing page size resets page → 1 and drops ?page from the URL", async () => {
    const user = userEvent.setup();
    const router = mountRouter(["/admin/ai-diagnostics?page=5"]);
    render(<RouterProvider router={router} />);
    await flush();

    // Precondition: hydrated from URL.
    expect(readPage()).toBe("5");
    expect(readSize()).toBe("25");

    await user.selectOptions(screen.getByRole("combobox", { name: /rows per page/i }), "50");
    await flush();

    // Page collapses to 1 (default → stripped) and size persists.
    expect(readPage()).toBe("1");
    expect(readSize()).toBe("50");
    expect(currentUrl(router)).not.toContain("page=");
    expect(currentUrl(router)).toContain("size=50");
  });

  it("selecting the default size (25) strips BOTH page and size from the URL", async () => {
    const user = userEvent.setup();
    const router = mountRouter(["/admin/ai-diagnostics?size=100&page=3"]);
    render(<RouterProvider router={router} />);
    await flush();

    expect(readPage()).toBe("3");
    expect(readSize()).toBe("100");

    await user.selectOptions(screen.getByRole("combobox", { name: /rows per page/i }), "25");
    await flush();

    expect(readPage()).toBe("1");
    expect(readSize()).toBe("25");
    // Bare URL — no params at all.
    expect(currentUrl(router)).not.toContain("size=");
    expect(currentUrl(router)).not.toContain("page=");
  });

  it("changing PAGE alone preserves the current size in the URL", async () => {
    const user = userEvent.setup();
    const router = mountRouter(["/admin/ai-diagnostics?size=50"]);
    render(<RouterProvider router={router} />);
    await flush();

    expect(readPage()).toBe("1");
    expect(readSize()).toBe("50");

    await user.click(screen.getByRole("button", { name: /next page/i }));
    await flush();
    await user.click(screen.getByRole("button", { name: /next page/i }));
    await flush();

    // Page advanced to 3, size unchanged.
    expect(readPage()).toBe("3");
    expect(readSize()).toBe("50");
    expect(currentUrl(router)).toContain("size=50");
    expect(currentUrl(router)).toContain("page=3");
  });

  it("SHARE: mounting at ?size=100&page=4 hydrates both values verbatim", async () => {
    const router = mountRouter(["/admin/ai-diagnostics?size=100&page=4"]);
    render(<RouterProvider router={router} />);
    await flush();

    expect(readPage()).toBe("4");
    expect(readSize()).toBe("100");
    // No effect fires because `size` hasn't changed since mount — page
    // MUST NOT be reset when the URL itself opens on page 4.
    expect(currentUrl(router)).toContain("size=100");
    expect(currentUrl(router)).toContain("page=4");
  });

  it("BACK/FORWARD: display re-derives page + size from each history entry", async () => {
    const router = mountRouter(
      [
        "/admin/ai-diagnostics", // 1: bare defaults
        "/admin/ai-diagnostics?size=50", // 2: bigger page size, page 1
        "/admin/ai-diagnostics?size=50&page=3", // 3: page 3 at size 50
      ],
      2,
    );
    render(<RouterProvider router={router} />);
    await flush();

    // Landed on entry #3.
    expect(readPage()).toBe("3");
    expect(readSize()).toBe("50");

    // Back → entry #2 (size=50, no page).
    await act(async () => {
      router.history.back();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(readPage()).toBe("1");
    expect(readSize()).toBe("50");
    expect(currentUrl(router)).toContain("size=50");
    expect(currentUrl(router)).not.toContain("page=");

    // Back → entry #1 (defaults).
    await act(async () => {
      router.history.back();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(readPage()).toBe("1");
    expect(readSize()).toBe("25");
    expect(currentUrl(router)).not.toContain("size=");
    expect(currentUrl(router)).not.toContain("page=");

    // Forward → back to entry #2.
    await act(async () => {
      router.history.forward();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(readPage()).toBe("1");
    expect(readSize()).toBe("50");

    // Forward → entry #3 — page 3 restored from the URL, NOT reset.
    await act(async () => {
      router.history.forward();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(readPage()).toBe("3");
    expect(readSize()).toBe("50");
    expect(currentUrl(router)).toContain("size=50");
    expect(currentUrl(router)).toContain("page=3");
  });
});

/**
 * Integration test: viewer sessions never see PII surfaces and never
 * fire the underlying client PII query.
 *
 * Contract under test (see `src/lib/access.tsx`):
 *   • `RequireWriter` renders the `<AccessDenied />` surface (a11y
 *     `role="status"`, `data-testid="access-denied"`) when the session's
 *     roles do NOT include admin/manager/staff.
 *   • `usePIIGuardedQuery` short-circuits its `queryFn` — the fetcher
 *     must NEVER be invoked for a viewer, so no request ever leaves the
 *     client for RLS to reject. The consumer also observes
 *     `accessDenied: true` and `data: undefined`.
 *   • Both guards read from the same `useAuth()` source, so a single
 *     viewer session flips every PII surface off at once.
 *
 * We stub `@/lib/auth` (the only source `access.tsx` reads) so the test
 * is hermetic — no Supabase, no network, no timers.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock BEFORE importing anything that pulls `useAuth` transitively.
const authState = {
  user: { id: "viewer-1" },
  session: {},
  roles: ["viewer"] as string[],
  loading: false,
  signOut: async () => {},
  isAdmin: false,
  canWrite: false, // ← the flag `useCanReadClientPII` reads
};
vi.mock("@/lib/auth", () => ({
  useAuth: () => authState,
}));

// Import AFTER the mock is registered.
import { RequireWriter, AccessDenied, usePIIGuardedQuery, useCanReadClientPII } from "../access";

function withClient(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  // Reset to viewer between tests (individual tests may mutate).
  authState.roles = ["viewer"];
  authState.canWrite = false;
  authState.loading = false;
});

describe("viewer session — PII lockdown", () => {
  it("useCanReadClientPII reports false for a viewer", () => {
    function Probe() {
      const can = useCanReadClientPII();
      return <span data-testid="probe">{String(can)}</span>;
    }
    render(withClient(<Probe />));
    expect(screen.getByTestId("probe").textContent).toBe("false");
  });

  it("RequireWriter renders <AccessDenied /> and hides the PII child tree", () => {
    render(
      withClient(
        <RequireWriter>
          <div data-testid="pii-child">Client CNIC · 35202-1234567-8</div>
        </RequireWriter>,
      ),
    );
    // Denial surface is present with its documented a11y contract.
    const denied = screen.getByTestId("access-denied");
    expect(denied).toBeTruthy();
    expect(denied.getAttribute("role")).toBe("status");
    expect(denied.getAttribute("aria-live")).toBe("polite");
    // The guarded PII child must NOT be in the DOM.
    expect(screen.queryByTestId("pii-child")).toBeNull();
    // Sanity: raw PII string is not leaked anywhere.
    expect(screen.queryByText(/35202-1234567-8/)).toBeNull();
  });

  it("usePIIGuardedQuery never invokes queryFn for a viewer", async () => {
    const queryFn = vi.fn(async () => {
      throw new Error("queryFn was invoked for a viewer — PII request leaked past the guard");
    });

    function ClientsPanel() {
      const q = usePIIGuardedQuery<{ id: string }[]>({
        queryKey: ["clients", "viewer-test"],
        queryFn,
      });
      return (
        <div>
          <span data-testid="access-denied-flag">{String(q.accessDenied)}</span>
          <span data-testid="fetch-status">{q.fetchStatus}</span>
          <span data-testid="data">{q.data ? "has-data" : "no-data"}</span>
        </div>
      );
    }

    render(withClient(<ClientsPanel />));

    // Flush any pending microtasks — if the query were going to fire,
    // it would have queued by now.
    await waitFor(() => {
      expect(screen.getByTestId("access-denied-flag").textContent).toBe("true");
    });

    // The critical assertion: fetcher was never called.
    expect(queryFn).not.toHaveBeenCalled();
    // TanStack Query reports `idle` when `enabled: false`.
    expect(screen.getByTestId("fetch-status").textContent).toBe("idle");
    expect(screen.getByTestId("data").textContent).toBe("no-data");
  });

  it("promoting the session to a writer role releases the guard", async () => {
    const queryFn = vi.fn(async () => [{ id: "c1" }]);

    // Simulate a session that already has the writer role at mount.
    authState.roles = ["staff"];
    authState.canWrite = true;

    function ClientsPanel() {
      const q = usePIIGuardedQuery<{ id: string }[]>({
        queryKey: ["clients", "writer-test"],
        queryFn,
      });
      return <span data-testid="count">{q.data?.length ?? "pending"}</span>;
    }

    render(withClient(<ClientsPanel />));

    await waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("count").textContent).toBe("1");
    });
  });

  it("AccessDenied renders standalone with the documented a11y shape", () => {
    render(<AccessDenied />);
    const el = screen.getByTestId("access-denied");
    expect(el.getAttribute("role")).toBe("status");
    expect(screen.getByText(/Restricted view/i)).toBeTruthy();
  });
});

/**
 * Unknown-report fallback smoke.
 *
 * Renders `UnknownReportFallback` inside a minimal TanStack memory router
 * (so `<Link to="/reports">` resolves) and confirms:
 *   1. The "Report not found" heading is visible.
 *   2. The offending slug is echoed when provided, and a generic copy is
 *      shown when it's empty.
 *   3. The "Back to reports" link points at `/reports` and renders as an
 *      anchor the user can activate.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { UnknownReportFallback } from "@/components/reports";

function renderWithRouter(node: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{node}</>,
  });
  // Destination the fallback's <Link to="/reports"> resolves against.
  const reportsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports",
    component: () => <div>Reports index</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, reportsRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("UnknownReportFallback — unknown /reports/* URL", () => {
  it("shows the not-found heading and echoes the offending slug", async () => {
    renderWithRouter(<UnknownReportFallback slug="mystery-report" />);

    expect(await screen.findByRole("heading", { name: /report not found/i })).toBeInTheDocument();
    expect(screen.getByText(/\/reports\/mystery-report/)).toBeInTheDocument();
  });

  it("falls back to generic copy when the slug is empty", async () => {
    renderWithRouter(<UnknownReportFallback slug="" />);

    expect(await screen.findByRole("heading", { name: /report not found/i })).toBeInTheDocument();
    expect(screen.getByText(/that report doesn.?t exist/i)).toBeInTheDocument();
    // No slug means no offending-path snippet.
    expect(screen.queryByText(/\/reports\//)).toBeNull();
  });

  it("renders a working link back to /reports", async () => {
    renderWithRouter(<UnknownReportFallback slug="anything" />);

    const link = await screen.findByRole("link", { name: /back to reports/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/reports");
  });
});

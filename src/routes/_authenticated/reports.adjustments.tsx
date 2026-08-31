import { createFileRoute } from "@tanstack/react-router";
import { makeRouteNotFoundComponent } from "@/components/RouteErrorBoundary";
import { makeReportErrorComponent, ReportRoutePending } from "@/components/reports";

export const Route = createFileRoute("/_authenticated/reports/adjustments")({
  errorComponent: makeReportErrorComponent("Adjustment Register Report"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Adjustment Register Report",
    backTo: "/reports",
  }),
  pendingComponent: () => <ReportRoutePending label="Adjustment Register report" />,
  pendingMs: 200,
  pendingMinMs: 300,
});

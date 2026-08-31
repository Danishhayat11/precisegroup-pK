import { createFileRoute } from "@tanstack/react-router";
import { makeRouteNotFoundComponent } from "@/components/RouteErrorBoundary";
import { makeReportErrorComponent, ReportRoutePending } from "@/components/reports";

export const Route = createFileRoute("/_authenticated/reports/cashflow")({
  errorComponent: makeReportErrorComponent("Cash Flow Summary Report"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Cash Flow Summary Report",
    backTo: "/reports",
  }),
  pendingComponent: () => <ReportRoutePending label="Cash Flow Summary report" />,
  pendingMs: 200,
  pendingMinMs: 300,
});

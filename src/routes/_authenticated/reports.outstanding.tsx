import { createFileRoute } from "@tanstack/react-router";
import { makeRouteNotFoundComponent } from "@/components/RouteErrorBoundary";
import { makeReportErrorComponent, ReportRoutePending } from "@/components/reports";

export const Route = createFileRoute("/_authenticated/reports/outstanding")({
  errorComponent: makeReportErrorComponent("Outstanding Balance Report"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Outstanding Balance Report",
    backTo: "/reports",
  }),
  pendingComponent: () => <ReportRoutePending label="Outstanding Balance report" />,
  pendingMs: 200,
  pendingMinMs: 300,
});

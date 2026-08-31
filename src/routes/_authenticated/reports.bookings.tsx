import { createFileRoute } from "@tanstack/react-router";
import { makeRouteNotFoundComponent } from "@/components/RouteErrorBoundary";
import { makeReportErrorComponent, ReportRoutePending } from "@/components/reports";

export const Route = createFileRoute("/_authenticated/reports/bookings")({
  errorComponent: makeReportErrorComponent("Booking Summary Report"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Booking Summary Report",
    backTo: "/reports",
  }),
  pendingComponent: () => <ReportRoutePending label="Booking Summary report" />,
  pendingMs: 200,
  pendingMinMs: 300,
});

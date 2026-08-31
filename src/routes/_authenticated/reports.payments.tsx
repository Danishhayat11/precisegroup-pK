import { createFileRoute } from "@tanstack/react-router";
import { makeRouteNotFoundComponent } from "@/components/RouteErrorBoundary";
import { makeReportErrorComponent, ReportRoutePending } from "@/components/reports";
import { listPaymentCollections, type PaymentRow } from "@/lib/reports.functions";

export const Route = createFileRoute("/_authenticated/reports/payments")({
  loader: async (): Promise<{ rows: PaymentRow[] }> => {
    const rows = await listPaymentCollections();
    return { rows: Array.isArray(rows) ? rows : [] };
  },
  errorComponent: makeReportErrorComponent("Payment Collection Report"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Payment Collection Report",
    backTo: "/reports",
  }),
  pendingComponent: () => <ReportRoutePending label="Payment Collection report" />,

  pendingMs: 200,
  pendingMinMs: 300,
});

import { createFileRoute } from "@tanstack/react-router";
import { makeRouteNotFoundComponent } from "@/components/RouteErrorBoundary";
import { makeReportErrorComponent, ReportRoutePending } from "@/components/reports";
import { listOverdueInstallments, type OverdueRow } from "@/lib/reports.functions";

export const Route = createFileRoute("/_authenticated/reports/overdue")({
  loader: async (): Promise<{ rows: OverdueRow[] }> => {
    const rows = await listOverdueInstallments();
    return { rows: Array.isArray(rows) ? rows : [] };
  },
  errorComponent: makeReportErrorComponent("Overdue Installments Report"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Overdue Installments Report",
    backTo: "/reports",
  }),
  pendingComponent: () => <ReportRoutePending label="Overdue Installments report" />,

  pendingMs: 200,
  pendingMinMs: 300,
});

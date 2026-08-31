import { createLazyFileRoute } from "@tanstack/react-router";
import { OverdueInstallmentsReport, ReportRouteWrapper } from "@/components/reports";

export const Route = createLazyFileRoute("/_authenticated/reports/overdue")({
  component: () => (
    <ReportRouteWrapper label="Overdue Installments report" Component={OverdueInstallmentsReport} />
  ),
});

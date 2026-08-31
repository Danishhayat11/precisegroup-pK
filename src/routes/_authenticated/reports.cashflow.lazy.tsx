import { createLazyFileRoute } from "@tanstack/react-router";
import { CashFlowSummaryReport, ReportRouteWrapper } from "@/components/reports";

export const Route = createLazyFileRoute("/_authenticated/reports/cashflow")({
  component: () => (
    <ReportRouteWrapper label="Cash Flow Summary report" Component={CashFlowSummaryReport} />
  ),
});

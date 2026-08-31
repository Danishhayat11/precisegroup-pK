import { createLazyFileRoute } from "@tanstack/react-router";
import { OutstandingBalanceReport, ReportRouteWrapper } from "@/components/reports";

export const Route = createLazyFileRoute("/_authenticated/reports/outstanding")({
  component: () => (
    <ReportRouteWrapper label="Outstanding Balance report" Component={OutstandingBalanceReport} />
  ),
});

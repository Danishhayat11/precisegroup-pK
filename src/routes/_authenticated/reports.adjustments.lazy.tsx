import { createLazyFileRoute } from "@tanstack/react-router";
import { AdjustmentRegisterReport, ReportRouteWrapper } from "@/components/reports";

export const Route = createLazyFileRoute("/_authenticated/reports/adjustments")({
  component: () => (
    <ReportRouteWrapper label="Adjustment Register report" Component={AdjustmentRegisterReport} />
  ),
});

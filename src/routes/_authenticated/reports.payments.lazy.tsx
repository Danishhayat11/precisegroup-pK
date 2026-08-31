import { createLazyFileRoute } from "@tanstack/react-router";
import { PaymentCollectionReport, ReportRouteWrapper } from "@/components/reports";

export const Route = createLazyFileRoute("/_authenticated/reports/payments")({
  component: () => (
    <ReportRouteWrapper label="Payment Collection report" Component={PaymentCollectionReport} />
  ),
});

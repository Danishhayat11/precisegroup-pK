import { createLazyFileRoute } from "@tanstack/react-router";
import { BookingSummaryReport, ReportRouteWrapper } from "@/components/reports";

export const Route = createLazyFileRoute("/_authenticated/reports/bookings")({
  component: () => (
    <ReportRouteWrapper label="Booking Summary report" Component={BookingSummaryReport} />
  ),
});

import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/InstallmentPlan";
import { makeRouteErrorComponent, RouteNotFound } from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/plans/$bookingId")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Installment plan"),
  notFoundComponent: NotFound,
});

function NotFound() {
  const { bookingId } = Route.useParams();
  return (
    <RouteNotFound
      resourceLabel="Installment plan"
      identifier={bookingId}
      backTo="/bookings"
      backLabel="Back to Bookings"
    />
  );
}

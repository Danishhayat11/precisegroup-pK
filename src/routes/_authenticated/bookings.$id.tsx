import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/BookingDetail";
import { makeRouteErrorComponent, RouteNotFound } from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/bookings/$id")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Booking detail"),
  notFoundComponent: NotFound,
});

function NotFound() {
  const { id } = Route.useParams();
  return (
    <RouteNotFound
      resourceLabel="Booking"
      identifier={id}
      backTo="/bookings"
      backLabel="Back to Bookings"
    />
  );
}

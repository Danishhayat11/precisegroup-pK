import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Bookings";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/bookings/")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Bookings"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Bookings",
    backTo: "/",
  }),
});

import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Payments";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/payments")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Payments"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Payments",
    backTo: "/",
  }),
});

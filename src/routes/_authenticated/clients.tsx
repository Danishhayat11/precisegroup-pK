import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Clients";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/clients")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Clients"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Clients",
    backTo: "/",
  }),
});

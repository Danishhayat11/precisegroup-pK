import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Maintenance";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/maintenance")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Maintenance"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Maintenance",
    backTo: "/",
  }),
});

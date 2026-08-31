import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Units";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/units")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Units"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Units",
    backTo: "/",
  }),
});

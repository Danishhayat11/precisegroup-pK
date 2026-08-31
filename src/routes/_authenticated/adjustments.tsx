import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Adjustments";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/adjustments")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Adjustments"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Adjustments",
    backTo: "/",
  }),
});

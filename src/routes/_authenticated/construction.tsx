import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Construction";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/construction")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Construction"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Construction",
    backTo: "/",
  }),
});

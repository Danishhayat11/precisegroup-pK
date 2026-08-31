import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Reports";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/reports/")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Reports"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Reports",
    backTo: "/",
  }),
});

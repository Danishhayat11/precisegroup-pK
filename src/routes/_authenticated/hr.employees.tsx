import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/hr/Employees";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/hr/employees")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Employees"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Employees",
    backTo: "/",
  }),
});

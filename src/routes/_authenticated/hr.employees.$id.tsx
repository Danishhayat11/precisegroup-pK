import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/hr/EmployeeDetail";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/hr/employees/$id")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Employee"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Employee",
    backTo: "/hr/employees",
  }),
});

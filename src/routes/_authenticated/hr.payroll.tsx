import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/hr/Payroll";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/hr/payroll")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Payroll"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Payroll",
    backTo: "/",
  }),
});

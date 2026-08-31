import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/OfficeExpenses";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/office-expenses")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Office Expenses"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Office Expenses",
    backTo: "/",
  }),
});

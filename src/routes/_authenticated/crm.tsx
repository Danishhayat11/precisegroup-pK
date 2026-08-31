import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/LeadsCRM";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/crm")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Leads & CRM"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Leads & CRM",
    backTo: "/",
  }),
});

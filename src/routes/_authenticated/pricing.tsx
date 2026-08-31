import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Pricing";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Precise ERP" },
      {
        name: "description",
        content:
          "Simple, transparent pricing for the Precise real-estate ERP — Starter, Pro and Enterprise plans with monthly or yearly billing.",
      },
    ],
  }),
  component: Page,
  errorComponent: makeRouteErrorComponent("Pricing"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Pricing",
    backTo: "/dashboard",
  }),
});

import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Ledger";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/ledger")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Installment Ledger"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Installment Ledger",
    backTo: "/",
  }),
});

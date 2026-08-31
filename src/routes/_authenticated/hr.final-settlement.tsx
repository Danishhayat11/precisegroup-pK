import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/hr/FinalSettlement";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/hr/final-settlement")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Final Settlement"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Final Settlement",
    backTo: "/",
  }),
});

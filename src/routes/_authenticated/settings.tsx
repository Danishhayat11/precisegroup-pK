import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Settings";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Settings"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Settings",
    backTo: "/",
  }),
});

import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Documents";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/documents/")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Documents"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Documents",
    backTo: "/",
  }),
});

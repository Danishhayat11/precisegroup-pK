import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/MyRequests";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/my-requests")({
  component: Page,
  errorComponent: makeRouteErrorComponent("My Requests"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "My Requests",
    backTo: "/",
  }),
});

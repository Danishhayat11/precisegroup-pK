import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Users";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/users")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Users"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Users",
    backTo: "/",
  }),
});

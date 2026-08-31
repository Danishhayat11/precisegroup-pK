import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/reports")({
  component: () => <Outlet />,
  errorComponent: makeRouteErrorComponent("Reports"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Reports",
    backTo: "/",
  }),
});

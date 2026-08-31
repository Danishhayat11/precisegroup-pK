import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/Projects";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/projects")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Projects"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Projects",
    backTo: "/",
  }),
});

import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/hr/Attendance";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/hr/attendance")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Attendance"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Attendance",
    backTo: "/",
  }),
});

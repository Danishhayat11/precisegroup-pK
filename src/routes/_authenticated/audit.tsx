import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/AuditLog";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/audit")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Audit Log"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Audit Log",
    backTo: "/",
  }),
});

import { createFileRoute } from "@tanstack/react-router";
import AcceptInvite from "@/pages/AcceptInvite";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/accept-invite/$token")({
  component: AcceptInvite,
  head: () => ({
    meta: [
      { title: "Accept your invitation — Precise ERP" },
      { name: "description", content: "Join your team's Precise ERP workspace." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  errorComponent: makeRouteErrorComponent("Accept invite"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Invitation",
    backTo: "/login",
  }),
});

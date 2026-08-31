import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/PlanRestructureHistoryPage";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

function Guarded() {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin)
    return (
      <div>
        <PageHeader title="Plan Restructure History" description="Restricted area" />
        <AdminRequiredMessage action="Viewing global plan restructure history" />
      </div>
    );
  return <Page />;
}
export const Route = createFileRoute("/_authenticated/admin/plan-restructure-history")({
  component: Guarded,
  errorComponent: makeRouteErrorComponent("Plan Restructure History"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Plan Restructure History",
    backTo: "/admin",
    backLabel: "Back to Admin",
  }),
});

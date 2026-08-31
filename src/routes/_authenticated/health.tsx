import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/DataHealth";
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
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Data Health" description="Continuous accounting audits" />
        <AdminRequiredMessage action="Viewing the Data Health dashboard" />
      </div>
    );
  }
  return <Page />;
}

export const Route = createFileRoute("/_authenticated/health")({
  component: Guarded,
  errorComponent: makeRouteErrorComponent("Data Health"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Data Health",
    backTo: "/",
  }),
});

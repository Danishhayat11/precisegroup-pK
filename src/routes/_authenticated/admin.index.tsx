import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/AdminHub";
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
        <PageHeader title="Admin Controls" description="Restricted area" />
        <AdminRequiredMessage action="Viewing the Admin Controls hub" />
      </div>
    );
  return <Page />;
}
export const Route = createFileRoute("/_authenticated/admin/")({
  component: Guarded,
  errorComponent: makeRouteErrorComponent("Admin Controls"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Admin Controls",
    backTo: "/",
  }),
});

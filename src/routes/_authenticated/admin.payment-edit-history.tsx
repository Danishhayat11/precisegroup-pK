import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/PaymentEditHistoryPage";
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
        <PageHeader title="Payment Edit History" description="Restricted area" />
        <AdminRequiredMessage action="Viewing global payment edit history" />
      </div>
    );
  return <Page />;
}
export const Route = createFileRoute("/_authenticated/admin/payment-edit-history")({
  component: Guarded,
  errorComponent: makeRouteErrorComponent("Payment Edit History"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Payment Edit History",
    backTo: "/admin",
    backLabel: "Back to Admin",
  }),
});

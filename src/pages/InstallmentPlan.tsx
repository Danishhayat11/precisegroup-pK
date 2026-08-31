import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Printer } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";
import { projectPlan } from "@/lib/planProjection";
import InstallmentPlanDoc from "@/components/documents/InstallmentPlanDoc";
import { useProjectBranding } from "@/lib/hooks/useProjectBranding";

export default function InstallmentPlanPage() {
  const { bookingId = "" } = useParams();

  const { data, isLoading, accessDenied } = usePIIGuardedQuery<{
    booking: any;
    ledger: any[];
  }>({
    queryKey: ["plan-doc", bookingId],
    queryFn: async () => {
      const [b, ledger] = await Promise.all([
        supabase.from("bookings").select("*").eq("booking_id", bookingId).maybeSingle(),
        supabase
          .from("installment_ledger")
          .select("*")
          .eq("booking_id", bookingId)
          .order("term_no"),
      ]);
      return { booking: b.data, ledger: ledger.data ?? [] };
    },
  });

  const projection = useMemo(
    () => projectPlan(data?.booking, data?.ledger ?? []),
    [data?.booking, data?.ledger],
  );

  const brandingQ = useProjectBranding(data?.booking?.project_code, data?.booking?.project_name);

  if (accessDenied)
    return (
      <AccessDenied
        title="Installment plan restricted"
        description="Client PII and ledger data are only visible to admin, manager, and staff roles."
      />
    );

  if (isLoading || !data)
    return <div className="text-muted-foreground">Loading installment plan…</div>;

  if (!data.booking)
    return (
      <div className="card-elevated p-10 text-center">
        <div className="text-lg font-semibold">Booking not found</div>
        <Link to="/bookings" className="text-primary text-sm hover:underline mt-2 inline-block">
          ← Back to bookings
        </Link>
      </div>
    );

  const branding = brandingQ.data ?? {
    projectDisplayName: data.booking.project_name ?? "PROJECT",
    tagline: "Crafting Landmarks  |  Creating Trust",
    accentToken: "primary",
  };

  return (
    <div>
      <Link
        to={`/bookings/${data.booking.booking_id}`}
        className="plan-hide-print text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3"
      >
        <ChevronLeft className="h-3 w-3" /> Back to booking
      </Link>

      <div className="plan-hide-print">
        <PageHeader
          title="Installment Payment Plan"
          description={`${data.booking.booking_id} · ${data.booking.unit_id} · ${data.booking.project_name}`}
          actions={
            <Button size="sm" onClick={() => window.print()} className="min-h-11">
              <Printer className="h-4 w-4 mr-2" /> Print / Save PDF
            </Button>
          }
        />
      </div>

      <div className="mt-4">
        <InstallmentPlanDoc
          booking={data.booking}
          projection={projection}
          branding={branding as any}
        />
      </div>
    </div>
  );
}

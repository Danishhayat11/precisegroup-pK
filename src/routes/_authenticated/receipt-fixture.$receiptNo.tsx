import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PaymentReceipt } from "@/components/PaymentReceipt";

/**
 * Test fixture route — opens {@link PaymentReceipt} for a fixed receipt_no
 * so Playwright snapshots can lock the print layout (A4 sizing,
 * signature/balance/footer rhythm) without driving the Payments-page UI.
 *
 * Renders the receipt modal open on mount. The visible print-preview
 * pane inside the modal shows exactly what Chrome will rasterise on
 * "Save as PDF", so screenshotting it gives us a print-media proxy
 * without switching Playwright's emulated media (which would collapse
 * the surrounding Dialog under the app's global print rules).
 *
 * Not linked from anywhere in the app; reachable only by direct URL:
 *   /receipt-fixture/PAY-00001
 */
export const Route = createFileRoute("/_authenticated/receipt-fixture/$receiptNo")({
  component: ReceiptFixture,
});

function ReceiptFixture() {
  const { receiptNo } = useParams({ from: "/_authenticated/receipt-fixture/$receiptNo" });

  // Warm a separate cache entry so we don't collide with the
  // ["receipt", receiptNo] query owned by <PaymentReceipt/> (whose
  // queryFn returns { pay, booking, prevReceived }, not a bare payment).
  useQuery({
    queryKey: ["receipt-fixture-warm", receiptNo],
    enabled: !!receiptNo,
    queryFn: async () => {
      const { data: pay } = await supabase
        .from("payments")
        .select("*")
        .eq("receipt_no", receiptNo)
        .maybeSingle();
      return pay;
    },
  });

  return (
    <PaymentReceipt
      open
      onOpenChange={() => {
        /* stay open — this is a test fixture */
      }}
      receiptNo={receiptNo}
    />
  );
}

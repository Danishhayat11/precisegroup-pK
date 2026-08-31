import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OverdueRow = {
  ledger_id: string;
  booking_id: string | null;
  client_name: string | null;
  project: string | null;
  unit_no: string | null;
  term_no: number | null;
  due_date: string | null;
  due_amount: number | null;
  paid_amount: number | null;
  days_overdue: number | null;
  status: string | null;
};

export const listOverdueInstallments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OverdueRow[]> => {
    const { data, error } = await context.supabase
      .from("installment_ledger")
      .select(
        "ledger_id, booking_id, client_name, project, unit_no, term_no, due_date, due_amount, paid_amount, days_overdue, status",
      )
      .gt("days_overdue", 0)
      .order("days_overdue", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as OverdueRow[];
  });

export type PaymentRow = {
  receipt_no: string;
  payment_date: string | null;
  client_name: string | null;
  project: string | null;
  unit_no: string | null;
  payment_head: string | null;
  payment_mode: string | null;
  amount: number | null;
  status: string | null;
};

export const listPaymentCollections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentRow[]> => {
    const { data, error } = await context.supabase
      .from("payments")
      .select(
        "receipt_no, payment_date, client_name, project, unit_no, payment_head, payment_mode, amount, status",
      )
      .order("payment_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as PaymentRow[];
  });

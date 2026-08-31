import { supabase } from "@/integrations/supabase/client";
import { fetchAll, fetchAllRows } from "@/lib/fetchAll";
import { fmtPKR } from "@/lib/format";

/**
 * Live ERP snapshot pushed to the Precise Assistant on every chat turn.
 * Keep it lean — the /api/ai gateway caps payloads at 64KB.
 */
export type ERPSnapshot = {
  asOf: string;
  portfolio: {
    activeBookings: number;
    totalContractValue: number;
    totalCashReceived: number;
    totalAdjustmentAllowed: number;
    totalReceived: number;
    totalPending: number;
    totalOverdue: number;
    overdueClientCount: number;
  };
  bookings: Array<{
    id: string;
    clientName: string;
    cnic: string | null;
    phone: string | null;
    project: string | null;
    unitNo: string | null;
    floor: string | null;
    contractValue: number;
    cashReceived: number;
    adjustmentAllowed: number;
    totalReceived: number;
    balance: number;
    overdueCount: number;
    overdueAmount: number;
    riskLevel: string | null;
    status: string | null;
    address?: string | null;
  }>;
  recentPayments: Array<{
    date: string | null;
    clientName: string | null;
    amount: number;
    mode: string | null;
    head: string | null;
    type: "cash" | "adjustment";
  }>;
  current?: ERPSnapshot["bookings"][number];
};

const PKR = (n: number) => `PKR ${fmtPKR(n ?? 0)}`;
export { PKR };

export async function buildSnapshot(currentBookingId?: string | null): Promise<ERPSnapshot> {
  const [bookings, payments, adj] = await Promise.all([
    // Full table — portfolio totals must include every booking, not just the
    // first 1000. We trim to the most-relevant 60 before sending to the LLM.
    fetchAllRows<any>(
      "bookings",
      "booking_id,client_name,cnic,mobile,project_name,unit_id,floor,total_contract_value,cash_received,adjustment_credit,remaining_balance,current_overdue_count,total_overdue_amount,risk_level,booking_status,address",
      "booking_id",
    ),
    // Recent payments only — explicit cap, no fetchAll.
    supabase
      .from("payments")
      .select("payment_date,client_name,amount,payment_mode,payment_head,non_cash_adjustment")
      .order("payment_date", { ascending: false })
      .limit(15)
      .then((r) => r.data ?? []),
    fetchAll<any>(
      (q) =>
        q
          .select("booking_id,approved_value,adjustment_id")
          .order("adjustment_id", { ascending: true }),
      {
        table: "adjustments",
      },
    ),
  ]);

  const adjByBooking = new Map<string, number>();
  for (const a of adj ?? []) {
    if (!a.booking_id) continue;
    adjByBooking.set(
      a.booking_id,
      (adjByBooking.get(a.booking_id) ?? 0) + Number(a.approved_value ?? 0),
    );
  }

  const rows = (bookings ?? []).map((b) => {
    const cash = Number(b.cash_received ?? 0);
    const adjAllowed = adjByBooking.get(b.booking_id) ?? Number(b.adjustment_credit ?? 0);
    return {
      id: b.booking_id as string,
      clientName: b.client_name as string,
      cnic: b.cnic as string | null,
      phone: b.mobile as string | null,
      project: b.project_name as string | null,
      unitNo: b.unit_id as string | null,
      floor: b.floor as string | null,
      contractValue: Number(b.total_contract_value ?? 0),
      cashReceived: cash,
      adjustmentAllowed: adjAllowed,
      totalReceived: cash + adjAllowed,
      balance: Number(b.remaining_balance ?? 0),
      overdueCount: Number(b.current_overdue_count ?? 0),
      overdueAmount: Number(b.total_overdue_amount ?? 0),
      riskLevel: (b.risk_level as string | null) ?? null,
      status: (b.booking_status as string | null) ?? null,
      address: (b.address as string | null) ?? null,
    };
  });

  const portfolio = {
    activeBookings: rows.filter((r) => (r.status ?? "").toLowerCase() !== "cancelled").length,
    totalContractValue: rows.reduce((s, r) => s + r.contractValue, 0),
    totalCashReceived: rows.reduce((s, r) => s + r.cashReceived, 0),
    totalAdjustmentAllowed: rows.reduce((s, r) => s + r.adjustmentAllowed, 0),
    totalReceived: rows.reduce((s, r) => s + r.totalReceived, 0),
    totalPending: rows.reduce((s, r) => s + r.balance, 0),
    totalOverdue: rows.reduce((s, r) => s + r.overdueAmount, 0),
    overdueClientCount: rows.filter((r) => r.overdueAmount > 0).length,
  };

  // Cap bookings sent to 60 most-relevant (highest overdue, then balance) to keep payload small.
  const topBookings = [...rows]
    .sort((a, b) => b.overdueAmount - a.overdueAmount || b.balance - a.balance)
    .slice(0, 60);

  const recentPayments = (payments ?? []).map((p) => ({
    date: p.payment_date as string | null,
    clientName: p.client_name as string | null,
    amount: Number(p.amount ?? 0),
    mode: p.payment_mode as string | null,
    head: p.payment_head as string | null,
    type: (p.non_cash_adjustment ? "adjustment" : "cash") as "cash" | "adjustment",
  }));

  const current = currentBookingId
    ? (rows.find((r) => r.id === currentBookingId) ?? undefined)
    : undefined;

  return {
    asOf: new Date().toISOString(),
    portfolio,
    bookings: topBookings,
    recentPayments,
    current,
  };
}

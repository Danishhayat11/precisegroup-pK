// Centralized auto-fill token resolver for all generated documents.
// Produces a map of [TOKEN] -> string values from booking + payments +
// ledger + adjustments. Pakistani (Lac/Crore) number formatting throughout.

import { amountInWordsPK } from "./amountInWords";
import { fmtPKR } from "./format";

type AnyRec = Record<string, any>;

const fmtDDMMYYYY = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
};

const num = (v: any) => Number(v || 0);
const withCommas = (n: number) => fmtPKR(Math.round(n));

const clientTitleFor = (b: AnyRec) => {
  const g = String(b?.gender ?? b?.title ?? "").toLowerCase();
  if (g.startsWith("f") || g.includes("mrs")) return "Mrs.";
  if (g.includes("ms")) return "Ms.";
  return "Mr.";
};

const fatherLine = (b: AnyRec) => {
  const so = b?.so_wo ?? b?.father_husband_name ?? "";
  if (!so) return "";
  const isFemale = String(b?.gender ?? "")
    .toLowerCase()
    .startsWith("f");
  return `${isFemale ? "W/O" : "S/O"} ${so}`;
};

// Stable 3-digit sequence derived from booking_id so the same booking
// keeps the same reference number across reprints.
const seq3 = (bookingId: string) => {
  let h = 0;
  for (const ch of bookingId || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String((h % 999) + 1).padStart(3, "0");
};
const seq5 = (s: string) => {
  let h = 0;
  for (const ch of s || "") h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return String((h % 99999) + 1).padStart(5, "0");
};

const cashFromPayments = (payments: AnyRec[]) =>
  payments
    .filter((p) => !p.non_cash_adjustment)
    .filter((p) => /cash|bank|transfer/i.test(String(p.payment_mode || "")))
    .reduce((s, p) => s + num(p.safe_cash_amount ?? p.amount), 0);

const sumByHead = (payments: AnyRec[], re: RegExp) =>
  payments
    .filter((p) => !p.non_cash_adjustment && re.test(String(p.payment_head || "")))
    .reduce((s, p) => s + num(p.amount), 0);

const adjAllowedTotal = (adjustments: AnyRec[], booking: AnyRec) =>
  adjustments.length
    ? adjustments.reduce((s, a) => s + num(a.approved_value), 0)
    : num(booking?.adjustment_credit);

const adjRealizedTotal = (adjustments: AnyRec[]) =>
  adjustments.reduce((s, a) => s + num(a.realized_value), 0);

const overdueRows = (ledger: AnyRec[]) =>
  ledger.filter(
    (l) => String(l.status || "").toLowerCase() === "overdue" || num(l.days_overdue) > 0,
  );

export type PlaceholderOpts = {
  /** Days added to today for [DEADLINE_DATE]. Defaults to 15. */
  deadlineDays?: number;
  /** Optional payment row to populate receipt-specific tokens. */
  payment?: AnyRec | null;
};

export function buildPlaceholders(
  booking: AnyRec,
  payments: AnyRec[] = [],
  ledger: AnyRec[] = [],
  adjustments: AnyRec[] = [],
  opts: PlaceholderOpts = {},
): Record<string, string> {
  const contract = num(booking.total_contract_value ?? booking.sold_unit_value);
  const cash = cashFromPayments(payments);
  const adjAllowed = adjAllowedTotal(adjustments, booking);
  const adjRealized = adjRealizedTotal(adjustments);
  const totalReceived = cash + adjAllowed;
  const remaining = Math.max(contract - totalReceived, 0);

  const od = overdueRows(ledger);
  const overdueAmt = od.reduce(
    (s, l) => s + Math.max(num(l.due_amount) - num(l.paid_amount), 0),
    0,
  );

  const overdueTable = od.length
    ? [
        "Sr. | Description           | Due Date    | Amount (PKR)",
        "----+-----------------------+-------------+-------------",
        ...od.map((l, i) => {
          const sr = String(i + 1).padStart(2, " ");
          const desc = String(l.particulars ?? `Installment ${l.term_no ?? i + 1}`)
            .slice(0, 21)
            .padEnd(21);
          const dt = fmtDDMMYYYY(l.due_date).padEnd(11);
          const amt = withCommas(Math.max(num(l.due_amount) - num(l.paid_amount), 0)).padStart(13);
          return ` ${sr} | ${desc} | ${dt} | ${amt}`;
        }),
      ].join("\n")
    : "(No overdue installments)";

  const today = new Date();
  const deadline = new Date(today);
  deadline.setDate(today.getDate() + (opts.deadlineDays ?? 15));

  const unitKey = String(booking.unit_id ?? "MA").replace(/[^A-Z0-9-]/gi, "");
  const yr = today.getFullYear();

  const pay = opts.payment ?? null;

  return {
    // Client
    CLIENT_TITLE: clientTitleFor(booking),
    CLIENT_NAME: String(booking.client_name ?? "").toUpperCase(),
    FATHER_NAME: fatherLine(booking),
    CNIC: String(booking.cnic ?? ""),
    PHONE: String(booking.mobile ?? ""),
    ADDRESS: String(booking.address ?? ""),

    // Booking
    BOOKING_ID: String(booking.booking_id ?? ""),
    BOOKING_DATE: fmtDDMMYYYY(booking.booking_date),
    UNIT_NO: String(booking.unit_id ?? ""),
    UNIT_TYPE: String(booking.unit_type ?? ""),
    FLOOR: String(booking.floor ?? ""),
    UNIT_SIZE: String(booking.size_sqft ?? ""),
    CONTRACT_VALUE: withCommas(contract),
    CONTRACT_VALUE_WORDS: amountInWordsPK(contract),
    SOLD_RATE: withCommas(num(booking.sold_rate)),
    DOWN_PAYMENT_CASH: withCommas(num(booking.down_payment)),
    ADJUSTMENT_ALLOWED: withCommas(adjAllowed),
    // Internal-only — never expose on outward-facing client docs:
    ADJUSTMENT_REALIZED: withCommas(adjRealized),
    POSSESSION_AMOUNT: withCommas(num(booking.possession_amount)),
    INSTALLMENT_AMOUNT: withCommas(num(booking.installment_amount)),
    NO_OF_INSTALLMENTS: String(booking.no_of_installments ?? ""),
    FREQUENCY: String(booking.installment_frequency ?? ""),
    FIRST_INSTALLMENT_DATE: fmtDDMMYYYY(booking.first_installment_due),
    POSSESSION_DUE_DATE: fmtDDMMYYYY(booking.possession_due_date),
    DOWN_PAYMENT_TOTAL: withCommas(num(booking.down_payment) + adjAllowed),

    // Aggregates from payments
    TOTAL_CASH_RECEIVED: withCommas(cash),
    TOTAL_RECEIVED: withCommas(totalReceived),
    REMAINING_BALANCE: withCommas(remaining),
    REMAINING_BALANCE_WORDS: amountInWordsPK(remaining),
    INSTALLMENTS_RECEIVED: withCommas(sumByHead(payments, /install/i)),
    OTHER_RECEIVED: withCommas(sumByHead(payments, /^(?!.*(install|down|possession)).+$/i)),

    // Ledger
    OVERDUE_COUNT: String(od.length),
    OVERDUE_AMOUNT: withCommas(overdueAmt),
    OVERDUE_AMOUNT_WORDS: amountInWordsPK(overdueAmt),
    OVERDUE_TABLE: overdueTable,

    // Payment-receipt specific
    INSTALLMENT_NO: String(pay?.installment_no ?? pay?.term_no ?? ""),
    RECEIPT_NO: String(pay?.receipt_no ?? `REC-${yr}-${seq5(booking.booking_id ?? "")}`),

    // Calculated
    TODAY_DATE: fmtDDMMYYYY(today.toISOString()),
    DEADLINE_DATE: fmtDDMMYYYY(deadline.toISOString()),
    NOTICE_REF: `PRB/MA/${unitKey}/${yr}-${seq3(booking.booking_id ?? "")}`,
    CANCELLATION_REF: `PRB/MA/${unitKey}/CAN/${seq3(booking.booking_id ?? "")}`,
  };
}

/** Replace every [TOKEN] in `text` with the resolved value (empty if unknown). */
export function fillPlaceholders(text: string, tokens: Record<string, string>): string {
  return text.replace(/\[([A-Z0-9_]+)\]/g, (_m, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : `[${key}]`,
  );
}

export const PLACEHOLDER_KEYS = [
  "CLIENT_TITLE",
  "CLIENT_NAME",
  "FATHER_NAME",
  "CNIC",
  "PHONE",
  "ADDRESS",
  "BOOKING_ID",
  "BOOKING_DATE",
  "UNIT_NO",
  "UNIT_TYPE",
  "FLOOR",
  "UNIT_SIZE",
  "CONTRACT_VALUE",
  "CONTRACT_VALUE_WORDS",
  "SOLD_RATE",
  "DOWN_PAYMENT_CASH",
  "ADJUSTMENT_ALLOWED",
  "POSSESSION_AMOUNT",
  "INSTALLMENT_AMOUNT",
  "NO_OF_INSTALLMENTS",
  "FREQUENCY",
  "FIRST_INSTALLMENT_DATE",
  "POSSESSION_DUE_DATE",
  "DOWN_PAYMENT_TOTAL",
  "TOTAL_CASH_RECEIVED",
  "TOTAL_RECEIVED",
  "REMAINING_BALANCE",
  "REMAINING_BALANCE_WORDS",
  "INSTALLMENTS_RECEIVED",
  "OTHER_RECEIVED",
  "OVERDUE_COUNT",
  "OVERDUE_AMOUNT",
  "OVERDUE_AMOUNT_WORDS",
  "OVERDUE_TABLE",
  "INSTALLMENT_NO",
  "RECEIPT_NO",
  "TODAY_DATE",
  "DEADLINE_DATE",
  "NOTICE_REF",
  "CANCELLATION_REF",
] as const;

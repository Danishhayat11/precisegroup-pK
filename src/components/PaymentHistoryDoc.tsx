/**
 * PaymentHistoryDoc — CLIENT PAYMENT LEDGER (redesigned).
 *
 * World-class real-estate financial statement matching the DHA / Emaar /
 * CBRE aesthetic the brief calls for:
 *   • Calibri throughout (Arial fallback), Courier New for numbers.
 *   • Flat navy section bars, no rounded corners, no badges, no icons.
 *   • Text-only status column (✓ Paid / ● Overdue / Upcoming / ◑ Partial).
 *   • Bordered 2-column client info grid (uppercase labels, bold values).
 *   • Zebra-striped Payment Schedule + Payments Received registers with
 *     navy totals row in gold.
 *   • 3-column Account Summary bracketed by navy rules.
 *   • Overdue surfaced as a single red-underlined line — no full-width
 *     alert box.
 *   • Multi-booking support: when `bookings` is supplied with 2+ entries
 *     a consolidated summary bar appears and the Payments Received table
 *     gains a "Unit" column.
 *   • Density auto-tier: 8.5pt / 6.5mm rows compact down to 8pt / 6mm for
 *     ledgers with > 14 schedule rows or > 18 payment rows.
 */
import { fmtPKR } from "@/lib/format";
import { format, parseISO } from "date-fns";

const FMT = (d?: string | Date | null) =>
  d ? format(typeof d === "string" ? parseISO(d) : d, "dd-MMM-yyyy") : "—";

const MONO = '"Courier New", Courier, monospace';
const SANS = '"Calibri", Arial, sans-serif';

/* Brand tokens */
const NAVY = "#1B2B4B";
const NAVY_HEAD = "#2d3f5e"; // header row, slightly lighter than section bar
const GOLD = "#C9A84C";
const GOLD_TEXT = "#E8D5A3";
const INK = "#000000";
const SUB = "#555555";
const LABEL = "#888888";
const RULE = "#cccccc";
const ROW_RULE = "#e8e8e8";
const ZEBRA = "#fafafa";
const OVERDUE_BG = "#fff8f8";
const OVERDUE_BORDER = "#dc2626";
const PAID_BG = "#f8fff8";
const PAID_FG = "#059669";
const PARTIAL_FG = "#d97706";
const UPCOMING_FG = "#6b7280";
const ADJ_BG = "#faf5ff";
const ADJ_FG = "#6b21a8";
const BLUE_FG = "#1a56db";

type Payment = {
  payment_date?: string;
  receipt_no?: string;
  payment_mode?: string;
  payment_head?: string;
  amount?: number;
  safe_cash_amount?: number;
  non_cash_adjustment?: boolean;
  account?: string;
  cheque_txn_no?: string;
  memo?: string;
  remarks?: string;
  unit_no?: string;
};

type Adjustment = {
  approved_value?: number;
  asset_description?: string;
  receipt_no?: string;
};

type LedgerRow = {
  due_date?: string;
  particulars?: string;
  due_amount?: number;
  paid_amount?: number;
};

export type PaymentHistoryFilters = {
  dateFrom?: string;
  dateTo?: string;
  showAdjustments: boolean;
  showRemarks: boolean;
};

function classifyMode(p: Payment): "Cash" | "Online" | "Bank" | "Adjustment" | "Rent" {
  if (p.non_cash_adjustment) {
    const m = (p.payment_mode || "").toLowerCase();
    if (m.includes("rent")) return "Rent";
    return "Adjustment";
  }
  const m = (p.payment_mode || "").toLowerCase();
  if (m.includes("rent")) return "Rent";
  if (m.includes("adjust")) return "Adjustment";
  if (m.includes("cash")) return "Cash";
  if (m.includes("bank")) return "Bank";
  return "Online";
}

function modeLabel(k: ReturnType<typeof classifyMode>) {
  return k === "Rent" ? "Rent Adj." : k;
}

function modeColor(k: ReturnType<typeof classifyMode>) {
  if (k === "Rent" || k === "Adjustment") return ADJ_FG;
  if (k === "Online" || k === "Bank") return BLUE_FG;
  return INK;
}

function deriveLedgerNo(booking: any): string {
  if (booking?.ledger_no) return booking.ledger_no;
  const id = String(booking?.booking_id || "LDG")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
  const yr = new Date().getFullYear();
  return `MA/LDG/${yr}/${id.slice(-4) || "0001"}`;
}

export default function PaymentHistoryDoc({
  booking,
  bookings,
  payments,
  adjustments,
  filters,
  ledger,
  todayDate = new Date(),
}: {
  booking: any;
  bookings?: any[]; // optional — consolidated multi-unit statement
  payments: Payment[];
  adjustments: Adjustment[];
  filters: PaymentHistoryFilters;
  ledger?: LedgerRow[]; // optional payment schedule
  todayDate?: Date;
}) {
  const allBookings = bookings && bookings.length > 0 ? bookings : booking ? [booking] : [];
  const primary = booking || allBookings[0] || {};
  const consolidated = allBookings.length >= 2;

  /* ---------- filter & sort payments ---------- */
  const from = filters.dateFrom ? new Date(filters.dateFrom).getTime() : null;
  const to = filters.dateTo ? new Date(filters.dateTo).getTime() + 86_399_999 : null;
  const rows: Payment[] = [...(payments || [])]
    .filter((p) => {
      if (!filters.showAdjustments) {
        const k = classifyMode(p);
        if (k === "Adjustment" || k === "Rent") return false;
      }
      if (!p.payment_date) return true;
      const t = new Date(p.payment_date).getTime();
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    })
    .sort((a, b) => (a.payment_date || "").localeCompare(b.payment_date || ""));

  /* ---------- totals across all bookings ---------- */
  const contract = allBookings.reduce(
    (s, b) => s + Number(b?.total_contract_value ?? b?.sold_unit_value ?? 0),
    0,
  );
  const totalReceived = rows.reduce((s, p) => s + Number(p.amount || 0), 0);
  const outstanding = Math.max(contract - totalReceived, 0);
  const overdueAmt = allBookings.reduce((s, b) => s + Number(b?.total_overdue_amount || 0), 0);

  /* ---------- density tier ---------- */
  const schedRows = (ledger || []).length;
  const payRows = rows.length;
  const tight = schedRows > 14 || payRows > 18;
  const bodyFs = tight ? "8pt" : "8.5pt";
  const rowH = tight ? "6mm" : "6.5mm";
  const cellPad = tight ? "0 2mm" : "0 2mm";

  const ledgerNo = deriveLedgerNo(primary);
  const today = FMT(todayDate);

  /* ---------- payment schedule with running balance ---------- */
  const schedule = (ledger || []).map((l) => {
    const due = Number(l.due_amount) || 0;
    const paid = Number(l.paid_amount) || 0;
    const balance = Math.max(due - paid, 0);
    const isLabel = !!String(l.particulars || "").trim() && due === 0 && paid === 0;
    let status: "Paid" | "Overdue" | "Upcoming" | "Partial" = "Upcoming";
    if (due > 0 && paid >= due) status = "Paid";
    else if (paid > 0 && paid < due) status = "Partial";
    else if (l.due_date && new Date(l.due_date) < todayDate && balance > 0) status = "Overdue";
    return { ...l, due, paid, balance, status, isLabel };
  });
  const schedTotals = schedule.reduce(
    (a, r) => ({ due: a.due + r.due, paid: a.paid + r.paid, bal: a.bal + r.balance }),
    { due: 0, paid: 0, bal: 0 },
  );

  /* ---------- running cumulative on receipts ---------- */
  let cum = 0;
  const walked = rows.map((p) => {
    const amt = Number(p.amount || 0);
    cum += amt;
    return { ...p, _amt: amt, _cum: cum, _pending: Math.max(contract - cum, 0) };
  });

  /* ---------- info pairs for client grid ---------- */
  const unitDesc = consolidated
    ? `${allBookings.length} units (consolidated)`
    : `${primary.unit_id || "—"}${primary.unit_type ? ` (${primary.unit_type})` : ""}`;

  const infoPairs: Array<[string, React.ReactNode, string, React.ReactNode]> = [
    [
      "Client Name",
      <span style={{ textTransform: "capitalize" }}>{primary.client_name || "—"}</span>,
      "Unit No.",
      unitDesc,
    ],
    [
      "Covered Area",
      `${primary.size_sqft ? Number(primary.size_sqft).toLocaleString("en-US") : "—"} sq.ft.`,
      "Rate / Sq.Ft.",
      `PKR ${fmtPKR(primary.sold_rate || primary.rate_per_sqft || 0)}`,
    ],
    [
      "Total Sale Price",
      <span style={{ fontWeight: 700 }}>PKR {fmtPKR(contract)}</span>,
      "Booking Date",
      FMT(primary.booking_date),
    ],
    [
      "Down Payment",
      `${primary.down_payment_pct ? primary.down_payment_pct + "%" : ""}${primary.down_payment_pct ? " · " : ""}PKR ${fmtPKR(primary.down_payment || 0)}`,
      "No. of Installments",
      String(primary.no_of_installments ?? primary.installments_count ?? "—"),
    ],
    [
      "Installment Amount",
      `PKR ${fmtPKR(primary.installment_amount || 0)}`,
      "Installment Frequency",
      primary.installment_frequency || "Quarterly",
    ],
    ["First Installment", FMT(primary.first_installment_date), "Ledger As-Of", today],
  ];

  const payCols = consolidated ? 9 : 8;

  return (
    <div style={{ fontFamily: SANS, color: INK, fontSize: bodyFs, lineHeight: 1.4 }}>
      {/* ─── Doc reference strip (right-aligned, tiny — letterhead is rendered outside) */}
      <div style={{ textAlign: "right", fontSize: "8pt", color: SUB, marginBottom: "3mm" }}>
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: "11pt",
            color: NAVY,
            letterSpacing: "0.5px",
          }}
        >
          CLIENT PAYMENT LEDGER
        </div>
        <div>
          Ledger No.: <span style={{ fontWeight: 600, color: INK }}>{ledgerNo}</span>
        </div>
        <div>Statement Date: {today}</div>
        <div>As of: {today}</div>
      </div>

      {/* Navy + gold divider */}
      <div style={{ height: "2pt", background: NAVY }} />
      <div style={{ height: "0.75pt", background: GOLD, marginBottom: "3mm" }} />

      {/* ─── Multi-booking summary bar */}
      {consolidated && (
        <div
          style={{
            background: "#f5f5f5",
            borderBottom: `0.5pt solid ${RULE}`,
            padding: "2mm 3mm",
            fontSize: "8pt",
            color: "#333",
            marginBottom: "3mm",
          }}
        >
          <span style={{ fontWeight: 700, color: NAVY }}>Consolidated Statement</span>
          {allBookings.map((b, i) => (
            <span key={i}>
              {" | "}
              Booking {i + 1}: {b.unit_id || "—"} — PKR{" "}
              {fmtPKR(b.total_contract_value || b.sold_unit_value || 0)}
            </span>
          ))}
          {" | "}
          <span style={{ fontWeight: 700 }}>Total: PKR {fmtPKR(contract)}</span>
        </div>
      )}

      {/* ─── Client info grid (bordered 2-col) ─────────────────────────── */}
      <div style={{ border: `1pt solid ${RULE}`, marginBottom: "3mm" }}>
        {infoPairs.map(([l1, v1, l2, v2], i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              borderBottom: i < infoPairs.length - 1 ? `0.5pt solid #eeeeee` : "none",
            }}
          >
            <InfoCell label={l1} value={v1} dividerRight />
            <InfoCell label={l2} value={v2} />
          </div>
        ))}
      </div>

      {/* ─── PAYMENT SCHEDULE ─────────────────────────── */}
      {schedule.length > 0 && (
        <>
          <SectionBar>Payment Schedule</SectionBar>
          <table style={tableStyle}>
            <colgroup>
              <col style={{ width: "4%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "15%" }} />
            </colgroup>
            <thead>
              <tr style={theadStyle}>
                <Th>#</Th>
                <Th>Due Date</Th>
                <Th align="left">Particulars</Th>
                <Th align="right">Amount Due</Th>
                <Th align="right">Paid</Th>
                <Th align="right">Balance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((r, i) => {
                const odd = i % 2 === 1;
                const isOverdue = r.status === "Overdue";
                const isPaid = r.status === "Paid";
                const bg = isOverdue ? OVERDUE_BG : isPaid ? PAID_BG : odd ? ZEBRA : "#fff";
                const leftBorder = isOverdue ? `2.5pt solid ${OVERDUE_BORDER}` : "none";
                return (
                  <tr key={i} style={{ background: bg, height: rowH }}>
                    <Td style={{ padding: cellPad, borderLeft: leftBorder }}>{i + 1}</Td>
                    <Td style={{ padding: cellPad }}>{FMT(r.due_date)}</Td>
                    <Td align="left" style={{ padding: cellPad }}>
                      {r.particulars || "—"}
                    </Td>
                    <Td align="right" mono>
                      {r.due ? fmtPKR(r.due) : "—"}
                    </Td>
                    <Td align="right" mono>
                      {r.paid ? fmtPKR(r.paid) : "—"}
                    </Td>
                    <Td align="right" mono>
                      {r.balance ? fmtPKR(r.balance) : "—"}
                    </Td>
                    <Td>
                      <StatusCell status={r.status} />
                    </Td>
                  </tr>
                );
              })}
              <tr style={totalRowStyle}>
                <Td colSpan={3} align="right" style={{ padding: "2mm 3mm", color: GOLD_TEXT }}>
                  TOTAL
                </Td>
                <Td align="right" mono style={{ color: GOLD_TEXT, padding: "2mm 2mm" }}>
                  {fmtPKR(schedTotals.due)}
                </Td>
                <Td align="right" mono style={{ color: GOLD_TEXT, padding: "2mm 2mm" }}>
                  {fmtPKR(schedTotals.paid)}
                </Td>
                <Td align="right" mono style={{ color: GOLD_TEXT, padding: "2mm 2mm" }}>
                  {fmtPKR(schedTotals.bal)}
                </Td>
                <Td />
              </tr>
            </tbody>
          </table>
        </>
      )}

      {/* ─── PAYMENTS RECEIVED ─────────────────────────── */}
      <SectionBar style={{ marginTop: schedule.length > 0 ? "4mm" : "0" }}>
        Payments Received
      </SectionBar>
      <table style={tableStyle}>
        <colgroup>
          <col style={{ width: "4%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: consolidated ? "19%" : "25%" }} />
          {consolidated && <col style={{ width: "8%" }} />}
          <col style={{ width: "11%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "11%" }} />
        </colgroup>
        <thead>
          <tr style={theadStyle}>
            <Th>#</Th>
            <Th>Date</Th>
            <Th>Receipt No.</Th>
            <Th align="left">Particulars</Th>
            {consolidated && <Th>Unit</Th>}
            <Th>Mode</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Cumulative</Th>
            <Th align="right">Pending Bal.</Th>
          </tr>
        </thead>
        <tbody>
          {walked.length === 0 ? (
            <tr>
              <td
                colSpan={payCols}
                style={{
                  textAlign: "center",
                  padding: "10mm",
                  color: SUB,
                  fontStyle: "italic",
                  borderBottom: `0.4pt solid ${ROW_RULE}`,
                }}
              >
                No payments recorded for the selected period.
              </td>
            </tr>
          ) : (
            walked.map((p, i) => {
              const k = classifyMode(p);
              const isAdj = k === "Adjustment" || k === "Rent";
              const odd = i % 2 === 1;
              const bg = isAdj ? ADJ_BG : odd ? ZEBRA : "#fff";
              const unit = (p.unit_no || "—").trim();
              const isJoint = !unit || unit === "—";
              return (
                <tr key={(p.receipt_no || i) + ""} style={{ background: bg, height: rowH }}>
                  <Td style={{ padding: cellPad }}>{i + 1}</Td>
                  <Td style={{ padding: cellPad }}>{FMT(p.payment_date)}</Td>
                  <Td style={{ padding: cellPad, fontFamily: MONO }}>{p.receipt_no || "—"}</Td>
                  <Td align="left" style={{ padding: cellPad, textTransform: "capitalize" }}>
                    {p.payment_head || (isAdj ? "Adjustment" : "Payment")}
                  </Td>
                  {consolidated && (
                    <Td
                      style={{
                        padding: cellPad,
                        color: isJoint ? LABEL : INK,
                        fontStyle: isJoint ? "italic" : "normal",
                        fontFamily: MONO,
                        fontSize: "8pt",
                      }}
                    >
                      {isJoint ? "Joint" : unit}
                    </Td>
                  )}
                  <Td
                    style={{
                      padding: cellPad,
                      color: modeColor(k),
                      fontStyle: isAdj ? "italic" : "normal",
                      fontWeight: 600,
                    }}
                  >
                    {modeLabel(k)}
                  </Td>
                  <Td align="right" mono>
                    {fmtPKR(p._amt)}
                  </Td>
                  <Td align="right" mono>
                    {fmtPKR(p._cum)}
                  </Td>
                  <Td
                    align="right"
                    mono
                    style={{ color: p._pending > 0 ? OVERDUE_BORDER : PAID_FG }}
                  >
                    {fmtPKR(p._pending)}
                  </Td>
                </tr>
              );
            })
          )}
          {walked.length > 0 && (
            <tr style={totalRowStyle}>
              <Td
                colSpan={consolidated ? 5 : 4}
                align="right"
                style={{ padding: "2mm 3mm", color: GOLD_TEXT }}
              >
                TOTAL PAID
              </Td>
              <Td />
              <Td align="right" mono style={{ color: GOLD_TEXT, padding: "2mm 2mm" }}>
                {fmtPKR(totalReceived)}
              </Td>
              <Td align="right" style={{ padding: "2mm 3mm", color: GOLD_TEXT, fontWeight: 700 }}>
                PENDING
              </Td>
              <Td align="right" mono style={{ color: GOLD_TEXT, padding: "2mm 2mm" }}>
                {fmtPKR(outstanding)}
              </Td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ─── ACCOUNT SUMMARY ─────────────────────────── */}
      <div
        style={{
          borderTop: `1.5pt solid ${NAVY}`,
          borderBottom: `1.5pt solid ${NAVY}`,
          marginTop: "4mm",
          padding: "3mm 0",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
        }}
      >
        <SummaryCell label="Total Sale Price" value={contract} />
        <SummaryCell label="Total Amount Received" value={totalReceived} />
        <SummaryCell
          label="Outstanding Balance"
          value={outstanding}
          accent={outstanding > 0 ? OVERDUE_BORDER : PAID_FG}
        />
      </div>

      {/* ─── OVERDUE LINE (replaces red box) ─────────────────────────── */}
      {overdueAmt > 0 && (
        <div
          style={{
            marginTop: "3mm",
            padding: "2mm 0",
            borderBottom: `1pt solid ${OVERDUE_BORDER}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            color: OVERDUE_BORDER,
          }}
        >
          <span style={{ fontSize: "9pt" }}>Total Overdue Amount (as of {today}):</span>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: "12pt" }}>
            PKR {fmtPKR(overdueAmt)}
          </span>
        </div>
      )}

      {/* ─── Notes ─────────────────────────── */}
      <div
        style={{
          marginTop: "4mm",
          fontStyle: "italic",
          fontSize: "7.5pt",
          color: "#777",
          lineHeight: 1.5,
        }}
      >
        Notes: 1) All amounts in Pakistani Rupees (PKR). Dates shown as DD-MMM-YYYY.
        {consolidated &&
          " 2) This is a consolidated statement combining multiple bookings under one client."}{" "}
        3) Discrepancies must be reported in writing to the Accounts Office within 7 days of
        issuance.
      </div>

      {/* ─── Signatures ─────────────────────────── */}
      <div
        style={{
          marginTop: "8mm",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "20mm",
          fontSize: "8pt",
          color: "#333",
        }}
      >
        <div>
          <div style={{ borderTop: `0.5pt solid #333`, width: "55mm", marginBottom: "1mm" }} />
          <div style={{ textTransform: "capitalize", fontWeight: 600 }}>
            {primary.client_name || "Client Signature"}
          </div>
          <div style={{ color: SUB }}>Client Signature</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              borderTop: `0.5pt solid #333`,
              width: "55mm",
              marginLeft: "auto",
              marginBottom: "1mm",
            }}
          />
          <div style={{ fontWeight: 600 }}>Authorized Signatory</div>
          <div style={{ color: SUB }}>Precise Realtors &amp; Builders (Pvt.) Ltd.</div>
        </div>
      </div>

      {/* ─── Footer rule ─────────────────────────── */}
      <div style={{ marginTop: "5mm" }}>
        <div style={{ height: "0.5pt", background: GOLD }} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            fontSize: "7pt",
            color: LABEL,
            paddingTop: "1.5mm",
          }}
        >
          <span>
            {/heights/i.test(String(primary?.project_name || ""))
              ? "Manal Heights"
              : "Manal Arcade"}{" "}
            · Precise Realtors &amp; Builders (Pvt.) Ltd.
          </span>
          <span style={{ textAlign: "center" }}>Ledger {ledgerNo}</span>
          <span style={{ textAlign: "right" }}>Computer-generated</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── helpers ─────────────────────────── */

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontFamily: SANS,
};

const theadStyle: React.CSSProperties = {
  background: NAVY_HEAD,
  color: "#fff",
  fontWeight: 700,
  fontSize: "8pt",
};

const totalRowStyle: React.CSSProperties = {
  background: NAVY,
  color: GOLD_TEXT,
  fontWeight: 700,
  fontSize: "8.5pt",
  borderTop: `2pt solid ${NAVY}`,
};

function SectionBar({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: NAVY,
        color: "#fff",
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: "9pt",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        padding: "2mm 4mm",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function InfoCell({
  label,
  value,
  dividerRight,
}: {
  label: string;
  value: React.ReactNode;
  dividerRight?: boolean;
}) {
  return (
    <div
      style={{
        borderRight: dividerRight ? `0.5pt solid #e0e0e0` : "none",
        padding: "1.5mm 3mm",
      }}
    >
      <div
        style={{
          fontSize: "7.5pt",
          color: LABEL,
          textTransform: "uppercase",
          letterSpacing: "0.3px",
          marginBottom: "0.5mm",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "9pt", fontWeight: 700, color: INK }}>{value}</div>
    </div>
  );
}

function Th({
  children,
  align = "center",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      style={{
        padding: "1.5mm 2mm",
        textAlign: align,
        border: "none",
        fontWeight: 700,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "center",
  colSpan,
  style,
  mono,
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  colSpan?: number;
  style?: React.CSSProperties;
  mono?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "0 2mm",
        textAlign: align,
        borderBottom: `0.4pt solid ${ROW_RULE}`,
        verticalAlign: "middle",
        fontFamily: mono ? MONO : SANS,
        fontSize: mono ? "8.5pt" : undefined,
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function StatusCell({ status }: { status: "Paid" | "Overdue" | "Upcoming" | "Partial" }) {
  if (status === "Paid")
    return <span style={{ color: PAID_FG, fontWeight: 700, fontSize: "8pt" }}>✓ Paid</span>;
  if (status === "Overdue")
    return (
      <span style={{ color: OVERDUE_BORDER, fontWeight: 700, fontSize: "8pt" }}>● Overdue</span>
    );
  if (status === "Partial")
    return <span style={{ color: PARTIAL_FG, fontWeight: 700, fontSize: "8pt" }}>◑ Partial</span>;
  return <span style={{ color: UPCOMING_FG, fontSize: "8pt" }}>Upcoming</span>;
}

function SummaryCell({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontFamily: SANS,
          fontSize: "8pt",
          color: LABEL,
          textTransform: "uppercase",
          letterSpacing: "0.3px",
          marginBottom: "1mm",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontSize: "11pt",
          fontWeight: 700,
          color: accent || INK,
        }}
      >
        PKR {fmtPKR(value)}
      </div>
    </div>
  );
}

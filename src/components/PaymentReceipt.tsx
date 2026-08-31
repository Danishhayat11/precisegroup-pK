/**
 * PaymentReceipt — A4 single-page dual-copy receipt.
 *
 * Layout mirrors the reference "Manal Arcade" receipt design:
 * two identical halves stacked on one A4 sheet (Office Copy on top,
 * Client Copy below) separated by a dashed tear line with a scissors
 * glyph. Palette is a dark forest green primary with an amber accent
 * for the remaining-balance callout.
 *
 * Data plumbing (useQuery → supabase) and the wrapping PrintPreviewModal
 * contract (open / onOpenChange / receiptNo / autoAction) are unchanged
 * from the previous version.
 */
import { usePIIGuardedQuery } from "@/lib/access";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, fmtPKR, maskCNIC } from "@/lib/format";
import { amountInWordsPK as amountInWords } from "@/lib/amountInWords";
import PrintPreviewModal from "@/components/PrintPreviewModal";
import preciseCrewLogo from "@/assets/logos/precise-realtors-builders-color.png.asset.json";

// ---- palette -----------------------------------------------------------
const SANS = '"Calibri", Arial, sans-serif';
const MONO = '"Courier New", Courier, monospace';
const GREEN = "#0B3B2E"; // primary dark forest green
const GREEN_SOFT = "#E8F1EC"; // hero fill / balance panel bg
const GREEN_TEXT = "#0B3B2E"; // primary text on GREEN_SOFT
const AMBER = "#B45309"; // remaining balance emphasis
const INK = "#1a1a1a";
const SUB = "#6b7280";
const LABEL = "#6b7280"; // uppercase field labels
const RULE = "#d1d5db"; // card borders / dotted separators

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receiptNo: string | null;
  /** Immediately trigger the browser print dialog once loaded. */
  autoAction?: "print" | null;
}

interface ReceiptData {
  pay: any;
  b: any;
  amt: number;
  remaining: number;
  words: string;
}

export function PaymentReceipt({ open, onOpenChange, receiptNo, autoAction }: Props) {
  const { data } = usePIIGuardedQuery({
    queryKey: ["receipt", receiptNo],
    enabled: !!receiptNo && open,
    queryFn: async () => {
      const { data: pay } = await supabase
        .from("payments")
        .select("*")
        .eq("receipt_no", receiptNo!)
        .maybeSingle();
      if (!pay) return null;
      const { data: booking } = await supabase
        .from("bookings")
        .select("*")
        .eq("booking_id", pay.booking_id!)
        .maybeSingle();
      const { data: history } = await supabase
        .from("payments")
        .select("amount,payment_date,receipt_no")
        .eq("booking_id", pay.booking_id!)
        .order("payment_date", { ascending: true });
      const payDate = pay.payment_date ?? "";
      const upToHere = (history ?? []).filter((p: any) => {
        if ((p.payment_date ?? "") < payDate) return true;
        if ((p.payment_date ?? "") === payDate && p.receipt_no <= pay.receipt_no) return true;
        return false;
      });
      const prevReceived = upToHere
        .filter((p: any) => p.receipt_no !== pay.receipt_no)
        .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
      return { pay, booking, prevReceived };
    },
  });

  if (!receiptNo) return null;

  const pay = data?.pay;
  const b = data?.booking;
  const contract = Number(b?.total_contract_value ?? b?.sold_unit_value ?? 0);
  const adjustment = Number(b?.adjustment_credit ?? 0);
  const amt = Number(pay?.amount || 0);
  const prev = Number(data?.prevReceived || 0);
  // Adjustment credits (approved asset/loss write-offs) reduce the payable balance
  // just like cash — a client with a 60 PKR adjustment on a 110 PKR unit who pays
  // a 10 PKR installment should see 40 PKR remaining, not 100.
  const remaining = Math.max(contract - adjustment - prev - amt, 0);
  const words = amountInWords ? amountInWords(amt) : "";

  const rd: ReceiptData = { pay, b, amt, remaining, words };

  const body = (
    <div
      className="pp-receipt pp-payment-receipt"
      style={{
        fontFamily: SANS,
        color: INK,
        fontSize: "9pt",
        lineHeight: 1.4,
        fontFeatureSettings: '"kern" 1, "liga" 1, "tnum" 1, "lnum" 1',
        WebkitFontSmoothing: "antialiased",
        textRendering: "geometricPrecision",
      }}
    >
      {/* Structural + non-clipping print rules are supplied by the
          shared receipt stylesheet (see `src/lib/receiptPrintStyles.ts`)
          which PrintPreviewModal injects for both preview and print.
          Only palette-driven, template-local rules stay inline here. */}
      <style>{`
        .pp-payment-receipt .pp-num { font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1; }
        .pp-payment-receipt .pp-caps { text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600; font-size: 7.25pt; color: ${LABEL}; }
      `}</style>

      <ReceiptCopy {...rd} copyLabel="OFFICE COPY" />
      <TearLine />
      <ReceiptCopy {...rd} copyLabel="CLIENT COPY" />
    </div>
  );

  return (
    <PrintPreviewModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Payment Receipt — ${receiptNo}`}
      mode="react"
      style="B"
      docType="receipt"
      hideLetterhead
      forceSinglePage
      autoAction={autoAction ?? null}
    >
      {body}
    </PrintPreviewModal>
  );
}

/* ============================================================
 * ReceiptCopy — one half of the dual-copy A4 sheet
 * ============================================================ */

function ReceiptCopy({
  pay,
  b,
  amt,
  remaining,
  words,
  copyLabel,
}: ReceiptData & { copyLabel: "OFFICE COPY" | "CLIENT COPY" }) {
  const unitLine = `${b?.unit_type || "Unit"} No. ${b?.unit_id || "—"}${
    b?.floor ? `, ${b.floor} Floor` : ""
  }, ${b?.project_name || "Manal Arcade"}`;

  return (
    <div className="pp-copy" style={{ padding: "0" }}>
      {/* ── Header: logo / title / copy pills ────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          alignItems: "center",
          gap: "3mm",
          paddingBottom: "1.5mm",
          borderBottom: `1.25pt solid ${GREEN}`,
        }}
      >
        <img
          src={preciseCrewLogo.url}
          alt=""
          width={44}
          height={44}
          style={{ display: "block", width: "11mm", height: "11mm", objectFit: "contain" }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 800,
              fontSize: "13pt",
              color: GREEN,
              letterSpacing: "0.14em",
              lineHeight: 1.05,
            }}
          >
            {(b?.project_name || "Manal Arcade").toUpperCase()}
          </div>
          <div
            className="pp-simplified-hide"
            style={{ fontStyle: "italic", fontSize: "7.5pt", color: SUB, marginTop: "0.3mm" }}
          >
            Crafting Landmarks · Creating Trust
          </div>
          <div
            className="pp-caps pp-simplified-hide"
            style={{ marginTop: "0.3mm", letterSpacing: "0.16em", fontSize: "6.75pt" }}
          >
            Precise Realtors &amp; Builders (Pvt.) Ltd.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "1mm",
            minWidth: 0,
            maxWidth: "100%",
          }}
        >
          <div
            style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "1.25mm" }}
          >
            <Pill filled>PAYMENT RECEIPT</Pill>
            <Pill>{copyLabel}</Pill>
          </div>
          <div
            className="pp-simplified-hide"
            style={{ fontSize: "6.75pt", color: SUB, letterSpacing: "0.05em" }}
          >
            NTN # 8169355 · CUI # 0150809
          </div>
        </div>
      </div>

      {/* ── Row 1: receipt no (filled) + date + booking id ───────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "1.5mm",
          marginTop: "2mm",
        }}
      >
        <FieldCard label="Receipt No." value={pay?.receipt_no || "—"} accent />
        <FieldCard label="Date" value={fmtDate(pay?.payment_date)} />
        <FieldCard label="Booking ID" value={pay?.booking_id || "—"} />
      </div>

      {/* ── Received from / CNIC / Unit — dotted rows ────────────── */}
      <div style={{ marginTop: "1.5mm", padding: "0 1mm" }}>
        <DottedRow
          label="Received From"
          value={b?.client_name || "—"}
          extraLabel="CNIC"
          extraValue={maskCNIC(b?.cnic)}
        />
        <DottedRow label="Unit" value={unitLine} />
      </div>

      {/* ── Amount hero ─────────────────────────────────────────── */}
      <div
        className="pp-avoid-break"
        style={{
          marginTop: "2mm",
          border: `1.25pt solid ${GREEN}`,
          background: GREEN_SOFT,
          borderRadius: "3pt",
          padding: "1.75mm 3mm",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "center",
          gap: "3mm",
        }}
      >
        <div>
          <div className="pp-caps" style={{ color: GREEN_TEXT }}>
            Amount Received
          </div>
          {words && (
            <div
              className="pp-simplified-hide"
              style={{ fontStyle: "italic", fontSize: "8pt", color: SUB, marginTop: "0.3mm" }}
            >
              {words}
            </div>
          )}
        </div>
        <div
          className="pp-num"
          style={{
            fontFamily: SANS,
            fontWeight: 800,
            fontSize: "16pt",
            color: GREEN,
            letterSpacing: "-0.005em",
            maxWidth: "100%",
            whiteSpace: "nowrap",
          }}
        >
          PKR&nbsp;{fmtPKR(amt)}
        </div>
      </div>

      {/* ── Payment details 4-col ──────────────────────────────── */}
      <div
        style={{
          marginTop: "2mm",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: "1.5mm",
        }}
      >
        <FieldCard label="Payment Method" value={pay?.payment_mode || "—"} />
        <FieldCard label="Payment Head" value={pay?.payment_head || "—"} />
        <FieldCard label="Bank / Ref." value={pay?.account || pay?.cheque_txn_no || "—"} />
        <FieldCard label="Received By" value={pay?.posted_by || "—"} />
      </div>

      {/* ── Balance panel ──────────────────────────────────────── */}
      <div
        className="pp-avoid-break"
        style={{
          marginTop: "2mm",
          border: `0.75pt solid ${RULE}`,
          background: "#F7F8F7",
          borderRadius: "3pt",
          padding: "1.5mm",
        }}
      >
        <div className="pp-caps" style={{ color: GREEN_TEXT, marginBottom: "1mm" }}>
          Account Balance After This Payment
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5mm" }}>
          <BalCard label="This Payment" value={`+ PKR ${fmtPKR(amt)}`} tone="green" />
          <BalCard label="Remaining Balance" value={`PKR ${fmtPKR(remaining)}`} tone="amber" />
        </div>
      </div>

      {/* ── Disclaimer ─────────────────────────────────────────── */}
      <div
        className="pp-simplified-hide"
        style={{
          marginTop: "2mm",
          fontStyle: "italic",
          fontSize: "6.75pt",
          color: SUB,
          lineHeight: 1.45,
        }}
      >
        Payment is valid only when credited to the Company&rsquo;s official bank account. Receipt is
        subject to bank clearance. Unauthorized cash or third-party payments are not accepted.
        Report any discrepancy to the Accounts Office within seven (7) days.
      </div>

      {/* ── Signature row ──────────────────────────────────────── */}
      <div
        className="pp-avoid-break"
        style={{
          marginTop: "3mm",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "4mm",
          fontSize: "7.75pt",
        }}
      >
        <SigCol title={pay?.posted_by || "—"} sub="Received By" />
        <SigCol
          title="Precise Realtors & Builders"
          sub="Authorized Signatory"
          tiny="Company Stamp"
        />
        <SigCol title={b?.client_name || "—"} sub="Client Signature" />
      </div>

      {/* ── Footer / address ────────────────────────────────────── */}
      <div
        style={{
          marginTop: "2mm",
          paddingTop: "1.25mm",
          borderTop: `0.5pt solid ${RULE}`,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, auto)",
          gap: "2mm",
          fontSize: "7pt",
          color: SUB,
          letterSpacing: "0.02em",
        }}
      >
        <span>
          {/heights/i.test(String(b?.project_name || ""))
            ? "Office #01, 1st Floor, Manal Heights, B-17 Multi Gardens, Islamabad"
            : "Office #01, 1st Floor, Manal Arcade, B-1 Markaz, B-17 Islamabad"}
        </span>
        <span style={{ textAlign: "right", overflowWrap: "anywhere" }}>
          0344-5533767 · 0334-5533767 · precisegroup.pk
        </span>
      </div>
    </div>
  );
}

/* ============================================================
 * Building blocks
 * ============================================================ */

function Pill({ children, filled }: { children: React.ReactNode; filled?: boolean }) {
  return (
    <div
      className="pp-caps"
      style={{
        color: filled ? "#fff" : GREEN,
        background: filled ? GREEN : "#fff",
        border: `0.75pt solid ${GREEN}`,
        borderRadius: "3pt",
        padding: "1.25mm 2.5mm",
        letterSpacing: "0.18em",
        fontSize: "7.75pt",
        fontWeight: 700,
      }}
    >
      {children}
    </div>
  );
}

function FieldCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        border: `0.75pt solid ${accent ? GREEN : RULE}`,
        background: accent ? GREEN : "#fff",
        borderRadius: "3pt",
        padding: "1.75mm 2.5mm",
      }}
    >
      <div className="pp-caps" style={{ color: accent ? "#D9E9E1" : LABEL }}>
        {label}
      </div>
      <div
        className="pp-num"
        style={{
          fontWeight: 700,
          fontSize: "9.75pt",
          color: accent ? "#fff" : INK,
          marginTop: "0.5mm",
          fontFamily: MONO,
          letterSpacing: "0.01em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function DottedRow({
  label,
  value,
  extraLabel,
  extraValue,
}: {
  label: string;
  value: React.ReactNode;
  extraLabel?: string;
  extraValue?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: extraLabel ? "auto 1fr auto 1fr" : "auto 1fr",
        gap: "3mm",
        alignItems: "baseline",
        padding: "1.5mm 0",
        borderBottom: `0.5pt dotted ${RULE}`,
      }}
    >
      <span className="pp-caps">{label}</span>
      <span style={{ fontWeight: 600, fontSize: "9.5pt", letterSpacing: "-0.003em" }}>{value}</span>
      {extraLabel && (
        <>
          <span className="pp-caps">{extraLabel}</span>
          <span
            className="pp-num"
            style={{ fontWeight: 600, fontSize: "9.5pt", fontFamily: MONO, textAlign: "right" }}
          >
            {extraValue}
          </span>
        </>
      )}
    </div>
  );
}

function BalCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "amber";
}) {
  const color = tone === "green" ? GREEN : AMBER;
  return (
    <div
      style={{
        background: "#fff",
        border: `0.75pt solid ${RULE}`,
        borderRadius: "3pt",
        padding: "2mm 2.5mm",
      }}
    >
      <div className="pp-caps">{label}</div>
      <div
        className="pp-num"
        style={{
          marginTop: "0.5mm",
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: "11pt",
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SigCol({ title, sub, tiny }: { title: string; sub: string; tiny?: string }) {
  return (
    <div>
      <div style={{ borderTop: `0.75pt solid #333`, marginBottom: "1mm" }} />
      <div className="pp-caps" style={{ color: INK, letterSpacing: "0.14em", fontSize: "7.75pt" }}>
        {sub}
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: "9pt",
          marginTop: "0.5mm",
          textTransform: "capitalize",
        }}
      >
        {title}
      </div>
      {tiny && (
        <div style={{ fontStyle: "italic", fontSize: "7.5pt", color: SUB, marginTop: "0.5mm" }}>
          {tiny}
        </div>
      )}
    </div>
  );
}

function TearLine() {
  return (
    <div
      aria-hidden
      className="pp-tear-line"
      style={{
        margin: "1.75mm 0",
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: "3mm",
        color: SUB,
        fontSize: "7.5pt",
        letterSpacing: "0.2em",
      }}
    >
      <div style={{ borderTop: `0.75pt dashed ${RULE}` }} />
      <span>✂ TEAR HERE</span>
      <div style={{ borderTop: `0.75pt dashed ${RULE}` }} />
    </div>
  );
}

export default PaymentReceipt;

/* allow-raw-color-file: document-status chips use palette colors pending status-token migration
 * Tracked debt: migrate to semantic status tokens (bg-success, bg-warning,
 * bg-destructive, bg-info) in follow-up. Guardrail (scripts/ci/no-hex-in-
 * marketing-shell.mjs) blocks NEW drift while this marker documents the
 * legacy status-color usage in-file. */
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtPKR, fmtDate } from "@/lib/format";
import { cleanLedger } from "@/lib/ledger";
import { amountInWordsPK } from "@/lib/amountInWords";
import {
  Printer,
  FileText,
  AlertTriangle,
  Ban,
  Gavel,
  Search,
  Sparkles,
  Send,
  FileSignature,
  FileCheck2,
  CalendarClock,
  BellRing,
  Receipt,
  ListOrdered,
  KeySquare,
  Key,
  ArrowRightLeft,
  ChevronRight,
  History,
} from "lucide-react";
import PaymentHistoryDialog from "@/components/PaymentHistoryDialog";
import { format, addDays, parseISO } from "date-fns";
import { useAuth } from "@/lib/auth";
import { withCompany } from "@/lib/companyScope";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type DocKey = "legal" | "final" | "final_cancel" | "cancellation";

const DOC_META: Record<
  DocKey,
  {
    slug: string;
    title: string;
    short: string;
    icon: any;
    deadline: number;
    recommendedFor: (n: number) => boolean;
  }
> = {
  legal: {
    slug: "legal-notice",
    title: "Legal Notice (Show Cause)",
    short: "10. Legal Notice",
    icon: FileText,
    deadline: 15,
    recommendedFor: (n) => n >= 1 && n <= 2,
  },
  final: {
    slug: "final-legal-notice",
    title: "Final Legal Notice",
    short: "11. Final Legal Notice",
    icon: AlertTriangle,
    deadline: 10,
    recommendedFor: (n) => n >= 3 && n <= 4,
  },
  final_cancel: {
    slug: "final-cancel-warning",
    title: "Final Legal Notice — Cancellation Warning",
    short: "12. Final + Cancellation Warning",
    icon: Gavel,
    deadline: 10,
    recommendedFor: (n) => n >= 5,
  },
  cancellation: {
    slug: "cancellation-notice",
    title: "Final Cancellation Notice",
    short: "13. Cancellation Notice",
    icon: Ban,
    deadline: 0,
    recommendedFor: () => false,
  },
};

const GENERATED_DOCS: { slug: string; title: string; description: string; icon: any }[] = [
  {
    slug: "sale-agreement",
    title: "1. Agreement to Sell",
    description: "Full sale agreement with all 14 legal clauses",
    icon: FileSignature,
  },
  {
    slug: "allotment",
    title: "2. Allotment Letter",
    description: "Formal allotment of the unit to the client",
    icon: FileCheck2,
  },
  {
    slug: "payment-plan",
    title: "3. Payment Plan / Installment Schedule",
    description: "Auto-built schedule from the booking ledger",
    icon: CalendarClock,
  },
  {
    slug: "demand-notice",
    title: "4. Demand Notice",
    description: "Soft demand for overdue installments",
    icon: BellRing,
  },
  {
    slug: "receipt",
    title: "5. Payment Receipt",
    description: "Branded receipt for a single payment",
    icon: Receipt,
  },
  {
    slug: "deposit-summary",
    title: "6. Deposit Summary / Account Statement",
    description: "Full statement of payments, adjustments, balance",
    icon: ListOrdered,
  },
  {
    slug: "prov-possession",
    title: "7. Provisional Possession Letter",
    description: "Provisional handover prior to final possession",
    icon: KeySquare,
  },
  {
    slug: "possession",
    title: "8. Possession Letter",
    description: "Final possession after full payment",
    icon: Key,
  },
  {
    slug: "transfer-form",
    title: "9. Transfer Form",
    description: "Transfer of booking from one client to another",
    icon: ArrowRightLeft,
  },
  {
    slug: "payment-history",
    title: "+ Payment History",
    description: "Printable client statement of all payments made",
    icon: History,
  },
];

const FMT_DATE = (d?: string | Date | null) =>
  d ? format(typeof d === "string" ? parseISO(d) : d, "dd-MM-yyyy") : "____________";

function clientTitle(b: any): string {
  const g = (b?.gender || b?.title || "").toString().toLowerCase();
  if (g.startsWith("f") || g.includes("mrs") || g.includes("ms")) return "Ms.";
  return "Mr.";
}

function noticeRef(unit: string, doc: DocKey, serial = 1) {
  const u = (unit || "MA").replace(/[^A-Z0-9-]/gi, "");
  const yr = new Date().getFullYear();
  const s = String(serial).padStart(3, "0");
  return doc === "cancellation" ? `PRB/MA/${u}/CAN/${s}` : `PRB/MA/${u}/${yr}-${s}`;
}

import { useAdminDocumentGate } from "@/lib/useAdminDocumentGate";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileDocuments } from "@/components/documents/MobileDocuments";

export default function Documents() {
  const _adminGate = useAdminDocumentGate("documents");
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [docType, setDocType] = useState<DocKey | null>(null);
  const [prevNotice1, setPrevNotice1] = useState("");
  const [prevNotice2, setPrevNotice2] = useState("");
  const [sentOpen, setSentOpen] = useState(false);
  const [tcsNo, setTcsNo] = useState("");
  const [saving, setSaving] = useState(false);
  const { user, canWrite, companyId } = useAuth();
  const qc = useQueryClient();

  const sentLabel =
    docType === "cancellation"
      ? "Cancellation Notice Sent"
      : docType === "final" || docType === "final_cancel"
        ? "Final Legal Notice Sent"
        : "Legal Notice Sent";

  async function markAsSent() {
    if (!booking || !docType) return;
    setSaving(true);
    try {
      // create a tiny text "stub" file so the document record always points to a real file in storage
      const today = new Date().toISOString().slice(0, 10);
      const fileName = `${sentLabel.replace(/[^\w]+/g, "_")}_${booking.booking_id}_${today}.txt`;
      const body = `${sentLabel}\nBooking: ${booking.booking_id}\nClient: ${booking.client_name}\nUnit: ${booking.unit_id}\nRef: ${ref}\nTCS Tracking: ${tcsNo || "—"}\nSent: ${today}\n`;
      const file = new Blob([body], { type: "text/plain" });
      const path = `${booking.booking_id}/${Date.now()}_${fileName}`;
      const up = await supabase.storage
        .from("booking-documents")
        .upload(path, file, { contentType: "text/plain", upsert: false });
      if (up.error) throw up.error;
      const { error } = await supabase.from("booking_documents").insert(
        withCompany(
          {
            booking_id: booking.booking_id,
            label: sentLabel,
            doc_date: today,
            notes: tcsNo ? `TCS tracking: ${tcsNo}` : "Sent via TCS",
            tracking_no: tcsNo || null,
            status: "Sent",
            file_name: fileName,
            file_path: path,
            file_size: body.length,
            mime_type: "text/plain",
            uploaded_by: user?.id ?? null,
            uploaded_by_name: user?.email ?? null,
          },
          companyId!,
        ),
      );
      if (error) throw error;
      toast.success(`${sentLabel} recorded`);
      qc.invalidateQueries({ queryKey: ["booking-doc-counts"] });
      qc.invalidateQueries({ queryKey: ["booking-docs", booking.booking_id] });
      setSentOpen(false);
      setTcsNo("");
    } catch (err: any) {
      toast.error("Could not save", { description: err.message ?? String(err) });
    } finally {
      setSaving(false);
    }
  }

  const { data: bookings = [], accessDenied } = usePIIGuardedQuery<any[]>({
    queryKey: ["doc-bookings-all"],
    queryFn: async () =>
      (await supabase.from("bookings").select("*").order("client_name")).data ?? [],
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bookings.slice(0, 20);
    return bookings
      .filter((b: any) =>
        [b.booking_id, b.client_name, b.unit_id, b.cnic].some((v) =>
          (v || "").toString().toLowerCase().includes(q),
        ),
      )
      .slice(0, 20);
  }, [search, bookings]);

  const booking = bookings.find((b: any) => b.booking_id === bookingId);

  const { data: ledger = [] } = usePIIGuardedQuery({
    queryKey: ["doc-ledger-all", bookingId],
    enabled: !!bookingId,
    queryFn: async () =>
      cleanLedger(
        (
          await supabase
            .from("installment_ledger")
            .select("*")
            .eq("booking_id", bookingId)
            .order("due_date")
        ).data,
      ),
  });

  const { data: bookingPayments = [] } = usePIIGuardedQuery<any[]>({
    queryKey: ["doc-booking-payments", bookingId],
    enabled: !!bookingId,
    queryFn: async () =>
      (
        await supabase
          .from("payments")
          .select("safe_cash_amount,amount,payment_mode")
          .eq("booking_id", bookingId)
      ).data ?? [],
  });

  const totalPaid = useMemo(
    () => (bookingPayments as any[]).reduce((s, p) => s + Number(p.safe_cash_amount ?? 0), 0),
    [bookingPayments],
  );
  const contractValue = Number(booking?.total_contract_value ?? booking?.sold_unit_value ?? 0);
  const balance = Math.max(0, contractValue - totalPaid);

  const overdueRows = useMemo(
    () =>
      ledger.filter(
        (l: any) => (l.status || "").toLowerCase() === "overdue" || (l.days_overdue ?? 0) > 0,
      ),
    [ledger],
  );
  const overdueAmount = useMemo(
    () =>
      overdueRows.reduce(
        (s: number, l: any) => s + (Number(l.due_amount || 0) - Number(l.paid_amount || 0)),
        0,
      ),
    [overdueRows],
  );
  const overdueCount = overdueRows.length || booking?.current_overdue_count || 0;

  // Auto-recommend a doc once booking is picked
  useEffect(() => {
    if (!booking || docType) return;
    const n = overdueCount;
    if (n >= 5) setDocType("final_cancel");
    else if (n >= 3) setDocType("final");
    else if (n >= 1) setDocType("legal");
  }, [booking, overdueCount]); // eslint-disable-line

  const todayStr = FMT_DATE(new Date());
  const deadlineStr = docType ? FMT_DATE(addDays(new Date(), DOC_META[docType].deadline)) : "";
  const ref = booking && docType ? noticeRef(booking.unit_id ?? "", docType) : "";

  const ctx =
    booking && docType
      ? {
          ref,
          today: todayStr,
          deadline: deadlineStr,
          title: clientTitle(booking),
          name: (booking.client_name || "").toUpperCase(),
          father: booking.so_wo ? `S/O ${booking.so_wo}` : "",
          cnic: booking.cnic || "____________",
          address: booking.address || "____________",
          unitNo: booking.unit_id || "____________",
          unitType: booking.unit_type || "Unit",
          floor: booking.floor || "",
          project: booking.project_name || "Manal Heights",
          isHeights: /heights/i.test(String(booking.project_name || "")),
          projectAddress: /heights/i.test(String(booking.project_name || ""))
            ? "Manal Heights, B-17 Multi Gardens, Islamabad"
            : "Manal Heights, B-17 Multi Gardens, Islamabad",
          projectAddressFull: /heights/i.test(String(booking.project_name || ""))
            ? "Manal Heights, Plot No. 04, B-17 Multi Gardens, Islamabad"
            : "Manal Heights, Plot No. 04, B-17 Multi Gardens, Islamabad",
          projectEmail: /heights/i.test(String(booking.project_name || ""))
            ? "manalheights@gmail.com"
            : "manalheights@gmail.com",
          projectShortAddr: /heights/i.test(String(booking.project_name || ""))
            ? "Manal Heights, B-17, Islamabad"
            : "Manal Heights, B-17, Islamabad",
          size: booking.size_sqft ? Number(booking.size_sqft).toLocaleString("en-PK") : "____",
          bookingDate: FMT_DATE(booking.booking_date),
          contractDate: FMT_DATE(booking.booking_date),
          overdueCount,
          overdueAmount,
          overdueAmtFmt: `PKR ${fmtPKR(overdueAmount)}/-`,
          overdueWords: amountInWordsPK(overdueAmount),
          prev1: FMT_DATE(prevNotice1),
          prev2: FMT_DATE(prevNotice2),
          overdueRows,
        }
      : null;

  if (_adminGate.blocked) return _adminGate.blocked;
  if (accessDenied)
    return (
      <div>
        <PageHeader title="Documents" description="Restricted view" />
        <AccessDenied
          title="Document generation restricted"
          description="Client bookings and ledger data feed these documents — visible only to admin, manager, and staff roles."
        />
      </div>
    );

  if (isMobile) return <MobileDocuments />;

  return (
    <div>
      <PageHeader
        title="Document Generation Center"
        description="Auto-populate and print A4 legal documents for defaulting clients"
      />

      <LetterheadLivePreview />

      {/* STEP 1 */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">Select booking</div>
            <div className="text-xs text-muted-foreground">
              Search by Booking ID, Client Name, Unit or CNIC
            </div>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-8"
            />
          </div>
        </div>

        {!bookingId && (
          <div className="border rounded-md max-h-64 overflow-y-auto divide-y">
            {filtered.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No bookings match.</div>
            )}
            {filtered.map((b: any) => (
              <button
                key={b.booking_id}
                onClick={() => {
                  setBookingId(b.booking_id);
                  setDocType(null);
                }}
                className="w-full text-left p-3 hover:bg-muted flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-medium capitalize">{b.client_name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {b.booking_id} · {b.unit_id}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs">
                    Overdue: <span className="font-semibold">{b.current_overdue_count ?? 0}</span>
                  </div>
                  <div className="text-xs">PKR {fmtPKR(b.total_overdue_amount || 0)}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {booking && (
          <div className="bg-muted/40 rounded-md p-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Client</div>
                <div className="font-semibold capitalize">{booking.client_name}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Unit</div>
                <div className="font-mono">{booking.unit_id}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Floor</div>
                <div>{booking.floor || "—"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Contract Value</div>
                <div className="font-semibold">PKR {fmtPKR(contractValue)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Total Paid</div>
                <div className="font-semibold text-green-700">PKR {fmtPKR(totalPaid)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Balance</div>
                <div className="font-semibold">PKR {fmtPKR(balance)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Overdue</div>
                <div>
                  <span className="font-semibold">{overdueCount}</span> · PKR{" "}
                  {fmtPKR(overdueAmount)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Risk</div>
                <Badge variant={booking.risk_level === "HIGH" ? "destructive" : "secondary"}>
                  {booking.risk_level || "LOW"}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto self-start"
                onClick={() => {
                  setBookingId("");
                  setDocType(null);
                }}
              >
                Change booking
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* GENERATED DOCUMENTS (1–9) */}
      {booking && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <div className="text-sm font-semibold">Generated Documents (1–9)</div>
              <div className="text-xs text-muted-foreground">
                Click any document to open the auto-filled template for{" "}
                <span className="font-medium capitalize">{booking.client_name}</span> ·{" "}
                <span className="font-mono">{booking.unit_id}</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {GENERATED_DOCS.map((d) => {
              if (d.slug === "payment-history") {
                return <PaymentHistoryCard key={d.slug} bookingId={booking.booking_id} doc={d} />;
              }
              return (
                <Link
                  key={d.slug}
                  to="/documents/$type"
                  params={{ type: d.slug }}
                  search={{ booking: booking.booking_id } as any}
                  className="group rounded-lg border p-3 hover:border-primary hover:bg-primary/5 transition flex items-start gap-3"
                >
                  <d.icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{d.title}</div>
                    <div className="text-[11px] text-muted-foreground">{d.description}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 mt-1" />
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {/* LEGAL NOTICES (10–13) */}
      {booking && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <div className="text-sm font-semibold">Legal Notices (10–13)</div>
            <div className="text-xs text-muted-foreground">
              Recommended based on <span className="font-semibold">{overdueCount}</span> overdue
              installments
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-xs">Date of previous notice (for #11–13)</Label>
              <Input
                type="date"
                value={prevNotice1}
                onChange={(e) => setPrevNotice1(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Date of second previous notice (for #12–13)</Label>
              <Input
                type="date"
                value={prevNotice2}
                onChange={(e) => setPrevNotice2(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
            {(Object.keys(DOC_META) as DocKey[]).map((k) => {
              const m = DOC_META[k];
              const recommended = m.recommendedFor(overdueCount);
              const search: Record<string, string> = { booking: booking.booking_id };
              if (prevNotice1) search.prev1 = prevNotice1;
              if (prevNotice2) search.prev2 = prevNotice2;
              return (
                <Link
                  key={k}
                  to="/documents/$type"
                  params={{ type: m.slug }}
                  search={search as any}
                  className={`group relative rounded-lg border p-3 transition flex items-start gap-3 ${
                    recommended
                      ? "border-accent bg-accent/10 hover:bg-accent/15"
                      : "hover:border-primary hover:bg-primary/5"
                  }`}
                >
                  <m.icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{m.short}</div>
                    <div className="text-[11px] text-muted-foreground">{m.title}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 mt-1" />
                  {recommended && (
                    <Badge className="absolute -top-2 -right-2 text-[9px] gap-1" variant="default">
                      <Sparkles className="h-2.5 w-2.5" /> Recommended
                    </Badge>
                  )}
                </Link>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

export function LetterheadLivePreview() {
  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["s-projects"],
    queryFn: async () => (await supabase.from("projects").select("*")).data ?? [],
  });

  const items = useMemo(() => {
    // Fallback to a hard-coded Heights entry so the preview is useful even
    // before the projects table is populated in a fresh environment.
    if (!projects.length) {
      return [{ code: "MH", project_name: "Manal Heights", display_name: "Manal Heights" }];
    }
    return projects;
  }, [projects]);

  const [activeCode, setActiveCode] = useState<string>(() => items[0]?.code ?? "MH");
  const active = items.find((p: any) => p.code === activeCode) ?? items[0];
  const displayName: string = active?.display_name || active?.project_name || "Manal Heights";
  const isHeights = /heights/i.test(displayName);
  const previewCtx = {
    brandName: displayName,
    isHeights,
    projectShortAddr: isHeights
      ? "Manal Heights, B-17, Islamabad"
      : `${displayName}, B-17, Islamabad`,
    projectAddress: isHeights
      ? "Manal Heights, B-17 Multi Gardens, Islamabad"
      : `${displayName}, B-17 Multi Gardens, Islamabad`,
    projectEmail: "manalheights@gmail.com",
  };

  return (
    <Card className="p-4 mb-4" data-testid="letterhead-live-preview">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-sm font-semibold">Live letterhead preview</div>
          <div className="text-xs text-muted-foreground">
            Reflects the project display name from Settings — edits appear here immediately.
          </div>
        </div>
        {items.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            {items.map((p: any) => (
              <Button
                key={p.code}
                size="sm"
                variant={p.code === activeCode ? "default" : "outline"}
                onClick={() => setActiveCode(p.code)}
                className="min-h-11 min-w-11"
              >
                {p.display_name || p.project_name}
              </Button>
            ))}
          </div>
        )}
      </div>
      <div
        className="mx-auto bg-white text-black rounded border p-6"
        style={{ maxWidth: "820px", fontFamily: "'Times New Roman', serif" }}
      >
        <Letterhead c={previewCtx} />
        <div style={{ fontSize: "10.5pt", color: "#555", textAlign: "center", padding: "8pt 0" }}>
          <em>Sample body — this preview updates when the display name changes in Settings.</em>
        </div>
        <Footer c={previewCtx} />
      </div>
    </Card>
  );
}

export function Letterhead({ variant = "manal", c }: { variant?: "manal" | "precise"; c?: any }) {
  const isHeights = !!c?.isHeights;
  const defaultBrand = isHeights ? "MANAL HEIGHTS" : "MANAL ARCADE";
  const brandName = c?.brandName ? String(c.brandName).toUpperCase() : defaultBrand;
  const tagline = isHeights ? "Elevated Living · Timeless Value" : "A vision for your living style";
  const preciseSub = c?.projectShortAddr
    ? c.projectShortAddr.toUpperCase()
    : isHeights
      ? "MANAL HEIGHTS, B-17, ISLAMABAD"
      : "MANAL ARCADE, B-17, ISLAMABAD";
  return (
    <div
      style={{
        textAlign: "center",
        borderBottom: "1.5pt solid #1B2B4B",
        paddingBottom: "8pt",
        marginBottom: "14pt",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "16pt", letterSpacing: "1px", color: "#1B2B4B" }}>
        {variant === "precise" ? "PRECISE REALTORS & BUILDERS (PVT.) LTD." : brandName}
      </div>
      <div style={{ fontSize: "10pt", color: "#555", marginTop: "2pt" }}>
        {variant === "precise" ? preciseSub : tagline}
      </div>
      <div style={{ fontSize: "9pt", color: "#777", marginTop: "2pt" }}>
        NTN: 8169355 · CUI: 0150809
      </div>
    </div>
  );
}

export function Footer({ variant = "manal", c }: { variant?: "manal" | "precise"; c?: any }) {
  const addr = c?.projectAddress || "Manal Heights, B-17 Multi Gardens, Islamabad";
  const email = c?.projectEmail || "manalheights@gmail.com";
  const officeAddr = c?.isHeights
    ? "Office #01, 1st Floor, Manal Heights, B-17 Multi Gardens, Islamabad"
    : "Office #01, 1st Floor, Manal Heights, B-17 Multi Gardens, Islamabad";
  return (
    <div
      style={{
        marginTop: "24pt",
        paddingTop: "8pt",
        borderTop: "1pt solid #1B2B4B",
        fontSize: "8.5pt",
        color: "#444",
        textAlign: "center",
        lineHeight: 1.4,
      }}
    >
      {variant === "precise" ? (
        <>Precise Realtors &amp; Builders (Pvt.) Ltd. · {addr}</>
      ) : (
        <>
          033 45533767 · 0331 2220520 · 0344 5533767 · {email} · www.precisegroupintl.com
          <br />
          {officeAddr} · Plot #04 Block B-Ext, MPCHS B-17, Islamabad
        </>
      )}
    </div>
  );
}

function Highlight({ children }: { children: any }) {
  return <span style={{ color: "#1d4ed8", fontWeight: 600 }}>{children}</span>;
}

function OverdueTable({ rows }: { rows: any[] }) {
  if (!rows?.length) return null;
  return (
    <table
      style={{ width: "100%", borderCollapse: "collapse", fontSize: "10pt", margin: "10pt 0" }}
    >
      <thead>
        <tr style={{ background: "#f0f0f0" }}>
          <th
            style={{
              border: "0.6pt solid #555",
              padding: "4pt 6pt",
              textAlign: "left",
              width: "10%",
            }}
          >
            Sr.
          </th>
          <th style={{ border: "0.6pt solid #555", padding: "4pt 6pt", textAlign: "left" }}>
            Particulars
          </th>
          <th
            style={{
              border: "0.6pt solid #555",
              padding: "4pt 6pt",
              textAlign: "left",
              width: "25%",
            }}
          >
            Due Date
          </th>
          <th
            style={{
              border: "0.6pt solid #555",
              padding: "4pt 6pt",
              textAlign: "right",
              width: "25%",
            }}
          >
            Amount (PKR)
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.ledger_id || i}>
            <td style={{ border: "0.6pt solid #555", padding: "4pt 6pt" }}>{i + 1}</td>
            <td style={{ border: "0.6pt solid #555", padding: "4pt 6pt" }}>
              {r.particulars || "Installment"}
            </td>
            <td style={{ border: "0.6pt solid #555", padding: "4pt 6pt" }}>
              {FMT_DATE(r.due_date)}
            </td>
            <td style={{ border: "0.6pt solid #555", padding: "4pt 6pt", textAlign: "right" }}>
              {fmtPKR(Number(r.due_amount || 0) - Number(r.paid_amount || 0))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BankBlock() {
  return (
    <div
      style={{
        margin: "8pt 0",
        padding: "8pt 10pt",
        background: "#f7f7f7",
        border: "0.5pt solid #ccc",
        fontSize: "10.5pt",
      }}
    >
      <div>
        <strong>Bank:</strong> Al Habib Limited
      </div>
      <div>
        <strong>Account Title:</strong> Precise Realtors &amp; Builders (Pvt.) Ltd.
      </div>
      <div>
        <strong>Account No.:</strong> 0440-0981-002027-01-4
      </div>
      <div>
        <strong>IBAN:</strong> PK12BAHL0440098100202701
      </div>
    </div>
  );
}

function ToBlock({ c }: { c: any }) {
  return (
    <div style={{ margin: "10pt 0" }}>
      <div>
        <strong>To:</strong>{" "}
        <Highlight>
          {c.title} {c.name}
        </Highlight>{" "}
        {c.father && <Highlight>{c.father}</Highlight>}
      </div>
      <div>
        <strong>CNIC:</strong> <Highlight>{c.cnic}</Highlight>
      </div>
      <div>
        <strong>Address:</strong> <Highlight>{c.address}</Highlight>
      </div>
    </div>
  );
}

function Signature({ name = "Authorized Signatory", entity }: { name?: string; entity?: string }) {
  return (
    <div style={{ marginTop: "30pt" }}>
      <div>For and on behalf of</div>
      <div>
        <strong>{entity || "Precise Realtors & Builders (Pvt.) Ltd."}</strong>
      </div>
      <div style={{ marginTop: "40pt", borderTop: "1pt solid #000", width: "60%" }} />
      <div style={{ fontSize: "10pt", marginTop: "2pt" }}>{name}</div>
    </div>
  );
}

export function DocBody({ doc, c }: { doc: DocKey; c: any }) {
  if (doc === "legal") {
    return (
      <>
        <Letterhead c={c} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5pt" }}>
          <div>
            <Highlight>{c.ref}</Highlight>
          </div>
          <div>
            Date: <Highlight>{c.today}</Highlight>
          </div>
        </div>
        <div
          style={{
            textAlign: "center",
            fontWeight: 700,
            fontSize: "13pt",
            textDecoration: "underline",
            margin: "16pt 0 12pt",
          }}
        >
          LEGAL NOTICE
        </div>
        <ToBlock c={c} />
        <p>
          <strong>Subject:</strong> Show Cause Notice for Non-Payment of Installments —{" "}
          <Highlight>
            {c.unitType} No. {c.unitNo}
          </Highlight>
          , <Highlight>{c.project}</Highlight>
        </p>
        <p>
          Dear{" "}
          <Highlight>
            {c.title} {c.name}
          </Highlight>
          ,
        </p>
        <p>
          This is to formally notify you, as per the records of Precise Realtors and Builders Pvt.
          Ltd., that despite repeated reminders, you have failed to clear the outstanding
          installments against{" "}
          <Highlight>
            {c.unitType} No. {c.unitNo}
          </Highlight>
          , {c.projectAddress}. Such continued default is a material breach of the booking.
        </p>
        <p>
          You are hereby given a final opportunity to clear your outstanding dues as per the
          following instructions:
        </p>
        <p>
          <strong>Required Action:</strong>
        </p>
        <ol style={{ paddingLeft: "20pt" }}>
          <li>
            Pay the outstanding amount of <Highlight>{c.overdueAmtFmt}</Highlight> (
            <Highlight>{c.overdueWords}</Highlight>) within fifteen (15) days into the Company's
            designated account:
            <BankBlock />
          </li>
          <li>Provide a written explanation justifying the delay within the same period.</li>
          <li>
            Submit proof of payment via email to {c.projectEmail} and WhatsApp at +92 344 5533767.
          </li>
        </ol>
        <p>
          <strong>Consequences of Non-Compliance:</strong>
        </p>
        <p>
          If full payment is not received within the stipulated fifteen (15) days (by{" "}
          <Highlight>{c.deadline}</Highlight>), your allotment of{" "}
          <Highlight>
            {c.unitType} No. {c.unitNo}
          </Highlight>{" "}
          shall be cancelled without further notice. Precise Realtors and Builders Pvt. Ltd. shall
          be entitled to resell the {c.unitType} to another buyer. Any amounts previously paid shall
          be subject to deductions as per company policy, and no further claims shall be
          entertained.
        </p>
        <p>This is the final and binding notice. No extension of time shall be granted.</p>
        <p>
          <strong>Overdue Installments Detail:</strong>
        </p>
        <OverdueTable rows={c.overdueRows} />
        <Signature />
        <p style={{ fontSize: "10pt", marginTop: "12pt" }}>
          This notice is being served through registered courier and additionally forwarded to your
          WhatsApp number for record purposes.
        </p>
        <Footer c={c} />
      </>
    );
  }

  if (doc === "final") {
    return (
      <>
        <Letterhead c={c} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5pt" }}>
          <div>
            <Highlight>{c.ref}</Highlight>
          </div>
          <div>
            DATE: <Highlight>{c.today}</Highlight>
          </div>
        </div>
        <div
          style={{
            textAlign: "center",
            fontWeight: 700,
            fontSize: "13pt",
            textDecoration: "underline",
            margin: "16pt 0 12pt",
          }}
        >
          FINAL LEGAL NOTICE
        </div>
        <ToBlock c={c} />
        <p>
          <strong>Subject:</strong> Final Legal Notice for Non-Payment of Installments —{" "}
          <Highlight>
            {c.unitType} No. {c.unitNo}
          </Highlight>
          , <Highlight>{c.project}</Highlight>
        </p>
        <p>
          This Final Legal Notice is hereby issued on behalf of Precise Realtors and Builders Pvt.
          Ltd.
        </p>
        <p>
          You were previously served with a legal notice dated <Highlight>{c.prev1}</Highlight>{" "}
          regarding your persistent failure to clear outstanding installments in respect of{" "}
          <Highlight>
            {c.unitType} No. {c.unitNo}
          </Highlight>
          , {c.projectShortAddr}. Despite lawful service, you have neither responded nor made
          payment and continue to remain in willful default.
        </p>
        <p>
          Your conduct constitutes a material and continuing breach of the Booking Agreement
          executed with the Company.
        </p>
        <p>
          You are hereby called upon, for the final and last time, to deposit the outstanding amount
          of <Highlight>{c.overdueAmtFmt}</Highlight> (<Highlight>{c.overdueWords}</Highlight>)
          within ten (10) days from receipt of this notice (by <Highlight>{c.deadline}</Highlight>)
          into the Company's designated account:
        </p>
        <BankBlock />
        <p>Email: {c.projectEmail} · WhatsApp: +92 344 5533767</p>
        <p>
          Failing compliance, and strictly in accordance with the Booking Agreement, the Company
          shall without further notice be entitled to:
        </p>
        <ol style={{ paddingLeft: "20pt" }}>
          <li>
            Cancel your booking/allotment of{" "}
            <Highlight>
              {c.unitType} No. {c.unitNo}
            </Highlight>{" "}
            automatically.
          </li>
          <li>Resell or re-allot the {c.unitType} to any third party at its discretion.</li>
          <li>
            Deduct twenty percent (20%) of the total unit price upon third-party sale towards
            cancellation charges, expenses, and damages.
          </li>
          <li>
            Refund any remaining balance, if applicable, only after resale, subject to verification
            and Company policy.
          </li>
          <li>
            Treat you as having no right, title, interest, or claim whatsoever in the {c.unitType};
            and
          </li>
          <li>
            Initiate appropriate civil and/or criminal proceedings at your risk as to cost and
            consequences, without prejudice to other remedies.
          </li>
        </ol>
        <p>
          This notice is final, binding, and conclusive. No extension, waiver, or concession shall
          be granted.
        </p>
        <OverdueTable rows={c.overdueRows} />
        <Signature />
        <p style={{ fontSize: "10pt", marginTop: "12pt" }}>
          This notice is being served through registered courier and simultaneously transmitted via
          WhatsApp for due service, record, and evidentiary purposes.
        </p>
        <Footer c={c} />
      </>
    );
  }

  if (doc === "final_cancel") {
    return (
      <>
        <Letterhead c={c} />
        <div style={{ textAlign: "right", fontSize: "10.5pt" }}>
          Date: <Highlight>{c.today}</Highlight>
        </div>
        <div
          style={{
            textAlign: "center",
            fontWeight: 700,
            fontSize: "13pt",
            textDecoration: "underline",
            margin: "12pt 0 4pt",
          }}
        >
          FINAL LEGAL NOTICE
        </div>
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: "11pt", margin: "0 0 12pt" }}>
          (CANCELLATION, TERMINATION OF RIGHTS &amp; FINAL DEMAND)
        </div>
        <ToBlock c={c} />
        <p>
          <strong>SUBJECT:</strong> FINAL NOTICE — CANCELLATION OF BOOKING &amp; TERMINATION OF
          RIGHTS DUE TO PERSISTENT DEFAULT —{" "}
          <Highlight>
            {c.unitType} {c.unitNo}
          </Highlight>
          , {c.projectShortAddr.toUpperCase()}
        </p>
        <p>
          This Final Legal Notice is issued on behalf of PRECISE REALTORS &amp; BUILDERS (PVT.) LTD.
          in continuation of earlier legal notices duly served upon you, including the notice dated{" "}
          <Highlight>{c.prev1}</Highlight> and the Final Legal Notice dated{" "}
          <Highlight>{c.prev2}</Highlight>, whereby you were called upon to clear your outstanding
          liability.
        </p>
        <p>
          Under the Agreement to Sell dated <Highlight>{c.contractDate}</Highlight>, you purchased{" "}
          <Highlight>
            {c.unitType} No. {c.unitNo}
          </Highlight>{" "}
          (approximately <Highlight>{c.size}</Highlight> sq. ft.) in {c.projectAddressFull}, and
          were obligated to pay all installments as per the agreed payment schedule.
        </p>
        <p>
          As per Company records, the outstanding amount payable by you is{" "}
          <Highlight>{c.overdueAmtFmt}</Highlight> (<Highlight>{c.overdueWords}</Highlight>).
        </p>
        <p>
          Despite repeated notices, reminders, and sufficient opportunity, you have willfully failed
          to discharge your contractual obligations.
        </p>
        <p>
          <strong>FINAL AND LAST OPPORTUNITY</strong>
        </p>
        <p>
          You are hereby granted a final, strict, and non-extendable period of ten (10) days from{" "}
          <Highlight>{c.today}</Highlight> (by <Highlight>{c.deadline}</Highlight>) to:
        </p>
        <ol style={{ paddingLeft: "20pt" }}>
          <li>
            Pay the entire outstanding amount of <Highlight>{c.overdueAmtFmt}</Highlight> into the
            Company's designated account:
            <BankBlock />
          </li>
          <li>Submit proof of payment via WhatsApp at +92 344 5533767.</li>
        </ol>
        <p>
          <strong>CONSEQUENCES OF DEFAULT</strong>
        </p>
        <p>Take Final Notice That upon your failure to comply within the stipulated period:</p>
        <ul style={{ paddingLeft: "20pt" }}>
          <li>
            Your booking/allotment shall be cancelled automatically, without any further notice or
            correspondence.
          </li>
          <li>
            You shall cease to have any right, title, interest, claim, or lien whatsoever in respect
            of the said {c.unitType}.
          </li>
          <li>
            The Company shall be fully and absolutely entitled to resell, re-allot, transfer, or
            otherwise dispose of the said property to any third party, at its sole discretion,
            without any reference to you.
          </li>
          <li>
            Any amounts previously paid by you shall be adjusted, forfeited, and/or dealt with
            strictly in accordance with the terms of the Agreement, including recovery of losses,
            damages, and costs.
          </li>
          <li>
            The Company shall be at liberty of initiating appropriate civil and/or criminal
            proceedings, including but not limited to action under applicable laws, entirely at your
            risk as to cost and consequences.
          </li>
        </ul>
        <p>
          This notice is issued without prejudice to all rights, remedies, and claims available to
          the Company under the Agreement and applicable law.
        </p>
        <p>
          This Final Notice is being served through registered courier and electronic means
          (including WhatsApp) for proper service, record, and evidentiary purposes.
        </p>
        <Signature />
        <Footer c={c} />
      </>
    );
  }

  // cancellation
  return (
    <>
      <Letterhead variant="precise" c={c} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5pt" }}>
        <div>
          <Highlight>{c.ref}</Highlight>
        </div>
        <div>
          Date: <Highlight>{c.today}</Highlight>
        </div>
      </div>
      <div
        style={{
          textAlign: "center",
          fontWeight: 700,
          fontSize: "13pt",
          textDecoration: "underline",
          margin: "16pt 0 12pt",
        }}
      >
        FINAL CANCELLATION NOTICE
      </div>
      <ToBlock c={c} />
      <p>
        <strong>Subject:</strong> Cancellation of Booking / Allotment of{" "}
        <Highlight>
          {c.unitType} No. {c.unitNo}
        </Highlight>
        , {c.project}
      </p>
      <p>
        Dear{" "}
        <Highlight>
          {c.title} {c.name}
        </Highlight>
        ,
      </p>
      <p>
        This is to formally notify you that despite service of previous notices, including the Legal
        Notice dated <Highlight>{c.prev1}</Highlight> and Final Legal Notice dated{" "}
        <Highlight>{c.prev2}</Highlight>, you have failed to clear the outstanding amount of{" "}
        <Highlight>{c.overdueAmtFmt}</Highlight> against{" "}
        <Highlight>
          {c.unitType} No. {c.unitNo}
        </Highlight>
        , {c.projectAddress}.
      </p>
      <p>
        Your continued default constitutes a material breach of the booking/allotment terms.
        Therefore, Precise Realtors &amp; Builders (Pvt.) Ltd. hereby cancels your booking/allotment
        of{" "}
        <Highlight>
          {c.unitType} No. {c.unitNo}
        </Highlight>{" "}
        with immediate effect.
      </p>
      <p>
        Consequently, you shall have no right, title, interest, lien, claim, possession claim, or
        demand in respect of the said {c.unitType}. The Company is entitled to resell/re-allot the{" "}
        {c.unitType} to any third party and to deduct 20% of the total unit price, along with all
        outstanding dues, damages, costs, charges, expenses, and any other lawful deductions as per
        agreement/company policy.
      </p>
      <p>
        Any remaining balance, if legally payable, shall be considered only after
        resale/re-allotment and final reconciliation of accounts. Any payment made after this notice
        shall not revive the booking unless expressly accepted in writing by the Company through an
        authorized signatory.
      </p>
      <p>
        This cancellation is final, binding, conclusive, and without prejudice to all legal rights
        and remedies of the Company.
      </p>
      <p>
        <strong>Mode of Service:</strong> This notice is being served through TCS courier and also
        forwarded through WhatsApp for record and legal purposes.
      </p>
      <div style={{ margin: "10pt 0" }}>
        <div>TCS Tracking No.: ____________________</div>
        <div>WhatsApp No.: +92 344 5533767</div>
      </div>
      <Signature />
      <Footer variant="precise" c={c} />
    </>
  );
}

function PaymentHistoryCard({
  bookingId,
  doc,
}: {
  bookingId: string;
  doc: { slug: string; title: string; description: string; icon: any };
}) {
  const [open, setOpen] = useState(false);
  const Icon = doc.icon;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group rounded-lg border p-3 hover:border-primary hover:bg-primary/5 transition flex items-start gap-3 text-left"
      >
        <Icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{doc.title}</div>
          <div className="text-[11px] text-muted-foreground">{doc.description}</div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 mt-1" />
      </button>
      {open && <PaymentHistoryDialog bookingId={bookingId} open={open} onOpenChange={setOpen} />}
    </>
  );
}

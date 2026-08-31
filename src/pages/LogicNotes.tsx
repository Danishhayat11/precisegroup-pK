import { PageHeader } from "@/components/PageHeader";

const rules = [
  {
    t: "ID generation",
    b: [
      "Booking: BK-{ProjectCode}-{00001}",
      "Receipt: RC-{000001}",
      "Ledger: LG-{000001}",
      "Client: CL-{00001}",
      "Unit: {ProjectCode}-{UnitTypeCode}-{UnitNo}",
    ],
  },
  {
    t: "Safe-cash logic",
    b: [
      "If payment mode = Adjustment OR account = Adjustment Account OR head includes 'Adjustment' → safe_cash_amount = 0",
      "Bank/cash totals use only safe_cash_amount",
      "Adjustment credit reduces client balance but never increases cash",
    ],
  },
  {
    t: "Installment status",
    b: [
      "remaining_due = max(due_amount − paid_amount, 0)",
      "If remaining_due ≤ 0 → PAID",
      "Else if paid_amount > 0 and remaining_due > 0 → PARTIAL",
      "Else if due_date < today AND row is not Down Payment / Possession → OVERDUE",
      "Else → PENDING",
      "days_overdue = today − due_date (only when overdue)",
    ],
  },
  {
    t: "Remaining balance formula",
    b: ["remaining = sold_value − down_payment − adjustment_credit − cash_received_to_date"],
  },
  {
    t: "Risk level",
    b: [
      "HIGH: 3+ overdue installments",
      "MEDIUM: 1–2 overdue OR payment-plan mismatch",
      "LOW: otherwise",
    ],
  },
  {
    t: "Adjustment loss/gain",
    b: [
      "company_loss_gain = approved_value − realized_value",
      "Positive → Loss, Negative → Gain, Zero → No Loss / No Gain",
    ],
  },
  {
    t: "Duplicate unit",
    b: [
      "Two active bookings on the same unit do not block save — they raise a Duplicate Unit warning surfaced on the Units page and the booking detail.",
    ],
  },
  {
    t: "Role permissions",
    b: [
      "Admin: full access incl. delete & settings",
      "Manager: create/edit operational data",
      "Staff: add/edit non-destructive",
      "Viewer: read only",
    ],
  },
];

export default function LogicNotes() {
  return (
    <div>
      <PageHeader
        title="Admin · Logic Notes"
        description="Canonical rules powering the ERP. Edit only with admin approval; changes are audited."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rules.map((r) => (
          <div key={r.t} className="card-elevated p-5">
            <div className="text-sm font-semibold mb-2">{r.t}</div>
            <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside marker:text-primary">
              {r.b.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

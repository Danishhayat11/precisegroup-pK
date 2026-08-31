/**
 * Long-item-name stress test for the receipt print pipeline.
 *
 * Renders a receipt with many rows that intentionally contain very long
 * item names / descriptions, then opens the shared PrintPreviewModal in
 * `react` mode with `docType="receipt"` so the same page-break, wrapping
 * and totals-anchor CSS applied to real receipts is exercised here.
 *
 * Use the toolbar controls to switch paper size (A4 / Letter) and
 * orientation (portrait / landscape) — or the modal's own Settings —
 * and confirm the subtotal / tax / grand-total block never orphans
 * onto a new page ahead of the last item row.
 *
 * Route: /test-long-receipt?rows=40
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import PrintPreviewModal from "@/components/PrintPreviewModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtPKR } from "@/lib/format";

const LONG_NAMES = [
  "Plot Balance Installment — Precise Heights Tower B, Corner Unit facing Main Boulevard (extended description with clause references, buyer notes, and reconciliation remarks continuing well past the natural column width)",
  "Development Charges — Category A Premium Plot including infrastructure levy, sewage line contribution, boundary wall reinforcement surcharge, and phase-2 utilities allocation adjustment",
  "Possession Fee — Handover Cycle 2026-Q3, includes final snag-list rectification, key-handover ceremony processing, and utilities-connection facilitation surcharge as per allotment schedule",
  "Late Payment Surcharge — Compounded across overdue installments 12, 13, 14 and 15 with grace-window reversal per policy P-2024-03 (see plan restructure note dated 14-Mar-2026)",
  "Adjustment — Reversal of duplicate transfer credit posted against ledger head EXTRA_WORKS on 03-Feb-2026 with cross-reference to remittance MA-00184 and note thread #7821",
  "Utility Connection — Sui Gas, WAPDA, and municipal water main tap-in surcharge for corner unit with dual-frontage servicing requirement (approved variation)",
  "Legal & Documentation — Sub-registrar fees, stamp duty, mutation charges, and internal transfer processing for beneficiary change dated 21-Apr-2026",
  "Extra Works — Bay-window extension, upgraded flooring in master suite, and premium sanitary fittings variation approved by client on 08-May-2026",
];

function LongReceiptTest() {
  const search = Route.useSearch();
  const [rows, setRows] = useState<number>(search.rows ?? 40);
  const [open, setOpen] = useState(false);

  const items = useMemo(() => {
    return Array.from({ length: rows }, (_, i) => ({
      idx: i + 1,
      name: LONG_NAMES[i % LONG_NAMES.length],
      qty: 1,
      rate: 12345 + i * 137,
      amount: 12345 + i * 137,
    }));
  }, [rows]);

  const subtotal = items.reduce((s, r) => s + r.amount, 0);
  const tax = Math.round(subtotal * 0.05);
  const grand = subtotal + tax;

  const fmt = (n: number) => "PKR " + fmtPKR(n);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Long-item-name receipt stress test</h1>
        <p className="text-sm text-muted-foreground">
          Open the print preview, then switch paper (A4 / Letter) and orientation via the toolbar.
          Verify the subtotal / tax / grand-total row stays glued to the last item row on every page
          combination.
        </p>
      </div>

      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="rows" className="text-xs">
            Item rows
          </Label>
          <Input
            id="rows"
            type="number"
            min={1}
            max={200}
            value={rows}
            onChange={(e) => setRows(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
            className="h-8 w-24 text-sm"
          />
        </div>
        <Button onClick={() => setOpen(true)}>Open print preview</Button>
      </div>

      <PrintPreviewModal
        open={open}
        onOpenChange={setOpen}
        title={`Long-Item Receipt Test — ${rows} rows`}
        docType="receipt"
        mode="react"
      >
        <div className="pp-receipt" style={{ fontFamily: "Times New Roman, serif", color: "#111" }}>
          <div
            className="pp-hero"
            style={{ borderBottom: "2pt solid #1B2B4B", paddingBottom: 8, marginBottom: 12 }}
          >
            <div style={{ fontSize: "16pt", fontWeight: 700, color: "#1B2B4B" }}>
              Payment Receipt (Test)
            </div>
            <div style={{ fontSize: "10pt", color: "#555" }}>
              Long-item-name pagination test — verifies totals never orphan.
            </div>
          </div>

          <div
            className="pp-details"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              marginBottom: 10,
              fontSize: "10.5pt",
            }}
          >
            <div>
              <strong>Client:</strong> Test Buyer With A Reasonably Long Name Ltd.
            </div>
            <div>
              <strong>Receipt No:</strong> TEST-LONG-0001
            </div>
            <div>
              <strong>Unit:</strong> Precise Heights — Tower B — Unit 12-B
            </div>
            <div>
              <strong>Date:</strong> 02-Jul-2026
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10.5pt" }}>
            <colgroup>
              <col style={{ width: "8mm" }} />
              <col />
              <col style={{ width: "14mm" }} />
              <col style={{ width: "26mm" }} />
              <col style={{ width: "30mm" }} />
            </colgroup>
            <thead>
              <tr style={{ background: "#F3F4F6", borderBottom: "1pt solid #1B2B4B" }}>
                <th style={{ textAlign: "left", padding: "5pt 6pt" }}>#</th>
                <th style={{ textAlign: "left", padding: "5pt 6pt" }}>Item / Description</th>
                <th className="pp-num" data-num style={{ padding: "5pt 6pt" }}>
                  Qty
                </th>
                <th className="pp-num" data-num style={{ padding: "5pt 6pt" }}>
                  Rate
                </th>
                <th className="pp-num" data-num style={{ padding: "5pt 6pt" }}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.idx} style={{ borderBottom: "0.5pt solid #E5E7EB" }}>
                  <td style={{ padding: "4pt 6pt" }}>{r.idx}</td>
                  <td style={{ padding: "4pt 6pt" }}>{r.name}</td>
                  <td className="pp-num" data-num style={{ padding: "4pt 6pt" }}>
                    {r.qty}
                  </td>
                  <td className="pp-num" data-num style={{ padding: "4pt 6pt" }}>
                    {fmt(r.rate)}
                  </td>
                  <td className="pp-num" data-num style={{ padding: "4pt 6pt" }}>
                    {fmt(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot data-totals>
              <tr data-totals-row className="pp-subtotal">
                <td colSpan={4} style={{ padding: "5pt 6pt", textAlign: "right", fontWeight: 600 }}>
                  Subtotal
                </td>
                <td className="pp-num" data-num style={{ padding: "5pt 6pt", fontWeight: 600 }}>
                  {fmt(subtotal)}
                </td>
              </tr>
              <tr data-totals-row className="pp-tax">
                <td colSpan={4} style={{ padding: "5pt 6pt", textAlign: "right" }}>
                  Tax (5%)
                </td>
                <td className="pp-num" data-num style={{ padding: "5pt 6pt" }}>
                  {fmt(tax)}
                </td>
              </tr>
              <tr
                data-totals-row
                className="pp-grand-total"
                style={{ borderTop: "1.5pt solid #1B2B4B" }}
              >
                <td
                  colSpan={4}
                  style={{ padding: "6pt", textAlign: "right", fontWeight: 700, color: "#1B2B4B" }}
                >
                  Grand Total
                </td>
                <td
                  className="pp-num"
                  data-num
                  style={{ padding: "6pt", fontWeight: 700, color: "#1B2B4B" }}
                >
                  {fmt(grand)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div
            className="pp-signatures"
            style={{
              marginTop: 24,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 32,
              fontSize: "10pt",
            }}
          >
            <div style={{ borderTop: "0.5pt solid #333", paddingTop: 4 }}>Authorized Signature</div>
            <div style={{ borderTop: "0.5pt solid #333", paddingTop: 4 }}>Client Signature</div>
          </div>

          <div
            className="pp-footer"
            style={{ marginTop: 16, fontSize: "9pt", color: "#666", textAlign: "center" }}
          >
            Test document — Precise Group ERP long-item-name pagination harness.
          </div>
        </div>
      </PrintPreviewModal>
    </div>
  );
}

export const Route = createFileRoute("/test-long-receipt")({
  validateSearch: (s: Record<string, unknown>) => ({
    rows:
      typeof s.rows === "number"
        ? s.rows
        : typeof s.rows === "string"
          ? parseInt(s.rows) || undefined
          : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Long Receipt Test — Internal" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "googlebot", content: "noindex, nofollow" },
    ],
  }),
  component: LongReceiptTest,
});

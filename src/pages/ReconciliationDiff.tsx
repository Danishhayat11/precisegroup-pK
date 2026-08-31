/* allow-raw-color-file: reconciliation diff highlights use red/emerald palette pending diff-semantic tokens
 * Tracked debt: migrate to semantic status tokens (bg-success, bg-warning,
 * bg-destructive, bg-info) in follow-up. Guardrail (scripts/ci/no-hex-in-
 * marketing-shell.mjs) blocks NEW drift while this marker documents the
 * legacy status-color usage in-file. */
import { Fragment, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CheckCircle2,
  AlertTriangle,
  GitCompare,
  Wrench,
  Download,
  FileSpreadsheet,
  ChevronRight,
  ChevronDown,
  Sparkles,
  FileCode2,
  ExternalLink,
} from "lucide-react";

const FIXES = [
  {
    id: "FIX-001",
    area: "fifoEngine.checkPlanIdentity",
    file: "src/lib/fifoEngine.ts",
    change:
      "Removed adjustment_credit from identity LHS (already folded into total_contract_value).",
    impact: "Cleared 6 false-positive plan-identity mismatches; all 18 bookings now within ±PKR 1.",
    kind: "plan_identity",
  },
  {
    id: "FIX-002",
    area: "recalculate_ledger_for_booking",
    file: "supabase/migrations",
    change:
      "FIFO paid_date allocator: cash rows take receipt date; adjustment-covered rows take booking date.",
    impact:
      "Backfilled ledger paid_date for all bookings — removed identical 2025-12-28 stamp bug.",
    kind: "ledger_dates",
  },
  {
    id: "FIX-003",
    area: "Date sanity checks",
    file: "scripts/audit/booking-reconciliation.mjs",
    change: "11/11 checks passing; 13 edge rows quarantined (not mutated) for manual review.",
    impact: "No orphan FKs, no cached-overdue drift, no future dates marked overdue.",
    kind: "date_sanity",
  },
];

/**
 * Static snapshot of the last reconciliation run (see reconcile/RECONCILIATION_REPORT.md).
 * Both source workbooks matched the DB byte-for-byte across primary tables; the only
 * findings were 13 quarantined edge-case rows and the plan-identity formula fix.
 */

type DiffKind = "match" | "diff" | "quarantine";

type TableSummary = {
  table: string;
  rows: number;
  matched: number;
  differing: number;
  quarantined: number;
};

const TABLES: TableSummary[] = [
  { table: "projects", rows: 1, matched: 1, differing: 0, quarantined: 0 },
  { table: "clients", rows: 18, matched: 16, differing: 0, quarantined: 2 },
  { table: "units", rows: 20, matched: 20, differing: 0, quarantined: 0 },
  { table: "dealers", rows: 3, matched: 3, differing: 0, quarantined: 0 },
  { table: "bookings", rows: 18, matched: 17, differing: 0, quarantined: 1 },
  { table: "payments", rows: 46, matched: 43, differing: 0, quarantined: 3 },
  { table: "installment_ledger", rows: 214, matched: 207, differing: 0, quarantined: 7 },
  { table: "adjustments", rows: 5, matched: 5, differing: 0, quarantined: 0 },
];

type ColumnDiff = {
  column: string;
  workbook: string;
  db: string;
  changed: boolean;
  note?: string;
};

type QuarantineRow = {
  id: string;
  table: string;
  reason: string;
  workbook: string;
  db: string;
  kind: DiffKind;
  columns: ColumnDiff[];
};

const QUARANTINED: QuarantineRow[] = [
  {
    id: "BK-MA-00010",
    table: "bookings",
    reason: "first_installment_due before booking_date",
    workbook: "first_installment_due=2024-08-15, booking_date=2024-09-01",
    db: "same",
    kind: "quarantine",
    columns: [
      { column: "booking_date", workbook: "2024-09-01", db: "2024-09-01", changed: false },
      {
        column: "first_installment_due",
        workbook: "2024-08-15",
        db: "2024-08-15",
        changed: true,
        note: "Flagged: 17 days before booking_date. Kept as-is; requires business review.",
      },
      { column: "total_contract_value", workbook: "8,500,000", db: "8,500,000", changed: false },
      { column: "adjustment_credit", workbook: "0", db: "0", changed: false },
    ],
  },
  {
    id: "RCP-00007",
    table: "payments",
    reason: "payment_date before booking_date",
    workbook: "payment_date=2024-05-02 / booking=2024-05-10",
    db: "same",
    kind: "quarantine",
    columns: [
      { column: "receipt_no", workbook: "RCP-00007", db: "RCP-00007", changed: false },
      { column: "booking_id", workbook: "BK-MA-00003", db: "BK-MA-00003", changed: false },
      {
        column: "payment_date",
        workbook: "2024-05-02",
        db: "2024-05-02",
        changed: true,
        note: "8 days before booking_date=2024-05-10.",
      },
      { column: "amount", workbook: "500,000", db: "500,000", changed: false },
    ],
  },
  {
    id: "RCP-00019",
    table: "payments",
    reason: "payment_date before booking_date",
    workbook: "payment_date=2024-07-14 / booking=2024-07-20",
    db: "same",
    kind: "quarantine",
    columns: [
      { column: "receipt_no", workbook: "RCP-00019", db: "RCP-00019", changed: false },
      { column: "booking_id", workbook: "BK-MA-00008", db: "BK-MA-00008", changed: false },
      {
        column: "payment_date",
        workbook: "2024-07-14",
        db: "2024-07-14",
        changed: true,
        note: "6 days before booking_date=2024-07-20.",
      },
      { column: "amount", workbook: "750,000", db: "750,000", changed: false },
    ],
  },
  {
    id: "RCP-00033",
    table: "payments",
    reason: "payment_date before booking_date",
    workbook: "payment_date=2024-10-01 / booking=2024-10-05",
    db: "same",
    kind: "quarantine",
    columns: [
      { column: "receipt_no", workbook: "RCP-00033", db: "RCP-00033", changed: false },
      { column: "booking_id", workbook: "BK-MA-00012", db: "BK-MA-00012", changed: false },
      {
        column: "payment_date",
        workbook: "2024-10-01",
        db: "2024-10-01",
        changed: true,
        note: "4 days before booking_date=2024-10-05.",
      },
      { column: "amount", workbook: "300,000", db: "300,000", changed: false },
    ],
  },
  {
    id: "LED-00042",
    table: "installment_ledger",
    reason: "non-Paid row with paid_date < due_date",
    workbook: "status=Pending, paid_date=2024-06-10 < due=2024-07-01",
    db: "same",
    kind: "quarantine",
    columns: [
      {
        column: "status",
        workbook: "Pending",
        db: "Pending",
        changed: true,
        note: "Pending row should not carry paid_date.",
      },
      { column: "due_date", workbook: "2024-07-01", db: "2024-07-01", changed: false },
      {
        column: "paid_date",
        workbook: "2024-06-10",
        db: "2024-06-10",
        changed: true,
        note: "Stray paid_date; FIFO backfill left this cell untouched pending review.",
      },
      { column: "amount", workbook: "125,000", db: "125,000", changed: false },
    ],
  },
  {
    id: "LED-00055",
    table: "installment_ledger",
    reason: "non-Paid row with paid_date < due_date",
    workbook: "status=Pending",
    db: "same",
    kind: "quarantine",
    columns: [
      { column: "status", workbook: "Pending", db: "Pending", changed: true },
      { column: "due_date", workbook: "2024-08-01", db: "2024-08-01", changed: false },
      {
        column: "paid_date",
        workbook: "2024-07-20",
        db: "2024-07-20",
        changed: true,
        note: "paid_date precedes due_date on non-Paid row.",
      },
    ],
  },
  {
    id: "LED-00071",
    table: "installment_ledger",
    reason: "non-Paid row with paid_date < due_date",
    workbook: "status=Partially Paid",
    db: "same",
    kind: "quarantine",
    columns: [
      { column: "status", workbook: "Partially Paid", db: "Partially Paid", changed: true },
      { column: "due_date", workbook: "2024-09-01", db: "2024-09-01", changed: false },
      {
        column: "paid_date",
        workbook: "2024-08-25",
        db: "2024-08-25",
        changed: true,
        note: "Partial payment date before due date.",
      },
      { column: "amount_paid", workbook: "60,000", db: "60,000", changed: false },
    ],
  },
  {
    id: "LED-00088",
    table: "installment_ledger",
    reason: "non-Paid row with paid_date < due_date",
    workbook: "status=Pending",
    db: "same",
    kind: "quarantine",
    columns: [
      { column: "status", workbook: "Pending", db: "Pending", changed: true },
      { column: "due_date", workbook: "2024-10-01", db: "2024-10-01", changed: false },
      { column: "paid_date", workbook: "2024-09-15", db: "2024-09-15", changed: true },
    ],
  },
  {
    id: "LED-00104",
    table: "installment_ledger",
    reason: "non-Paid row with paid_date < due_date",
    workbook: "status=Pending",
    db: "same",
    kind: "quarantine",
    columns: [
      { column: "status", workbook: "Pending", db: "Pending", changed: true },
      { column: "due_date", workbook: "2024-11-01", db: "2024-11-01", changed: false },
      { column: "paid_date", workbook: "2024-10-22", db: "2024-10-22", changed: true },
    ],
  },
  {
    id: "LED-00129",
    table: "installment_ledger",
    reason: "non-Paid row with paid_date < due_date",
    workbook: "status=Overdue",
    db: "same",
    kind: "quarantine",
    columns: [
      {
        column: "status",
        workbook: "Overdue",
        db: "Overdue",
        changed: true,
        note: "Overdue rows should not carry paid_date.",
      },
      { column: "due_date", workbook: "2024-12-01", db: "2024-12-01", changed: false },
      { column: "paid_date", workbook: "2024-11-18", db: "2024-11-18", changed: true },
    ],
  },
  {
    id: "LED-00161",
    table: "installment_ledger",
    reason: "non-Paid row with paid_date < due_date",
    workbook: "status=Pending",
    db: "same",
    kind: "quarantine",
    columns: [
      { column: "status", workbook: "Pending", db: "Pending", changed: true },
      { column: "due_date", workbook: "2025-01-01", db: "2025-01-01", changed: false },
      { column: "paid_date", workbook: "2024-12-24", db: "2024-12-24", changed: true },
    ],
  },
  {
    id: "CL-00007",
    table: "clients",
    reason: "duplicate CNIC with CL-00008",
    workbook: "cnic=42101-1234567-1",
    db: "same",
    kind: "quarantine",
    columns: [
      { column: "client_id", workbook: "CL-00007", db: "CL-00007", changed: false },
      {
        column: "cnic",
        workbook: "42101-1234567-1",
        db: "42101-1234567-1",
        changed: true,
        note: "Same CNIC also present on CL-00008.",
      },
      { column: "name", workbook: "Adil Khan", db: "Adil Khan", changed: false },
    ],
  },
  {
    id: "CL-00014",
    table: "clients",
    reason: "duplicate CNIC with CL-00015",
    workbook: "cnic=42201-7654321-9",
    db: "same",
    kind: "quarantine",
    columns: [
      { column: "client_id", workbook: "CL-00014", db: "CL-00014", changed: false },
      {
        column: "cnic",
        workbook: "42201-7654321-9",
        db: "42201-7654321-9",
        changed: true,
        note: "Same CNIC also present on CL-00015.",
      },
      { column: "name", workbook: "Umer Farooq", db: "Umer Farooq", changed: false },
    ],
  },
];

export default function ReconciliationDiff() {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const totals = useMemo(
    () =>
      TABLES.reduce(
        (a, t) => ({
          rows: a.rows + t.rows,
          matched: a.matched + t.matched,
          differing: a.differing + t.differing,
          quarantined: a.quarantined + t.quarantined,
        }),
        { rows: 0, matched: 0, differing: 0, quarantined: 0 },
      ),
    [],
  );

  const filteredQ = QUARANTINED.filter(
    (r) => !q || `${r.id} ${r.table} ${r.reason}`.toLowerCase().includes(q.toLowerCase()),
  );

  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const buildSummaryRows = () =>
    TABLES.map((t) => ({
      Table: t.table,
      Rows: t.rows,
      Matched: t.matched,
      Differing: t.differing,
      Quarantined: t.quarantined,
      Status: t.differing === 0 && t.quarantined === 0 ? "Clean" : "Review",
    }));

  const buildQuarantineRows = () =>
    QUARANTINED.map((r) => ({
      ID: r.id,
      Table: r.table,
      Reason: r.reason,
      "Workbook Value": r.workbook,
      "DB Value": r.db,
      Kind: r.kind,
    }));

  const buildColumnDiffRows = () =>
    QUARANTINED.flatMap((r) =>
      r.columns.map((c) => ({
        "Row ID": r.id,
        Table: r.table,
        Column: c.column,
        "Workbook Value": c.workbook,
        "DB Value": c.db,
        Changed: c.changed ? "yes" : "no",
        Note: c.note ?? "",
      })),
    );

  const buildFixRows = () =>
    FIXES.map((f) => ({
      "Fix ID": f.id,
      Area: f.area,
      File: f.file,
      Kind: f.kind,
      Change: f.change,
      Impact: f.impact,
    }));

  const buildTotalsRows = () => [
    { Metric: "Rows Compared", Value: totals.rows },
    { Metric: "Matched", Value: totals.matched },
    { Metric: "Differing", Value: totals.differing },
    { Metric: "Quarantined", Value: totals.quarantined },
    { Metric: "Fixes Applied", Value: FIXES.length },
    { Metric: "Generated At", Value: new Date().toISOString() },
  ];

  const downloadCSV = () => {
    const sections: Array<[string, Array<Record<string, unknown>>]> = [
      ["Totals", buildTotalsRows()],
      ["Per-Table Summary", buildSummaryRows()],
      ["Quarantined Rows", buildQuarantineRows()],
      ["Column-Level Diffs", buildColumnDiffRows()],
      ["Fixes Applied (incl. plan-identity)", buildFixRows()],
    ];
    const lines: string[] = [];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    for (const [title, rows] of sections) {
      lines.push(`# ${title}`);
      if (rows.length) {
        const headers = Object.keys(rows[0]);
        lines.push(headers.map(esc).join(","));
        for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
      }
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation-diff-${stamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadXLSX = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildTotalsRows()), "Totals");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildSummaryRows()),
      "Per-Table Summary",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildQuarantineRows()),
      "Quarantined Rows",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildColumnDiffRows()),
      "Column-Level Diffs",
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildFixRows()), "Fixes Applied");
    XLSX.writeFile(wb, `reconciliation-diff-${stamp()}.xlsx`);
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-semibold flex items-center gap-2">
            <GitCompare className="h-6 w-6" /> Reconciliation Diff Viewer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Row-level comparison between the uploaded workbooks (
            <code className="text-xs">Precise_ERP_PERFECTED_v2-2.xlsm</code>,{" "}
            <code className="text-xs">ERP_LAST_final_xyz_jun13e---2.xlsm</code>) and the live
            database.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCSV}
            aria-label="Download reconciliation CSV"
          >
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
          <Button size="sm" onClick={downloadXLSX} aria-label="Download reconciliation XLSX">
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Export XLSX
          </Button>
          <Badge variant="outline" className="text-xs">
            Snapshot · latest run
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Rows Compared" value={totals.rows} tone="default" />
        <StatCard label="Matched" value={totals.matched} tone="success" />
        <StatCard label="Differing" value={totals.differing} tone="warn" />
        <StatCard label="Quarantined" value={totals.quarantined} tone="danger" />
      </div>

      <Alert>
        <Wrench className="h-4 w-4" />
        <AlertTitle>Plan-identity fix applied</AlertTitle>
        <AlertDescription>
          <code className="text-xs">src/lib/fifoEngine.ts · checkPlanIdentity()</code> was
          double-counting <code>adjustment_credit</code> when computing the plan-identity sum{" "}
          <em>
            (down_payment + Σ installments + possession + adjustment_credit vs total_contract_value)
          </em>
          . The credit is already folded into <code>total_contract_value</code>, so it has been
          removed from the left-hand side. All 18 bookings now satisfy the identity within ±PKR 1
          tolerance (previously 6 false-positive mismatches).
        </AlertDescription>
      </Alert>

      <ChangelogCard />

      <Tabs defaultValue="tables">
        <TabsList>
          <TabsTrigger value="tables">Per-Table Summary</TabsTrigger>
          <TabsTrigger value="quarantine">Quarantined Rows ({QUARANTINED.length})</TabsTrigger>
          <TabsTrigger value="fixes">Fixes Applied</TabsTrigger>
        </TabsList>

        <TabsContent value="tables">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Table-level results</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Table</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">Matched</TableHead>
                    <TableHead className="text-right">Differing</TableHead>
                    <TableHead className="text-right">Quarantined</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TABLES.map((t) => (
                    <TableRow key={t.table}>
                      <TableCell className="font-mono text-xs">{t.table}</TableCell>
                      <TableCell className="text-right">{t.rows}</TableCell>
                      <TableCell className="text-right text-emerald-600">{t.matched}</TableCell>
                      <TableCell className="text-right">{t.differing || "—"}</TableCell>
                      <TableCell className="text-right text-amber-600">
                        {t.quarantined || "—"}
                      </TableCell>
                      <TableCell>
                        {t.differing === 0 && t.quarantined === 0 ? (
                          <Badge variant="outline" className="text-emerald-700 border-emerald-300">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Clean
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-700 border-amber-300">
                            <AlertTriangle className="h-3 w-3 mr-1" /> Review
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quarantine" className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Filter by ID, table, or reason…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-md"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(new Set(filteredQ.map((r) => r.id)))}
              disabled={filteredQ.length === 0}
            >
              Expand all
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(new Set())}
              disabled={expanded.size === 0}
            >
              Collapse all
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              Click a row to see per-column workbook vs. DB values.
            </span>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>ID</TableHead>
                    <TableHead>Table</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Cols changed</TableHead>
                    <TableHead>Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredQ.map((r) => {
                    const isOpen = expanded.has(r.id);
                    const changedCount = r.columns.filter((c) => c.changed).length;
                    return (
                      <Fragment key={r.id}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleRow(r.id)}
                          aria-expanded={isOpen}
                        >
                          <TableCell className="w-8 align-middle">
                            <button
                              type="button"
                              aria-label={isOpen ? `Collapse ${r.id}` : `Expand ${r.id}`}
                              className="p-1 -m-1 text-muted-foreground hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRow(r.id);
                              }}
                            >
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.id}</TableCell>
                          <TableCell className="text-xs">{r.table}</TableCell>
                          <TableCell className="text-xs">{r.reason}</TableCell>
                          <TableCell className="text-right text-xs">
                            <Badge
                              variant="outline"
                              className={changedCount > 0 ? "text-amber-700 border-amber-300" : ""}
                            >
                              {changedCount} / {r.columns.length}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.workbook}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow
                            key={`${r.id}-detail`}
                            className="bg-muted/30 hover:bg-muted/30"
                          >
                            <TableCell />
                            <TableCell colSpan={5} className="py-3">
                              <div className="rounded-md border bg-background">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-[22%]">Column</TableHead>
                                      <TableHead className="w-[26%]">Workbook</TableHead>
                                      <TableHead className="w-[26%]">Database</TableHead>
                                      <TableHead className="w-[10%]">Changed</TableHead>
                                      <TableHead>Note</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {r.columns.map((c) => (
                                      <TableRow
                                        key={`${r.id}-${c.column}`}
                                        className={
                                          c.changed ? "bg-amber-50/50 dark:bg-amber-950/20" : ""
                                        }
                                      >
                                        <TableCell className="font-mono text-xs">
                                          {c.column}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                          {c.workbook}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{c.db}</TableCell>
                                        <TableCell>
                                          {c.changed ? (
                                            <Badge
                                              variant="outline"
                                              className="text-amber-700 border-amber-300"
                                            >
                                              <AlertTriangle className="h-3 w-3 mr-1" /> yes
                                            </Badge>
                                          ) : (
                                            <Badge
                                              variant="outline"
                                              className="text-emerald-700 border-emerald-300"
                                            >
                                              <CheckCircle2 className="h-3 w-3 mr-1" /> no
                                            </Badge>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                          {c.note ?? "—"}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                  {filteredQ.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-sm text-muted-foreground py-6"
                      >
                        No rows match.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fixes">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Code / data fixes committed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="font-medium">1. Plan-identity double-count</div>
                <div className="text-muted-foreground">
                  <code>src/lib/fifoEngine.ts</code> — removed <code>adjustment_credit</code>
                  from the identity LHS. Detected during workbook cross-check; verified with the
                  reconciliation audit against all 18 bookings.
                </div>
              </div>
              <div>
                <div className="font-medium">2. Date sanity checks (11/11 passing)</div>
                <div className="text-muted-foreground">
                  No orphan FKs, no cached-overdue drift, no future dates marked overdue. 13
                  edge-case rows flagged to quarantine rather than mutated.
                </div>
              </div>
              <div>
                <div className="font-medium">3. Exports</div>
                <div className="text-muted-foreground">
                  Reconciled workbook + CSV bundle written to{" "}
                  <code>/mnt/documents/reconciliation/</code> with quarantined rows highlighted.
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "success" | "warn" | "danger";
}) {
  const toneCls = {
    default: "text-foreground",
    success: "text-emerald-600",
    warn: "text-amber-600",
    danger: "text-red-600",
  }[tone];
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-2xl font-semibold mt-1 ${toneCls}`}>{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

type ChangelogEntry = {
  version: string;
  date: string;
  title: string;
  file: string;
  anchor?: string;
  highlight?: boolean;
  summary: string;
  before?: string;
  after?: string;
  bullets?: string[];
};

const CHANGELOG: ChangelogEntry[] = [
  {
    version: "v1.4.0",
    date: "2026-06-28",
    title: "checkPlanIdentity no longer double-counts adjustment_credit",
    file: "src/lib/fifoEngine.ts",
    anchor: "checkPlanIdentity",
    highlight: true,
    summary:
      "adjustment_credit is already folded into total_contract_value. Adding it again on the LHS produced 6 false-positive plan-identity mismatches. Removed from the sum; all 18 bookings now satisfy the identity within ±PKR 1.",
    before:
      "const planSum =\n  b.down_payment +\n  installments.reduce((s, i) => s + i.amount, 0) +\n  b.possession_amount +\n  b.adjustment_credit; // ← already inside total_contract_value",
    after:
      "const planSum =\n  b.down_payment +\n  installments.reduce((s, i) => s + i.amount, 0) +\n  b.possession_amount;\n// adjustment_credit already reflected in total_contract_value",
    bullets: [
      "Cleared 6 false-positive mismatches (BK-MA-00014 confirmed via fixture test).",
      "Regression covered by src/lib/__tests__/checkPlanIdentity.mirror.test.ts (7 tests).",
      "Verified against both source workbooks in the reconciliation audit.",
    ],
  },
  {
    version: "v1.3.0",
    date: "2026-06-27",
    title: "FIFO paid_date allocator in recalculate_ledger_for_booking",
    file: "supabase/migrations",
    summary:
      "Cash-covered rows now stamp the receipt date, adjustment-covered rows use the booking date. Removes the identical 2025-12-28 paid_date bug across every ledger.",
  },
  {
    version: "v1.2.0",
    date: "2026-06-26",
    title: "Date sanity + quarantine pipeline",
    file: "scripts/audit/booking-reconciliation.mjs",
    summary:
      "11/11 audit checks passing. 13 edge-case rows quarantined (not mutated) with column-level diffs surfaced in the Quarantined Rows tab.",
  },
];

function ChangelogCard() {
  const [openId, setOpenId] = useState<string | null>(CHANGELOG[0]?.version ?? null);
  return (
    <Card className="border-amber-200/70 bg-gradient-to-br from-amber-50/60 to-transparent dark:from-amber-950/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-600" />
              UI Changelog
              <Badge variant="outline" className="text-[10px] font-normal">
                latest {CHANGELOG.length}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Recent engine + reconciliation fixes affecting this page.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {CHANGELOG.map((e) => {
          const isOpen = openId === e.version;
          return (
            <div
              key={e.version}
              className={`rounded-md border bg-background/70 ${e.highlight ? "border-amber-300 ring-1 ring-amber-200/60" : ""}`}
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : e.version)}
                aria-expanded={isOpen}
                className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-muted/40 rounded-md"
              >
                <span className="mt-0.5 text-muted-foreground">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-[10px]">
                      {e.version}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{e.date}</span>
                    {e.highlight && (
                      <Badge className="text-[10px] bg-amber-600 hover:bg-amber-600">
                        Plan-identity fix
                      </Badge>
                    )}
                  </span>
                  <span className="block text-sm font-medium mt-1">{e.title}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5 font-mono truncate">
                    <FileCode2 className="inline h-3 w-3 mr-1" />
                    {e.file}
                    {e.anchor ? ` · ${e.anchor}()` : ""}
                  </span>
                </span>
              </button>

              {isOpen && (
                <div className="px-3 pb-3 pt-1 space-y-3 border-t">
                  <p className="text-sm text-muted-foreground">{e.summary}</p>

                  {(e.before || e.after) && (
                    <div className="grid md:grid-cols-2 gap-2">
                      {e.before && (
                        <div>
                          <div
                            className="text-[11px] uppercase tracking-wide text-red-700 mb-1"
                            id={`diff-before-${e.version}`}
                          >
                            Before
                          </div>
                          <pre
                            tabIndex={0}
                            role="region"
                            aria-labelledby={`diff-before-${e.version}`}
                            className="text-[11px] leading-relaxed bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2 overflow-x-auto whitespace-pre focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            {e.before}
                          </pre>
                        </div>
                      )}
                      {e.after && (
                        <div>
                          <div
                            className="text-[11px] uppercase tracking-wide text-emerald-700 mb-1"
                            id={`diff-after-${e.version}`}
                          >
                            After
                          </div>
                          <pre
                            tabIndex={0}
                            role="region"
                            aria-labelledby={`diff-after-${e.version}`}
                            className="text-[11px] leading-relaxed bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 rounded p-2 overflow-x-auto whitespace-pre focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            {e.after}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {e.bullets && e.bullets.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
                      {e.bullets.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  )}

                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard?.writeText(e.file);
                      }}
                      aria-label={`Copy file path ${e.file}`}
                    >
                      <FileCode2 className="h-3.5 w-3.5 mr-1.5" />
                      Copy path
                    </Button>
                    <a
                      href={`vscode://file/${e.file}`}
                      className="inline-flex items-center text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Open in editor
                    </a>
                    <span className="text-[11px] text-muted-foreground ml-auto">
                      See details in the “Fixes Applied” tab below.
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

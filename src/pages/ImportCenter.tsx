/* allow-raw-color-file: import-preview diff rows use red/green/amber palette pending diff-semantic tokens
 * Tracked debt: migrate to semantic status tokens (bg-success, bg-warning,
 * bg-destructive, bg-info) in follow-up. Guardrail (scripts/ci/no-hex-in-
 * marketing-shell.mjs) blocks NEW drift while this marker documents the
 * legacy status-color usage in-file. */
import { useEffect, useState } from "react";
import { escapeCsvCell } from "@/lib/csv";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
  Download,
  History,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  validateSheet,
  quarantineToCsv,
  validationReportToCsv,
  buildValidationSummary,
  DATE_COLUMNS,
  type ValidationReport,
} from "@/lib/excelQuarantine";
import { buildCsvMetadataHeader } from "@/lib/csvExportMetadata";
import { CsvExportMetadataPreview } from "@/components/CsvExportMetadataPreview";
import { useCsvExportConfirm } from "@/components/CsvExportConfirmDialog";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { callRpc } from "@/integrations/supabase/approvedRpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const sheetMap = [
  { sheet: "PROJECTS_DB", module: "Projects", table: "projects" },
  { sheet: "UNITS_DB", module: "Units", table: "units" },
  { sheet: "MASTER_ENTRY", module: "Bookings + Clients", table: "bookings, clients" },
  { sheet: "PAYMENTS", module: "Payments", table: "payments" },
  { sheet: "INSTALLMENT_LEDGER", module: "Installment Ledger", table: "installment_ledger" },
  { sheet: "LOSS IN ADJUSTEMENT", module: "Adjustments", table: "adjustments" },
  { sheet: "SETTINGS", module: "Settings & dropdown lists", table: "app_settings" },
  { sheet: "DOCUMENT_CENTER", module: "Document templates", table: "documents (templates)" },
  { sheet: "REPORTS", module: "Reports", table: "(computed on the fly)" },
];

export default function ImportCenter() {
  const { requestExport: requestCsvExport, dialog: csvConfirmDialog } = useCsvExportConfirm();
  const [file, setFile] = useState<File | null>(null);

  const [fileVersion, setFileVersion] = useState<string>("");
  const [reseeding, setReseeding] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastCounts, setLastCounts] = useState<Record<string, number> | null>(null);
  const [validating, setValidating] = useState(false);
  const [reports, setReports] = useState<ValidationReport<Record<string, unknown>>[] | null>(null);
  type PerSheetEntry = {
    sheet: string;
    input: number;
    clean: number;
    quarantined: number;
    cleanPct: number;
  };
  type RuleEntry = { rule: string; field?: string | null; category?: string | null; count: number };
  type AuditRow = {
    id: string;
    created_at: string;
    actor_email: string | null;
    file_name: string;
    file_size: number | null;
    file_hash: string | null;
    file_version: string | null;
    sheets_validated: number;
    input_rows: number;
    clean_rows: number;
    quarantined_rows: number;
    per_sheet?: PerSheetEntry[] | null;
    rule_breakdown?: RuleEntry[] | null;
    notes?: string | null;
    workbook_path?: string | null;
    workbook_content_type?: string | null;
    report_path?: string | null;
  };
  const [audits, setAudits] = useState<AuditRow[] | null>(null);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const [auditFrom, setAuditFrom] = useState<string>("");
  const [auditTo, setAuditTo] = useState<string>("");
  const [exportingAudit, setExportingAudit] = useState(false);
  const [auditFileQ, setAuditFileQ] = useState("");
  const [auditHashQ, setAuditHashQ] = useState("");
  const [auditUserQ, setAuditUserQ] = useState("");

  function matchesAuditFilters(a: AuditRow): boolean {
    const file = auditFileQ.trim().toLowerCase();
    const hash = auditHashQ.trim().toLowerCase();
    const user = auditUserQ.trim().toLowerCase();
    if (
      file &&
      !(a.file_name ?? "").toLowerCase().includes(file) &&
      !(a.file_version ?? "").toLowerCase().includes(file)
    )
      return false;
    if (hash && !(a.file_hash ?? "").toLowerCase().includes(hash)) return false;
    if (user && !(a.actor_email ?? "").toLowerCase().includes(user)) return false;
    if (auditFrom) {
      if (new Date(a.created_at) < new Date(auditFrom + "T00:00:00")) return false;
    }
    if (auditTo) {
      if (new Date(a.created_at) > new Date(auditTo + "T23:59:59.999")) return false;
    }
    return true;
  }

  async function fetchAuditsForExport(): Promise<AuditRow[]> {
    let q = supabase
      .from("import_validation_audit")
      .select(
        "id,created_at,actor_email,file_name,file_size,file_hash,file_version,sheets_validated,input_rows,clean_rows,quarantined_rows,per_sheet,rule_breakdown,notes,workbook_path,workbook_content_type,report_path",
      )
      .order("created_at", { ascending: false });
    if (auditFrom) q = q.gte("created_at", new Date(auditFrom + "T00:00:00").toISOString());
    if (auditTo) q = q.lte("created_at", new Date(auditTo + "T23:59:59.999").toISOString());
    const anyTextFilter = !!(auditFileQ.trim() || auditHashQ.trim() || auditUserQ.trim());
    if (!auditFrom && !auditTo && !anyTextFilter) q = q.limit(25);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as AuditRow[]).filter(matchesAuditFilters);
  }

  function buildAuditSummaryRows(rows: AuditRow[]) {
    return rows.map((a) => ({
      When: new Date(a.created_at).toISOString().replace("T", " ").slice(0, 19),
      By: a.actor_email ?? "",
      File: a.file_name,
      "File Size (bytes)": a.file_size ?? "",
      Version: a.file_version ?? "",
      Sheets: a.sheets_validated,
      Input: a.input_rows,
      Clean: a.clean_rows,
      Quarantined: a.quarantined_rows,
      "Pass Rate %": a.input_rows > 0 ? Math.round((a.clean_rows / a.input_rows) * 1000) / 10 : 0,
      "SHA-256": a.file_hash ?? "",
      Notes: a.notes ?? "",
    }));
  }

  function toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return "";
    const headers = Object.keys(rows[0]);
    // Delegate to the shared escaper so formula-injection neutralization
    // (leading =, +, -, @, TAB, CR) stays consistent with @/lib/csv.
    return [
      headers.map((h) => escapeCsvCell(h)).join(","),
      ...rows.map((r) => headers.map((h) => escapeCsvCell(r[h])).join(",")),
    ].join("\r\n");
  }

  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function auditFilenameStub() {
    const range =
      auditFrom || auditTo ? `${auditFrom || "start"}_to_${auditTo || "latest"}` : "last25";
    const stamp = new Date().toISOString().slice(0, 10);
    return `import-audit_${range}_${stamp}`;
  }

  async function handleExportAuditsCsv() {
    setExportingAudit(true);
    try {
      const rows = await fetchAuditsForExport();
      if (rows.length === 0) {
        toast.info("No audit runs match the selected range.");
        return;
      }
      const summaryRows = buildAuditSummaryRows(rows);
      const auditColumns = Object.keys(summaryRows[0]).map((k) => ({ key: k, label: k }));
      const meta = buildCsvMetadataHeader({
        source: "Import Center — Audit Runs",
        filters: {
          File: auditFileQ.trim(),
          "SHA-256": auditHashQ.trim(),
          User: auditUserQ.trim(),
          From: auditFrom,
          To: auditTo,
        },
        sort: { key: "created_at", dir: "desc" },
        counts: { shown: rows.length },
        columns: auditColumns,
      });
      const body = toCsv(summaryRows);
      const csv = `${meta.join("\r\n")}\r\n\r\n${body}`;
      saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${auditFilenameStub()}.csv`);
      toast.success(`Exported ${rows.length} audit run${rows.length === 1 ? "" : "s"} as CSV.`);
    } catch (e) {
      toast.error(`CSV export failed: ${(e as Error).message}`);
    } finally {
      setExportingAudit(false);
    }
  }

  async function handleExportAuditsXlsx() {
    setExportingAudit(true);
    try {
      const rows = await fetchAuditsForExport();
      if (rows.length === 0) {
        toast.info("No audit runs match the selected range.");
        return;
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(buildAuditSummaryRows(rows)),
        "Runs",
      );

      const perSheet: Record<string, unknown>[] = [];
      const rules: Record<string, unknown>[] = [];
      for (const a of rows) {
        const when = new Date(a.created_at).toISOString().replace("T", " ").slice(0, 19);
        if (Array.isArray(a.per_sheet)) {
          for (const p of a.per_sheet) {
            perSheet.push({
              When: when,
              File: a.file_name,
              Version: a.file_version ?? "",
              Sheet: p.sheet,
              Input: p.input,
              Clean: p.clean,
              Quarantined: p.quarantined,
              "Pass Rate %": p.cleanPct,
            });
          }
        }
        if (Array.isArray(a.rule_breakdown)) {
          for (const r of a.rule_breakdown) {
            rules.push({
              When: when,
              File: a.file_name,
              Version: a.file_version ?? "",
              Rule: r.rule,
              Field: r.field ?? "",
              Category: r.category ?? "",
              Hits: r.count,
            });
          }
        }
      }
      if (perSheet.length)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perSheet), "Per-Sheet");
      if (rules.length)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rules), "Rule Breakdown");

      const meta = [
        {
          "Exported at": new Date().toISOString(),
          "Date range":
            auditFrom || auditTo
              ? `${auditFrom || "start"} → ${auditTo || "latest"}`
              : "Last 25 runs",
          "Total runs": rows.length,
          "Total input rows": rows.reduce((s, r) => s + r.input_rows, 0),
          "Total clean": rows.reduce((s, r) => s + r.clean_rows, 0),
          "Total quarantined": rows.reduce((s, r) => s + r.quarantined_rows, 0),
        },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), "Meta");

      const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      saveBlob(
        new Blob([out], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `${auditFilenameStub()}.xlsx`,
      );
      toast.success(`Exported ${rows.length} audit run${rows.length === 1 ? "" : "s"} as XLSX.`);
    } catch (e) {
      toast.error(`XLSX export failed: ${(e as Error).message}`);
    } finally {
      setExportingAudit(false);
    }
  }

  const SHEET_TO_TABLE: Record<string, string> = {
    MASTER_ENTRY: "bookings",
    PAYMENTS: "payments",
    INSTALLMENT_LEDGER: "installment_ledger",
    "LOSS IN ADJUSTEMENT": "adjustments",
    UNITS_DB: "units",
    PROJECTS_DB: "projects",
  };

  async function sha256Hex(buf: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function loadAudits() {
    const { data, error } = await supabase
      .from("import_validation_audit")
      .select(
        "id,created_at,actor_email,file_name,file_size,file_hash,file_version,sheets_validated,input_rows,clean_rows,quarantined_rows,per_sheet,rule_breakdown,notes,workbook_path,workbook_content_type,report_path",
      )
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      console.warn("audit load failed", error.message);
      return;
    }
    setAudits((data ?? []) as AuditRow[]);
  }

  useEffect(() => {
    loadAudits();
  }, []);

  async function handleValidate() {
    if (!file) return;
    setValidating(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const out: ValidationReport<Record<string, unknown>>[] = [];
      for (const sheetName of wb.SheetNames) {
        const table = SHEET_TO_TABLE[sheetName];
        if (!table || !(table in DATE_COLUMNS)) continue;
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
          defval: null,
        });
        out.push(validateSheet(table, rows));
      }
      setReports(out);
      const totalQ = out.reduce((a, r) => a + r.totals.quarantined, 0);
      const totalC = out.reduce((a, r) => a + r.totals.clean, 0);

      // Persist audit entry (best-effort — validation still succeeds if logging fails)
      try {
        const summary = buildValidationSummary(out);
        const hash = await sha256Hex(buf);
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes.user?.id;
        if (uid) {
          const { data: inserted, error: logErr } = await supabase
            .from("import_validation_audit")
            .insert({
              created_by: uid,
              actor_email: userRes.user?.email ?? null,
              file_name: file.name,
              file_size: file.size,
              file_hash: hash,
              file_version: fileVersion.trim() || null,
              sheets_validated: summary.totals.sheets,
              input_rows: summary.totals.input,
              clean_rows: summary.totals.clean,
              quarantined_rows: summary.totals.quarantined,
              per_sheet: summary.perSheet.map((p) => ({
                sheet: p.sheet,
                input: p.input,
                clean: p.clean,
                quarantined: p.quarantined,
                cleanPct: p.cleanPct,
              })),
              rule_breakdown: summary.violations.map((v) => ({
                rule: v.rule,
                field: v.field,
                category: v.category,
                count: v.count,
              })),
            })
            .select("id")
            .single();
          if (logErr || !inserted) {
            console.warn("audit insert failed", logErr?.message);
          } else {
            // Upload the workbook + a JSON report keyed by audit id so it can be linked back later.
            try {
              const auditId = inserted.id as string;
              const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
              const wbPath = `${auditId}/workbook-${safeName}`;
              const reportPath = `${auditId}/report.json`;
              const ct =
                file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
              const wbUp = await supabase.storage
                .from("import-artifacts")
                .upload(wbPath, new Blob([buf], { type: ct }), {
                  contentType: ct,
                  upsert: false,
                });
              const reportBody = {
                auditId,
                generatedAt: new Date().toISOString(),
                file: {
                  name: file.name,
                  size: file.size,
                  sha256: hash,
                  version: fileVersion.trim() || null,
                },
                totals: summary.totals,
                perSheet: summary.perSheet,
                violations: summary.violations,
                quarantined: out.flatMap((r) =>
                  r.quarantined.map((q) => ({ ...q, sheet: r.sheet })),
                ),
              };
              const rptUp = await supabase.storage
                .from("import-artifacts")
                .upload(
                  reportPath,
                  new Blob([JSON.stringify(reportBody, null, 2)], { type: "application/json" }),
                  { contentType: "application/json", upsert: true },
                );
              const patch: {
                workbook_path?: string;
                workbook_content_type?: string;
                report_path?: string;
              } = {};
              if (!wbUp.error) {
                patch.workbook_path = wbPath;
                patch.workbook_content_type = ct;
              } else console.warn("workbook upload failed", wbUp.error.message);
              if (!rptUp.error) {
                patch.report_path = reportPath;
              } else console.warn("report upload failed", rptUp.error.message);
              if (Object.keys(patch).length > 0) {
                const { error: upErr } = await supabase
                  .from("import_validation_audit")
                  .update(patch)
                  .eq("id", auditId);
                if (upErr) console.warn("audit artifact patch failed", upErr.message);
              }
            } catch (artExc) {
              console.warn("artifact upload error", artExc);
            }
            loadAudits();
          }
        }
      } catch (logExc) {
        console.warn("audit logging error", logExc);
      }

      if (totalQ === 0) toast.success(`All ${totalC} rows passed date validation`);
      else toast.warning(`${totalQ} rows quarantined · ${totalC} clean rows ready for import`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to parse workbook");
    } finally {
      setValidating(false);
    }
  }

  function downloadBlob(name: string, mime: string, body: BlobPart) {
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadQuarantine() {
    if (!reports) return;
    const allQ = reports.flatMap((r) => r.quarantined);
    if (!allQ.length) {
      toast.info("No quarantined rows");
      return;
    }
    const meta = buildCsvMetadataHeader({
      source: "Import Center — Quarantined Rows",
      extra: { Sheets: reports.map((r) => r.sheet).join(", ") },
      sort: { key: "sheet, rowIndex", dir: "asc" },
      counts: { shown: allQ.length },
    });
    const body = quarantineToCsv(allQ);
    downloadBlob(
      `quarantine-${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv;charset=utf-8",
      `${meta.join("\r\n")}\r\n\r\n${body}`,
    );
  }

  function downloadReportCsv() {
    if (!reports) return;
    const meta = buildCsvMetadataHeader({
      source: "Import Center — Validation Report",
      extra: { Sheets: reports.map((r) => r.sheet).join(", ") },
      counts: {
        shown: reports.reduce((n, r) => n + r.totals.input, 0),
        filtered: reports.reduce((n, r) => n + r.quarantined.length, 0),
      },
    });
    const body = validationReportToCsv(reports);
    downloadBlob(
      `validation-report-${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv;charset=utf-8",
      `${meta.join("\r\n")}\r\n\r\n${body}`,
    );
  }

  async function downloadReportXlsx() {
    if (!reports) return;
    const XLSXmod = await import("xlsx");
    const s = buildValidationSummary(reports);
    const wb = XLSXmod.utils.book_new();

    XLSXmod.utils.book_append_sheet(
      wb,
      XLSXmod.utils.aoa_to_sheet([
        ["Date Validation Report"],
        ["Generated at", s.generatedAt],
        [],
        ["Sheets validated", "Input rows", "Clean", "Quarantined", "Clean %"],
        [
          s.totals.sheets,
          s.totals.input,
          s.totals.clean,
          s.totals.quarantined,
          s.totals.input ? Math.round((s.totals.clean / s.totals.input) * 1000) / 10 : 100,
        ],
      ]),
      "Summary",
    );

    XLSXmod.utils.book_append_sheet(
      wb,
      XLSXmod.utils.json_to_sheet(
        s.perSheet.map((p) => ({
          Sheet: p.sheet,
          Input: p.input,
          Clean: p.clean,
          Quarantined: p.quarantined,
          "Clean %": p.cleanPct,
          Status: p.quarantined === 0 ? "Ready" : "Review",
        })),
      ),
      "Per-Sheet",
    );

    XLSXmod.utils.book_append_sheet(
      wb,
      XLSXmod.utils.json_to_sheet(
        s.violations.length
          ? s.violations.map((v) => ({
              Rule: v.rule,
              Field: v.field,
              Category: v.category,
              Count: v.count,
              "Sample sheet": v.sampleSheet,
              "Sample row #": v.sampleRowIndex,
              "Sample detail": v.sampleDetail,
            }))
          : [{ Rule: "(none)" }],
      ),
      "Rule Violations",
    );

    const fieldRows = s.perSheet.flatMap((p) =>
      Object.entries(p.fieldStats).map(([f, st]) => ({
        Sheet: p.sheet,
        Field: f,
        Parsed: st.parsed,
        Failed: st.failed,
      })),
    );
    XLSXmod.utils.book_append_sheet(
      wb,
      XLSXmod.utils.json_to_sheet(fieldRows.length ? fieldRows : [{ Sheet: "(none)" }]),
      "Field Stats",
    );

    const allQ = reports.flatMap((r) => r.quarantined);
    const keys = Array.from(new Set(allQ.flatMap((r) => Object.keys(r.raw))));
    const qRows = allQ.map((q) => {
      const obj: Record<string, unknown> = {
        Sheet: q.sheet,
        "Row #": q.rowIndex,
        Reasons: q.reasons.join(" | "),
      };
      keys.forEach((k) => (obj[k] = q.raw[k]));
      return obj;
    });
    XLSXmod.utils.book_append_sheet(
      wb,
      XLSXmod.utils.json_to_sheet(qRows.length ? qRows : [{ Sheet: "(none)" }]),
      "Quarantined Rows",
    );

    const out = XLSXmod.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    downloadBlob(
      `validation-report-${new Date().toISOString().slice(0, 10)}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      out,
    );
  }

  async function handleReseed() {
    setReseeding(true);
    try {
      const { data, error } = await callRpc("reseed_demo_data");
      if (error) throw error;
      const payload = data as { ok: boolean; counts: Record<string, number>; reseeded_at: string };
      setLastCounts(payload.counts);
      toast.success("Demo data reseeded", {
        description: `${payload.counts.bookings} bookings · ${payload.counts.units} units · ${payload.counts.payments} payments`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Reseed failed";
      toast.error(msg);
    } finally {
      setReseeding(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Import Center"
        description="Map an Excel workbook to the ERP database. The initial seed is already loaded from your audited workbook."
      />

      <div className="card-elevated p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-accent text-accent-foreground grid place-items-center">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="font-semibold">Upload .xlsm / .xlsx</div>
            <div className="text-xs text-muted-foreground">
              Parsing happens client-side. Full reconciliation runs after preview.
            </div>
          </div>
          <label className="inline-flex">
            <input
              type="file"
              accept=".xlsm,.xlsx"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button asChild>
              <span>
                <Upload className="h-4 w-4 mr-1" /> Choose file
              </span>
            </Button>
          </label>
        </div>
        {file && (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm bg-muted/40 rounded-lg p-3 flex-wrap">
            <div className="min-w-0">
              <span className="font-medium">{file.name}</span> · {(file.size / 1024).toFixed(0)} KB
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={fileVersion}
                onChange={(e) => setFileVersion(e.target.value)}
                placeholder="File version (e.g. v2026-06-30)"
                className="h-9 w-56 text-xs"
              />
              <Button size="sm" variant="outline" onClick={handleValidate} disabled={validating}>
                <ShieldCheck className="h-4 w-4 mr-1" />
                {validating ? "Validating…" : "Validate dates & preview"}
              </Button>
            </div>
          </div>
        )}

        {reports && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-semibold">Date validation report</div>
              <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                  const validationInput = () => ({
                    source: "Import Center — Validation Report",
                    extra: { Sheets: (reports ?? []).map((r) => r.sheet).join(", ") },
                    counts: {
                      shown: (reports ?? []).reduce((n, r) => n + r.totals.input, 0),
                      filtered: (reports ?? []).reduce((n, r) => n + r.quarantined.length, 0),
                    },
                  });
                  const quarantineInput = () => ({
                    source: "Import Center — Quarantined Rows",
                    extra: { Sheets: (reports ?? []).map((r) => r.sheet).join(", ") },
                    sort: { key: "sheet, rowIndex", dir: "asc" as const },
                    counts: {
                      shown: (reports ?? []).reduce((n, r) => n + r.quarantined.length, 0),
                    },
                  });
                  return (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          requestCsvExport({
                            label: "the Validation Report CSV",
                            input: validationInput,
                            onConfirm: downloadReportCsv,
                          })
                        }
                      >
                        <Download className="h-4 w-4 mr-1" /> Full report (CSV)
                      </Button>
                      <CsvExportMetadataPreview
                        label="the Validation Report CSV"
                        input={validationInput}
                      />
                      <Button size="sm" onClick={downloadReportXlsx}>
                        <Download className="h-4 w-4 mr-1" /> Full report (XLSX)
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          requestCsvExport({
                            label: "the Quarantine CSV",
                            input: quarantineInput,
                            onConfirm: downloadQuarantine,
                          })
                        }
                      >
                        <Download className="h-4 w-4 mr-1" /> Quarantine only
                      </Button>
                      <CsvExportMetadataPreview
                        label="the Quarantine CSV"
                        input={quarantineInput}
                      />
                    </>
                  );
                })()}
              </div>
            </div>
            <table className="w-full text-xs border rounded-lg overflow-hidden">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Sheet → Table</th>
                  <th className="text-right px-3 py-2">Input</th>
                  <th className="text-right px-3 py-2">Clean</th>
                  <th className="text-right px-3 py-2">Quarantined</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.sheet} className="border-t">
                    <td className="px-3 py-2 font-mono">{r.sheet}</td>
                    <td className="px-3 py-2 text-right">{r.totals.input}</td>
                    <td className="px-3 py-2 text-right text-emerald-600">{r.totals.clean}</td>
                    <td className="px-3 py-2 text-right text-amber-600">
                      {r.totals.quarantined || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.totals.quarantined === 0 ? (
                        <Badge variant="outline" className="text-emerald-700 border-emerald-300">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Ready
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-700 border-amber-300">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Review
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {(() => {
              const s = buildValidationSummary(reports);
              if (s.violations.length === 0) return null;
              return (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-muted/40 px-3 py-2 text-xs font-semibold flex items-center justify-between">
                    <span>Date rules violated</span>
                    <span className="text-muted-foreground font-normal">
                      {s.violations.length} rule{s.violations.length === 1 ? "" : "s"} ·{" "}
                      {s.totals.quarantined} row hit{s.totals.quarantined === 1 ? "" : "s"}
                    </span>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-muted/20 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-1.5">Rule</th>
                        <th className="text-left px-3 py-1.5">Field</th>
                        <th className="text-left px-3 py-1.5">Category</th>
                        <th className="text-right px-3 py-1.5">Rows</th>
                        <th className="text-left px-3 py-1.5">Sample</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.violations.slice(0, 25).map((v) => (
                        <tr key={`${v.rule}-${v.field}`} className="border-t">
                          <td className="px-3 py-1.5 font-mono text-amber-700 dark:text-amber-400">
                            {v.rule}
                          </td>
                          <td className="px-3 py-1.5 font-mono">{v.field}</td>
                          <td className="px-3 py-1.5">
                            <Badge variant="outline" className="text-[10px]">
                              {v.category}
                            </Badge>
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium">{v.count}</td>
                          <td
                            className="px-3 py-1.5 text-muted-foreground truncate max-w-[280px]"
                            title={`${v.sampleSheet} row ${v.sampleRowIndex}: ${v.sampleDetail}`}
                          >
                            {v.sampleSheet}·{v.sampleRowIndex} — {v.sampleDetail || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {reports.some((r) => r.quarantined.length > 0) && (
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  Quarantined rows — will NOT be written to the database
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5">Sheet</th>
                        <th className="text-left px-3 py-1.5">Row #</th>
                        <th className="text-left px-3 py-1.5">Reasons</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports
                        .flatMap((r) => r.quarantined)
                        .slice(0, 200)
                        .map((q, i) => (
                          <tr key={`${q.sheet}-${q.rowIndex}-${i}`} className="border-t">
                            <td className="px-3 py-1.5 font-mono">{q.sheet}</td>
                            <td className="px-3 py-1.5">{q.rowIndex}</td>
                            <td className="px-3 py-1.5 text-amber-700 dark:text-amber-400">
                              {q.reasons.join(" · ")}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="text-[11px] text-muted-foreground">
              Only <span className="font-semibold text-emerald-600">clean rows</span> are eligible
              for the next write step. Quarantined rows are held aside so a human can correct the
              workbook before re-uploading.
            </div>
          </div>
        )}
      </div>

      <div className="card-elevated overflow-hidden mb-6">
        <div className="p-4 border-b flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <div>
              <div className="text-sm font-semibold">Upload validation audit log</div>
              <div className="text-xs text-muted-foreground">
                Every validation run recorded — file, version, and quarantine counts. Append-only.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                File / version
              </label>
              <Input
                value={auditFileQ}
                onChange={(e) => setAuditFileQ(e.target.value)}
                placeholder="e.g. bookings.xlsx"
                className="h-8 text-xs w-[180px]"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                SHA-256
              </label>
              <Input
                value={auditHashQ}
                onChange={(e) => setAuditHashQ(e.target.value)}
                placeholder="hash prefix…"
                className="h-8 text-xs w-[160px] font-mono"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                User
              </label>
              <Input
                value={auditUserQ}
                onChange={(e) => setAuditUserQ(e.target.value)}
                placeholder="email…"
                className="h-8 text-xs w-[160px]"
              />
            </div>
            <div className="flex flex-col">
              <label
                htmlFor="audit-from"
                className="text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                From
              </label>
              <Input
                id="audit-from"
                type="date"
                value={auditFrom}
                onChange={(e) => setAuditFrom(e.target.value)}
                className="h-8 text-xs w-[140px]"
              />
            </div>
            <div className="flex flex-col">
              <label
                htmlFor="audit-to"
                className="text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                To
              </label>
              <Input
                id="audit-to"
                type="date"
                value={auditTo}
                onChange={(e) => setAuditTo(e.target.value)}
                className="h-8 text-xs w-[140px]"
              />
            </div>
            {(auditFrom || auditTo || auditFileQ || auditHashQ || auditUserQ) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 min-h-11 min-w-11"
                onClick={() => {
                  setAuditFrom("");
                  setAuditTo("");
                  setAuditFileQ("");
                  setAuditHashQ("");
                  setAuditUserQ("");
                }}
              >
                Clear
              </Button>
            )}
            {(() => {
              const auditInput = () => ({
                source: "Import Center — Audit Runs",
                filters: {
                  File: auditFileQ.trim(),
                  "SHA-256": auditHashQ.trim(),
                  User: auditUserQ.trim(),
                  From: auditFrom,
                  To: auditTo,
                },
                sort: { key: "created_at", dir: "desc" as const },
              });
              return (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 min-h-11 min-w-11"
                    disabled={exportingAudit}
                    onClick={() =>
                      requestCsvExport({
                        label: "the Audit Runs CSV",
                        input: auditInput,
                        onConfirm: handleExportAuditsCsv,
                      })
                    }
                    title="Export matching runs (or last 25 if no filters)"
                  >
                    <Download className="h-3.5 w-3.5 mr-1" /> CSV
                  </Button>
                  <CsvExportMetadataPreview label="the Audit Runs CSV" input={auditInput} />
                </>
              );
            })()}

            <Button
              size="sm"
              variant="outline"
              className="h-8 min-h-11 min-w-11"
              disabled={exportingAudit}
              onClick={handleExportAuditsXlsx}
              title="Export matching runs (or last 25 if no filters)"
            >
              <Download className="h-3.5 w-3.5 mr-1" /> XLSX
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 min-h-11 min-w-11"
              onClick={loadAudits}
            >
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
        </div>
        {(() => {
          const filtered = (audits ?? []).filter(matchesAuditFilters);
          const hasAnyFilter = !!(
            auditFrom ||
            auditTo ||
            auditFileQ.trim() ||
            auditHashQ.trim() ||
            auditUserQ.trim()
          );
          return (
            <>
              <div className="px-4 py-1.5 text-[11px] text-muted-foreground bg-muted/20 border-b">
                {hasAnyFilter ? (
                  <>
                    Showing <b>{filtered.length}</b> of last 25 runs matching filters · Exports
                    apply the same filters.
                  </>
                ) : (
                  <>
                    Showing last 25 runs · Exports use filters/date range if set, otherwise the last
                    25 runs.
                  </>
                )}
              </div>
              {!audits || audits.length === 0 ? (
                <div className="p-6 text-xs text-muted-foreground text-center">
                  No validation runs recorded yet.
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-xs text-muted-foreground text-center">
                  No runs match the current filters.
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">When</th>
                        <th className="text-left px-3 py-2">By</th>
                        <th className="text-left px-3 py-2">File</th>
                        <th className="text-left px-3 py-2">Version</th>
                        <th className="text-right px-3 py-2">Sheets</th>
                        <th className="text-right px-3 py-2">Input</th>
                        <th className="text-right px-3 py-2">Clean</th>
                        <th className="text-right px-3 py-2">Quarantined</th>
                        <th className="text-left px-3 py-2">Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((a) => (
                        <tr
                          key={a.id}
                          onClick={() => setDetail(a)}
                          className="border-t cursor-pointer hover:bg-muted/40 focus:bg-muted/60 outline-none"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setDetail(a);
                            }
                          }}
                          title="View full rule breakdown & per-sheet counts"
                        >
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            {new Date(a.created_at).toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5">{a.actor_email ?? "—"}</td>
                          <td className="px-3 py-1.5 max-w-[220px] truncate" title={a.file_name}>
                            {a.file_name}
                          </td>
                          <td className="px-3 py-1.5 font-mono">{a.file_version ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right">{a.sheets_validated}</td>
                          <td className="px-3 py-1.5 text-right">{a.input_rows}</td>
                          <td className="px-3 py-1.5 text-right text-emerald-600">
                            {a.clean_rows}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right ${a.quarantined_rows > 0 ? "text-amber-600 font-medium" : ""}`}
                          >
                            {a.quarantined_rows}
                          </td>
                          <td
                            className="px-3 py-1.5 font-mono text-muted-foreground"
                            title={a.file_hash ?? ""}
                          >
                            {a.file_hash ? a.file_hash.slice(0, 10) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        })()}
      </div>

      <AuditDetailDialog audit={detail} onOpenChange={(o) => !o && setDetail(null)} />

      <div className="card-elevated p-5 mb-6 flex items-start gap-4">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
          <RefreshCw className={`h-4 w-4 ${reseeding ? "animate-spin" : ""}`} />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">Reseed demo data (idempotent)</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Re-applies the canonical projects, units, clients, bookings, payments, ledger and
            adjustments from the seed snapshot. Safe to run repeatedly — existing rows are upserted
            by their natural key, no duplicates are created. Admin only.
          </div>
          {lastCounts && (
            <div className="mt-2 text-xs text-muted-foreground font-mono">
              projects {lastCounts.projects} · units {lastCounts.units} · clients{" "}
              {lastCounts.clients} · bookings {lastCounts.bookings} · payments {lastCounts.payments}{" "}
              · ledger {lastCounts.installment_ledger} · adjustments {lastCounts.adjustments}
            </div>
          )}
        </div>
        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={reseeding}
          variant="outline"
          size="sm"
        >
          {reseeding ? "Reseeding…" : "Run reseed"}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Reseed demo data?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This will <span className="font-semibold text-foreground">overwrite</span>{" "}
                  projects, units, clients, bookings, payments, installment ledger and adjustments
                  with the canonical seed snapshot.
                </p>
                <p>
                  Any manual edits to those records since the last seed will be reverted. The
                  operation is idempotent and admin-only, but it cannot be undone from the UI.
                </p>
                <p className="text-xs text-muted-foreground">Are you sure you want to proceed?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reseeding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reseeding}
              onClick={(e) => {
                e.preventDefault();
                handleReseed();
                setConfirmOpen(false);
              }}
            >
              {reseeding ? "Reseeding…" : "Yes, reseed"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="card-elevated overflow-hidden">
        <div className="p-4 border-b">
          <div className="text-sm font-semibold">Workbook → App mapping</div>
          <div className="text-xs text-muted-foreground">
            Source-of-truth references parsed from the SCHEMA_MAP sheet
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Workbook Sheet</th>
              <th className="text-left px-4 py-2 font-medium">App Module</th>
              <th className="text-left px-4 py-2 font-medium">Database Table</th>
              <th className="text-right px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sheetMap.map((m) => (
              <tr key={m.sheet} className="border-t">
                <td className="px-4 py-2 font-mono text-xs">{m.sheet}</td>
                <td className="px-4 py-2">
                  {m.module} <ArrowRight className="inline h-3 w-3 mx-1 text-muted-foreground" />
                </td>
                <td className="px-4 py-2 font-mono text-xs text-primary">{m.table}</td>
                <td className="px-4 py-2 text-right">
                  <span className="badge-pill bg-success/10 text-success border border-success/20">
                    <CheckCircle2 className="h-3 w-3" /> Seeded
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 card-elevated p-5 flex items-start gap-3 bg-warning/5 border-warning/20">
        <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-semibold">Re-import order</div>
          <div className="text-muted-foreground text-xs mt-1">
            Settings → Projects → Units → Clients → Bookings → Adjustments → Payments → Regenerate
            Installments → Regenerate Ledger → Validate Totals.
          </div>
        </div>
      </div>
      {csvConfirmDialog}
    </div>
  );
}

type PerSheetEntry = {
  sheet: string;
  input: number;
  clean: number;
  quarantined: number;
  cleanPct: number;
};
type RuleEntry = { rule: string; field?: string | null; category?: string | null; count: number };
type AuditDetail = {
  id: string;
  created_at: string;
  actor_email: string | null;
  file_name: string;
  file_size: number | null;
  file_hash: string | null;
  file_version: string | null;
  sheets_validated: number;
  input_rows: number;
  clean_rows: number;
  quarantined_rows: number;
  per_sheet?: PerSheetEntry[] | null;
  rule_breakdown?: RuleEntry[] | null;
  notes?: string | null;
  workbook_path?: string | null;
  workbook_content_type?: string | null;
  report_path?: string | null;
};

async function openImportArtifact(path: string, download?: string) {
  const { data, error } = await supabase.storage
    .from("import-artifacts")
    .createSignedUrl(path, 300, download ? { download } : undefined);
  if (error || !data?.signedUrl) {
    toast.error(error?.message ?? "Could not open artifact");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

function AuditDetailDialog({
  audit,
  onOpenChange,
}: {
  audit: AuditDetail | null;
  onOpenChange: (open: boolean) => void;
}) {
  const perSheet: PerSheetEntry[] = Array.isArray(audit?.per_sheet)
    ? (audit!.per_sheet as PerSheetEntry[])
    : [];
  const rules: RuleEntry[] = Array.isArray(audit?.rule_breakdown)
    ? (audit!.rule_breakdown as RuleEntry[])
    : [];
  const totalRuleHits = rules.reduce((s, r) => s + (r.count ?? 0), 0);
  const overallCleanPct =
    audit && audit.input_rows > 0
      ? Math.round((audit.clean_rows / audit.input_rows) * 1000) / 10
      : 0;
  const fmtBytes = (n: number | null | undefined) => {
    if (!n) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <Dialog open={!!audit} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Validation run detail</DialogTitle>
          <DialogDescription className="text-xs">
            {audit && new Date(audit.created_at).toLocaleString()} · {audit?.actor_email ?? "—"}
          </DialogDescription>
        </DialogHeader>

        {!audit ? null : (
          <div className="space-y-5">
            {/* Header meta */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="rounded-md border p-2.5">
                <div className="text-muted-foreground">File</div>
                <div className="font-medium truncate" title={audit.file_name}>
                  {audit.file_name}
                </div>
                <div className="text-muted-foreground mt-0.5">{fmtBytes(audit.file_size)}</div>
              </div>
              <div className="rounded-md border p-2.5">
                <div className="text-muted-foreground">Version</div>
                <div className="font-mono">{audit.file_version ?? "—"}</div>
              </div>
              <div className="rounded-md border p-2.5">
                <div className="text-muted-foreground">Sheets validated</div>
                <div className="font-medium">{audit.sheets_validated}</div>
              </div>
              <div className="rounded-md border p-2.5">
                <div className="text-muted-foreground">SHA-256</div>
                <div
                  className="font-mono text-[10px] break-all leading-tight"
                  title={audit.file_hash ?? ""}
                >
                  {audit.file_hash ?? "—"}
                </div>
              </div>
            </div>

            {/* Import artifacts */}
            <div>
              <div className="text-xs font-semibold mb-2 uppercase tracking-wide text-muted-foreground">
                Import artifacts
              </div>
              {!audit.workbook_path && !audit.report_path ? (
                <div className="text-xs text-muted-foreground italic rounded-md border bg-muted/20 px-3 py-2">
                  No artifacts stored for this run. Runs recorded before artifact storage was
                  enabled will not have downloads.
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {audit.workbook_path ? (
                    <div className="rounded-md border p-2.5 flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate" title={audit.file_name}>
                          Uploaded workbook
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {audit.file_name}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => openImportArtifact(audit.workbook_path!)}
                      >
                        Open
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => openImportArtifact(audit.workbook_path!, audit.file_name)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-2.5 text-[11px] text-muted-foreground">
                      Workbook not stored for this run.
                    </div>
                  )}
                  {audit.report_path ? (
                    <div className="rounded-md border p-2.5 flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">Validation report</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          report.json · totals, per-sheet, violations, quarantined rows
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => openImportArtifact(audit.report_path!)}
                      >
                        Open
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() =>
                          openImportArtifact(
                            audit.report_path!,
                            `validation-report-${audit.id.slice(0, 8)}.json`,
                          )
                        }
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-2.5 text-[11px] text-muted-foreground">
                      Report not stored for this run.
                    </div>
                  )}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground mt-1.5">
                Links use short-lived signed URLs — access is limited to the uploader and admins.
              </div>
            </div>

            {/* Totals */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-[11px] text-muted-foreground">Input rows</div>
                <div className="text-xl font-semibold">{audit.input_rows.toLocaleString()}</div>
              </div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-[11px] text-emerald-700">Clean</div>
                <div className="text-xl font-semibold text-emerald-700">
                  {audit.clean_rows.toLocaleString()}
                </div>
                <div className="text-[10px] text-emerald-700/80">{overallCleanPct}% pass rate</div>
              </div>
              <div
                className={`rounded-md border p-3 ${audit.quarantined_rows > 0 ? "border-amber-200 bg-amber-50" : "border-muted bg-muted/20"}`}
              >
                <div
                  className={`text-[11px] ${audit.quarantined_rows > 0 ? "text-amber-700" : "text-muted-foreground"}`}
                >
                  Quarantined
                </div>
                <div
                  className={`text-xl font-semibold ${audit.quarantined_rows > 0 ? "text-amber-700" : ""}`}
                >
                  {audit.quarantined_rows.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Per-sheet breakdown */}
            <div>
              <div className="text-xs font-semibold mb-2 uppercase tracking-wide text-muted-foreground">
                Per-sheet clean vs quarantine
              </div>
              {perSheet.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">
                  No per-sheet data recorded for this run.
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-1.5">Sheet</th>
                        <th className="text-right px-3 py-1.5">Input</th>
                        <th className="text-right px-3 py-1.5">Clean</th>
                        <th className="text-right px-3 py-1.5">Quarantined</th>
                        <th className="text-left px-3 py-1.5 w-1/3">Pass rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perSheet.map((p, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5 font-mono">{p.sheet}</td>
                          <td className="px-3 py-1.5 text-right">{p.input.toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right text-emerald-600">
                            {p.clean.toLocaleString()}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right ${p.quarantined > 0 ? "text-amber-600 font-medium" : ""}`}
                          >
                            {p.quarantined.toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500"
                                  style={{ width: `${Math.max(0, Math.min(100, p.cleanPct))}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground w-10 text-right">
                                {p.cleanPct.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Rule breakdown */}
            <div>
              <div className="text-xs font-semibold mb-2 uppercase tracking-wide text-muted-foreground flex items-center justify-between">
                <span>Rule breakdown</span>
                {totalRuleHits > 0 && (
                  <span className="text-[10px] text-muted-foreground normal-case tracking-normal">
                    {totalRuleHits} total violations
                  </span>
                )}
              </div>
              {rules.length === 0 ? (
                <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5" /> No rules violated in this run.
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-1.5">Rule</th>
                        <th className="text-left px-3 py-1.5">Field</th>
                        <th className="text-left px-3 py-1.5">Category</th>
                        <th className="text-right px-3 py-1.5">Hits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules
                        .slice()
                        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
                        .map((r, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-1.5 font-mono">{r.rule}</td>
                            <td className="px-3 py-1.5 font-mono text-muted-foreground">
                              {r.field ?? "—"}
                            </td>
                            <td className="px-3 py-1.5">
                              {r.category ? (
                                <span className="badge-pill bg-amber-100 text-amber-800 border border-amber-200">
                                  {r.category}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right font-medium">{r.count}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {audit.notes && (
              <div className="text-xs">
                <div className="font-semibold mb-1 uppercase tracking-wide text-muted-foreground">
                  Notes
                </div>
                <div className="rounded-md border bg-muted/30 p-2.5 whitespace-pre-wrap">
                  {audit.notes}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

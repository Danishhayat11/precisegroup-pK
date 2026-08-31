/**
 * XLSX export helper for AI Diagnostics filtered downloads.
 *
 * Keeps ExcelJS out of the main page bundle — the caller `await import`s
 * this module only when the user clicks "Filtered XLSX", so the ~800KB
 * dependency doesn't slow first paint for readers who never export.
 *
 * Sheet layout:
 *   • "Diagnostics"  — one row per tool call, columns driven by the same
 *     `ExportColumnDef[]` registry used for CSV/JSON so headers, cells
 *     and JSON keys can never drift.
 *   • "Metadata"     — flat key/value dump of the CSV `_meta` envelope
 *     (source, generated, filters, sort, page, counts, schema, version)
 *     so a reviewer opening the file in Excel can see exactly which
 *     filters produced the data without a separate README.
 */
import ExcelJS from "exceljs";
import type { CsvMetadataInput } from "@/lib/csvExportMetadata";
import { JSON_ENVELOPE_SCHEMA, JSON_ENVELOPE_VERSION } from "@/lib/csvExportMetadata";
import type { DiagnosticsRow, ExportColumnDef } from "@/pages/aiDiagnosticsExportColumns";
import type { GatewayPayloadFormat } from "@/pages/aiDiagnosticsGatewayPayload";

interface BuildXlsxOptions {
  rows: DiagnosticsRow[];
  columns: ExportColumnDef[];
  meta: CsvMetadataInput;
  prettyGatewayPayload: boolean;
  buildGatewayErrorPayload: (r: DiagnosticsRow, fmt: GatewayPayloadFormat) => unknown;
}

/**
 * Coerce a column's value to something Excel understands. Primitives pass
 * through; anything object-shaped is JSON-stringified so a cell always
 * holds text (Excel would otherwise render `[object Object]`).
 */
function toCell(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return value as string | number | boolean;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function buildDiagnosticsXlsxBlob(options: BuildXlsxOptions): Promise<Blob> {
  const { rows, columns, meta, prettyGatewayPayload, buildGatewayErrorPayload } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Precise Realtors — AI Diagnostics";
  workbook.created = new Date();

  // --- Data sheet ---------------------------------------------------------
  const sheet = workbook.addWorksheet("Diagnostics", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    // Sensible defaults; auto-fit is expensive for large sheets, so cap.
    width:
      c.key === "tool_args" || c.key === "tool_result" || c.key === "gateway_error_payload"
        ? 60
        : 20,
  }));
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };

  for (const r of rows) {
    const cells: Record<string, string | number | boolean | Date | null> = {};
    for (const col of columns) {
      cells[col.key] = toCell(col.csvValue(r, buildGatewayErrorPayload, prettyGatewayPayload));
    }
    sheet.addRow(cells);
  }
  // Wrap long JSON cells so they don't spill invisibly to the right.
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
  });

  // --- Metadata sheet -----------------------------------------------------
  const metaSheet = workbook.addWorksheet("Metadata");
  metaSheet.columns = [
    { header: "Key", key: "key", width: 24 },
    { header: "Value", key: "value", width: 80 },
  ];
  metaSheet.getRow(1).font = { bold: true };

  const flat: Array<[string, string]> = [
    ["Source", meta.source],
    ["Generated", (meta.generatedAt ?? new Date()).toISOString()],
    ["Schema", JSON_ENVELOPE_SCHEMA],
    ["Version", String(JSON_ENVELOPE_VERSION)],
  ];
  if (meta.filters) {
    for (const [k, v] of Object.entries(meta.filters)) {
      if (v === undefined || v === null || v === "") continue;
      flat.push([`Filter · ${k}`, String(v)]);
    }
  }
  if (meta.sort) {
    flat.push(["Sort", `${meta.sort.key} ${meta.sort.dir}`]);
  }
  if (meta.page && typeof meta.page === "object") {
    flat.push([
      "Page",
      `${meta.page.page} of ${meta.page.totalPages} (size ${meta.page.pageSize})`,
    ]);
  } else if (meta.page === null) {
    flat.push(["Page", "all (filtered export spans every page)"]);
  }
  if (meta.counts) {
    flat.push(["Rows shown", String(meta.counts.shown)]);
    if (typeof meta.counts.filtered === "number") {
      flat.push(["Rows matched", String(meta.counts.filtered)]);
    }
    if (typeof meta.counts.total === "number") {
      flat.push(["Rows total", String(meta.counts.total)]);
    }
  }
  flat.push(["Columns", `${columns.length}: ${columns.map((c) => c.label).join(", ")}`]);
  if (meta.extra) {
    for (const [k, v] of Object.entries(meta.extra)) {
      if (v === undefined || v === null || v === "") continue;
      flat.push([`Note · ${k}`, String(v)]);
    }
  }
  for (const [key, value] of flat) {
    metaSheet.addRow({ key, value });
  }
  metaSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

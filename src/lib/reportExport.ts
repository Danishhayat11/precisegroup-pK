/**
 * Report export helpers — CSV + PDF.
 *
 * Each report declares columns + row-data and calls these helpers via the
 * <ExportButtons /> component. Keep this file dependency-light: only
 * `xlsx`-style CSV encoding (built by hand) and `jspdf` + `jspdf-autotable`
 * which are already in package.json.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface ExportColumn<Row = any> {
  key: string;
  label: string;
  /** Right-align numeric columns in PDF. */
  numeric?: boolean;
  /** Custom accessor; defaults to row[key]. */
  get?: (row: Row) => string | number | null | undefined;
}

const csvEscape = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

export function downloadCSV<Row>(
  filename: string,
  columns: ExportColumn<Row>[],
  rows: Row[],
  totals?: Record<string, string | number>,
) {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const body = rows.map((r) =>
    columns.map((c) => csvEscape(c.get ? c.get(r) : (r as any)[c.key])).join(","),
  );
  if (totals) {
    body.push(columns.map((c) => csvEscape(totals[c.key] ?? "")).join(","));
  }
  const blob = new Blob(["\uFEFF" + [header, ...body].join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadPDF<Row>(
  filename: string,
  title: string,
  subtitle: string | null,
  columns: ExportColumn<Row>[],
  rows: Row[],
  totals?: Record<string, string | number>,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("times", "bold");
  doc.setFontSize(14);
  doc.text(title, pageWidth / 2, 15, { align: "center" });
  if (subtitle) {
    doc.setFont("times", "normal");
    doc.setFontSize(10);
    doc.text(subtitle, pageWidth / 2, 21, { align: "center" });
  }

  const body = rows.map((r) =>
    columns.map((c) => {
      const v = c.get ? c.get(r) : (r as any)[c.key];
      return v === null || v === undefined ? "" : String(v);
    }),
  );

  autoTable(doc, {
    head: [columns.map((c) => c.label)],
    body,
    foot: totals ? [columns.map((c) => String(totals[c.key] ?? ""))] : undefined,
    startY: subtitle ? 26 : 20,
    styles: { font: "times", fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [230, 230, 230], textColor: 0, fontStyle: "bold" },
    footStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: "bold" },
    columnStyles: columns.reduce(
      (acc, c, i) => {
        if (c.numeric) acc[i] = { halign: "right" };
        return acc;
      },
      {} as Record<number, any>,
    ),
    didDrawPage: (data) => {
      const str = `Page ${doc.getCurrentPageInfo().pageNumber}`;
      doc.setFontSize(8);
      doc.setFont("times", "normal");
      doc.text(str, pageWidth - data.settings.margin.right, doc.internal.pageSize.getHeight() - 6, {
        align: "right",
      });
    },
  });

  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

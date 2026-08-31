/**
 * Minimal CSV export helper — RFC 4180 quoting, UTF-8 BOM so Excel opens
 * non-ASCII columns (names, addresses) without mojibake, and a same-page
 * download via a blob object URL.
 *
 * Also neutralizes CSV/Excel formula-injection: user-controlled string
 * cells starting with `=`, `+`, `-`, `@`, TAB, or CR would otherwise be
 * evaluated as live formulas when the file is opened in Excel/Sheets/
 * Numbers. We prefix such string values with a single tick (`'`) so the
 * spreadsheet renders them as literal text. Numeric values (e.g. -5) are
 * left untouched because they arrive as `number`, not `string`.
 * OWASP: https://owasp.org/www-community/attacks/CSV_Injection
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Escape a single value for CSV emission. Handles RFC 4180 quoting AND
 * formula-injection neutralization. Exported so per-page CSV helpers can
 * share the same behavior instead of duplicating (and drifting from) it.
 */
export function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const isString = typeof v === "string";
  let s = isString ? v : String(v);
  // Neutralize spreadsheet formulas ONLY for values that originated as
  // strings — numbers and booleans coerced via String() are safe.
  if (isString && FORMULA_TRIGGER.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Backwards-compatible internal alias.
const escapeCell = escapeCsvCell;

export function toCsv<T>(
  rows: T[],
  columns: Array<{ header: string; value: (row: T) => unknown }>,
): string {
  const head = columns.map((c) => escapeCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => escapeCell(c.value(r))).join(",")).join("\r\n");
  return `${head}\r\n${body}`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

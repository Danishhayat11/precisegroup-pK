/**
 * Shared ledger row cleaner. Any row that has no due amount, no paid
 * amount, no particulars label and no due date is considered an empty
 * trailing placeholder and removed before display, print, or export.
 */
export function cleanLedger<T extends Record<string, any>>(rows: T[] | null | undefined): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((l) => {
    const due = Number(l?.due_amount) || 0;
    const paid = Number(l?.paid_amount) || 0;
    const label = String(l?.particulars ?? "").trim();
    return due > 0 || paid > 0 || label.length > 0 || !!l?.due_date;
  });
}

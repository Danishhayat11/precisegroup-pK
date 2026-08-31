/**
 * A4 print stylesheet shared by the Installment Payment Plan document.
 * Injected at print time; hidden on-screen (screen preview uses Tailwind).
 */
export const PLAN_PRINT_STYLES = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html, body { background: #fff !important; }
  body:has(.plan-doc-print) * { visibility: hidden !important; }
  .plan-doc-print, .plan-doc-print * { visibility: visible !important; }
  .plan-doc-print { position: absolute; inset: 0; margin: 0 !important; padding: 0 !important; }
  .plan-hide-print { display: none !important; }

  .doc-sheet { width: 186mm; max-width: 186mm; }
  table.plan-schedule { border-collapse: collapse; width: 100%; font-size: 10pt; }
  table.plan-schedule th, table.plan-schedule td {
    border: 1px solid #d4d4d8;
    padding: 4px 6px;
    line-height: 1.25;
  }
  table.plan-schedule thead th {
    background: hsl(var(--doc-accent) / 0.12);
    color: hsl(var(--doc-accent));
    font-weight: 700;
    text-transform: uppercase;
    font-size: 8.5pt;
    letter-spacing: 0.03em;
  }
  table.plan-schedule tr { break-inside: avoid; page-break-inside: avoid; }
  table.plan-schedule tfoot td {
    background: hsl(var(--doc-accent) / 0.08);
    font-weight: 700;
  }
  .status-pill {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 0.03em;
  }
  .doc-header, .doc-footer { break-inside: avoid; }
  .plan-summary-grid { break-inside: avoid; }
  .plan-overdue-banner { break-inside: avoid; }
}
`;

export function injectPlanPrintStyles() {
  if (typeof document === "undefined") return () => {};
  const id = "plan-print-styles";
  if (document.getElementById(id)) return () => {};
  const el = document.createElement("style");
  el.id = id;
  el.textContent = PLAN_PRINT_STYLES;
  document.head.appendChild(el);
  return () => {
    el.parentNode?.removeChild(el);
  };
}

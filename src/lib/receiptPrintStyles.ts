/**
 * Shared print CSS for receipt-style documents.
 *
 * `RECEIPT_SHARED_STYLES` — structural / typographic rules that apply to
 * any `.pp-receipt` document (payment receipts, deposit slips, adjustment
 * receipts). Injected by both the on-screen preview (PrintPreviewModal)
 * and the actual print path so what the user previews matches what the
 * browser prints.
 *
 * `PAYMENT_RECEIPT_PRINT_STYLES` — additional rules scoped to
 * `.pp-receipt.pp-payment-receipt` (the dual-copy A4 payment receipt).
 * Enforces the same non-clipping behavior as other receipt variants:
 *   - each copy is atomic (`break-inside: avoid`)
 *   - no descendant may exceed the sheet width
 *   - the tear line stays glued to the copy above it
 *   - explicit page-break rules replace the historic
 *     `max-height: calc(50% - 3mm)` clamp that used to clip the second
 *     copy on Chrome/Edge printer drivers
 *
 * Both constants are pure strings so they can be dropped into a `<style>`
 * tag, a Shadow DOM stylesheet, or the print-flow's cloned host without
 * bringing along any React runtime.
 */

export const RECEIPT_SHARED_STYLES = `
  .pp-receipt, .pp-receipt * {
    box-sizing: border-box;
    font-feature-settings: "kern" 1, "liga" 1, "calt" 1, "tnum" 1, "lnum" 1;
  }
  .pp-receipt {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow: visible;
  }
  .pp-receipt .pp-num,
  .pp-receipt table td, .pp-receipt table th {
    font-variant-numeric: tabular-nums lining-nums;
  }
  .pp-receipt .pp-hero,
  .pp-receipt .pp-header-box,
  .pp-receipt .pp-details,
  .pp-receipt .pp-balance,
  .pp-receipt .pp-signatures,
  .pp-receipt .pp-footer,
  .pp-receipt .pp-breakdown,
  .pp-receipt .pp-avoid-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .pp-receipt table tr,
  .pp-receipt table thead,
  .pp-receipt table tfoot {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .pp-receipt table td,
  .pp-receipt table th {
    break-inside: avoid;
    page-break-inside: avoid;
    overflow-wrap: anywhere;
    word-break: normal;
    line-break: strict;
    white-space: normal;
    hyphens: auto;
    -webkit-hyphens: auto;
    hyphenate-limit-chars: 8 3 3;
    padding: 4pt 6pt;
    line-height: 1.28;
    vertical-align: top;
  }
  .pp-receipt table th {
    padding: 5pt 6pt;
    line-height: 1.2;
  }
  .pp-receipt table td.pp-num,
  .pp-receipt table th.pp-num,
  .pp-receipt table td[data-num],
  .pp-receipt table th[data-num] {
    white-space: nowrap;
    overflow-wrap: normal;
    word-break: keep-all;
    hyphens: manual;
    text-align: right;
  }
  .pp-receipt table { table-layout: fixed; border-collapse: collapse; }
  .pp-receipt .pp-section-title,
  .pp-receipt h1, .pp-receipt h2, .pp-receipt h3 {
    break-after: avoid;
    page-break-after: avoid;
  }
  .pp-receipt p, .pp-receipt .pp-para { orphans: 3; widows: 3; }
  .pp-receipt table tfoot {
    display: table-footer-group;
    break-before: avoid;
    page-break-before: avoid;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .pp-receipt table tfoot tr,
  .pp-receipt .pp-totals,
  .pp-receipt .pp-totals *,
  .pp-receipt .pp-subtotal,
  .pp-receipt .pp-tax,
  .pp-receipt .pp-grand-total,
  .pp-receipt [data-totals],
  .pp-receipt [data-totals-row] {
    break-inside: avoid;
    page-break-inside: avoid;
    break-before: avoid;
    page-break-before: avoid;
  }
  .pp-receipt table tbody tr:last-child {
    break-after: avoid;
    page-break-after: avoid;
  }
`;

/**
 * Dedicated print variant for the dual-copy payment-receipt template.
 * Applied via the `.pp-payment-receipt` marker class so it doesn't leak
 * onto other `.pp-receipt` documents (deposit slips, refund receipts).
 *
 * These rules mirror what the deposit/refund receipts already got via
 * `RECEIPT_SHARED_STYLES` — atomic copies, no clipped descendants, tear
 * line glued in place — plus the payment-receipt-specific dual-copy
 * flex layout that used to live inline in PaymentReceipt.tsx.
 */
export const PAYMENT_RECEIPT_PRINT_STYLES = `
  .pp-receipt.pp-payment-receipt .pp-copy {
    break-inside: avoid;
    page-break-inside: avoid;
    min-height: 0;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    overflow: visible;
  }
  .pp-receipt.pp-payment-receipt .pp-copy * {
    max-width: 100%;
    min-width: 0;
  }
  .pp-receipt.pp-payment-receipt img {
    max-width: 100%;
    height: auto;
  }
  .pp-receipt.pp-payment-receipt .pp-avoid-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; }
    .pp-receipt.pp-payment-receipt {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      color-adjust: exact;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      overflow: visible !important;
      /* Explicit page-break rules replace the historic hard height
         clamp + overflow:hidden. When both copies fit on one A4 the
         flex layout centers them with the tear line between; when a
         copy is unusually long it stays whole and the next copy flows
         to a fresh page instead of being clipped off the sheet. */
      display: flex;
      flex-direction: column;
      gap: 3mm;
      box-sizing: border-box;
    }
    .pp-receipt.pp-payment-receipt .pp-copy {
      break-inside: avoid;
      page-break-inside: avoid;
      display: flex;
      flex-direction: column;
      gap: 0;
      width: 100% !important;
      min-width: 0 !important;
      overflow: visible !important;
    }
    /* Client copy (2nd) breaks to a new page only if it cannot share
       the sheet with the Office copy — otherwise the browser keeps
       them together with the tear line between. */
    .pp-receipt.pp-payment-receipt .pp-copy + .pp-tear-line + .pp-copy {
      break-before: auto;
      page-break-before: auto;
    }
    .pp-receipt.pp-payment-receipt .pp-tear-line {
      break-inside: avoid;
      page-break-inside: avoid;
      break-after: avoid;
      page-break-after: avoid;
      margin: 0 !important;
    }
  }
`;

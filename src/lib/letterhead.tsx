/**
 * Letterhead system — Section F print styling.
 *
 * STYLE A — formal / notices:
 *   Used for: Demand Notice, Legal Notices (Legal / Final Legal / Cancellation /
 *   Possession Demand), Payment Plan.
 *   Layout: "MANAL ARCADE" logo centered top, gold divider below.
 *   Footer: phones + email + plot address.
 *
 * STYLE B — corporate / transactional:
 *   Used for: Agreement to Sell, Allotment Letter, Possession Letter,
 *   Provisional Possession, Payment Receipt, Deposit / Account Statement,
 *   Transfer Form.
 *   Layout: logo top-left, "PRECISE Realtors & Builders Pvt. Ltd." right of
 *   logo, NTN / CUI, tagline, phones, website, two office addresses, gold divider.
 *
 * All documents share the print rules: A4, 12.7 mm margins, Times New Roman 11pt
 * body / 12pt bold headings, single-border tables with alternating light grey
 * rows, PKR with comma formatting, dates DD-MM-YYYY, signature block lines.
 * Multiple documents page-break before each.
 */
import React from "react";
import { resolveLogoOption, LogoOption, FALLBACK_LOGO_URL } from "@/lib/logos";

export type LetterheadStyle = "A" | "B";

/** Map a DocumentView template `type` (route param) to the letterhead style. */
export function getDocStyle(type: string | undefined | null): LetterheadStyle {
  switch ((type || "").toLowerCase()) {
    // Style A — notices & schedules
    case "demand-notice":
    case "legal-notice":
    case "final-legal-notice":
    case "final-cancel-warning":
    case "cancellation-notice":
    case "possession-demand-notice":
    case "payment-plan":
      return "A";
    // Style B — transactional / contractual
    case "receipt":
    case "allotment":
    case "possession":
    case "prov-possession":
    case "deposit-summary":
    case "transfer-form":
    case "sale-agreement":
    default:
      return "B";
  }
}

/* ---------- brand tokens ---------- */
const NAVY = "#1B2B4B";
const GOLD = "#C9A84C";

/* Reserved header / footer heights (mm) — used by the print/preview layout
   to pad the safe content area away from the letterhead bands. */
export const HEADER_H_MM: Record<LetterheadStyle, number> = { A: 30, B: 38 };
export const FOOTER_H_MM: Record<LetterheadStyle, number> = { A: 18, B: 14 };

/* All sides 12.7mm = 0.5" — Print Mode spec. Header/footer take extra reserved space. */
export const PAGE_MARGIN_MM = 12.7;

/* ---------- React header / footer ---------- */

export function LetterheadHeader({
  style,
  logoId,
  docType,
  projectName,
}: {
  style: LetterheadStyle;
  logoId?: string;
  docType?: string | null;
  projectName?: string | null;
}) {
  const logo: LogoOption = resolveLogoOption(logoId, { style, docType });
  const logoTileBg = logo.bg === "dark" ? NAVY : "transparent";
  const isHeights = /heights/i.test(String(projectName || ""));
  const brandTitle = isHeights ? "MANAL HEIGHTS" : "MANAL ARCADE";

  if (style === "A") {
    return (
      <div style={{ textAlign: "center", fontFamily: '"Times New Roman", Georgia, serif' }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "4pt" }}>
          <div
            style={{
              background: logoTileBg,
              padding: logo.bg === "dark" ? "4pt 10pt" : "0",
              borderRadius: "3pt",
              display: "inline-block",
            }}
          >
            <img
              src={logo.url}
              alt="Logo"
              crossOrigin="anonymous"
              onError={(e) => {
                const img = e.currentTarget;
                if (img.src !== FALLBACK_LOGO_URL && FALLBACK_LOGO_URL) {
                  img.src = FALLBACK_LOGO_URL;
                  img.dataset.fallback = "1";
                }
              }}
              style={{ height: "48pt", width: "auto", display: "block" }}
            />
          </div>
        </div>
        <div
          style={{
            fontSize: "18pt",
            fontWeight: 700,
            letterSpacing: "3px",
            color: NAVY,
            lineHeight: 1.1,
          }}
        >
          {brandTitle}
        </div>
        <div
          style={{
            fontSize: "8.5pt",
            color: "#666",
            letterSpacing: "1px",
            marginTop: "1pt",
          }}
        >
          Crafting Landmarks · Creating Trust
        </div>
        <div
          style={{
            height: "1.6pt",
            background: GOLD,
            margin: "6pt 0 0 0",
            borderRadius: "1pt",
          }}
        />
      </div>
    );
  }
  // Style B
  return (
    <div style={{ fontFamily: '"Times New Roman", Georgia, serif', color: NAVY }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10pt" }}>
        <div
          style={{
            width: "54pt",
            height: "54pt",
            background: logoTileBg,
            border: logo.bg === "dark" ? "none" : `1pt solid ${GOLD}`,
            borderRadius: "4pt",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          <img
            src={logo.url}
            alt="Precise Realtors &amp; Builders logo"
            crossOrigin="anonymous"
            onError={(e) => {
              const img = e.currentTarget;
              if (img.src !== FALLBACK_LOGO_URL && FALLBACK_LOGO_URL) {
                img.src = FALLBACK_LOGO_URL;
                img.dataset.fallback = "1";
              }
            }}
            style={{ maxHeight: "50pt", maxWidth: "50pt", display: "block" }}
          />
        </div>
        <div style={{ flex: 1, lineHeight: 1.25 }}>
          <div style={{ fontSize: "14pt", fontWeight: 700, letterSpacing: "0.5px" }}>
            PRECISE Realtors &amp; Builders Pvt. Ltd.
          </div>
          <div style={{ fontSize: "8.5pt", color: "#444", marginTop: "1pt" }}>
            NTN # 8169355 &nbsp;|&nbsp; CUI # 0150809
          </div>
          <div style={{ fontSize: "9pt", color: GOLD, fontStyle: "italic", marginTop: "1pt" }}>
            “A vision for your living style”
          </div>
          <div style={{ fontSize: "8.5pt", color: "#333", marginTop: "2pt" }}>
            0344-5533767 &nbsp;|&nbsp; 0334-5533767
          </div>
          <div style={{ fontSize: "8.5pt", color: "#333" }}>
            www.precisegroupintl.com &nbsp;|&nbsp; precisegroup.pk
          </div>
          <div style={{ fontSize: "8.5pt", color: "#333" }}>
            Office #01, 1st Floor, Manal Heights, B-1 Markaz, B-17 Islamabad
          </div>
          <div style={{ fontSize: "8.5pt", color: "#333" }}>
            Office #01, Plot #1248, Block B, Multi Gardens, Sector B-17, Islamabad
          </div>
        </div>
      </div>
      <div style={{ height: "1.6pt", background: GOLD, marginTop: "6pt", borderRadius: "1pt" }} />
    </div>
  );
}

export function LetterheadFooter({ style }: { style: LetterheadStyle }) {
  if (style === "A") {
    return (
      <div
        style={{
          fontFamily: '"Times New Roman", Georgia, serif',
          color: "#333",
          fontSize: "8.5pt",
          textAlign: "center",
          lineHeight: 1.4,
        }}
      >
        <div
          style={{ height: "1pt", background: GOLD, marginBottom: "4pt", borderRadius: "0.5pt" }}
        />
        <div>
          033 45533767 &nbsp;|&nbsp; 0331 2220520 &nbsp;|&nbsp; 0344 5533767 &nbsp;|&nbsp;
          manalheights@gmail.com
        </div>
        <div>Plot # 04 Block B-Ext Main Double Road, MPCHS B-17 Islamabad</div>
      </div>
    );
  }
  return (
    <div
      style={{
        fontFamily: '"Times New Roman", Georgia, serif',
        color: "#666",
        fontSize: "8pt",
        textAlign: "center",
        borderTop: `0.6pt solid ${GOLD}`,
        paddingTop: "3pt",
      }}
    >
      Precise Realtors &amp; Builders Pvt. Ltd. &nbsp;·&nbsp; www.precisegroupintl.com
    </div>
  );
}

/* ---------- Compact running header / footer for pages 2+ ----------
 * Rendered inside a <thead>/<tfoot> of the print frame table so
 * Chromium/WebKit/Firefox all repeat them on every printed page.
 * Off-print the enclosing bands are `display: none` so screen previews
 * keep the existing full-letterhead-only look.
 */
export function CompactRunningHeader({
  docTitle,
  bookingId,
}: {
  docTitle?: string | null;
  bookingId?: string | null;
}) {
  const parts = [
    "PRECISE Realtors & Builders Pvt. Ltd.",
    docTitle ? String(docTitle) : null,
    bookingId ? `Booking ${bookingId}` : null,
  ].filter(Boolean);
  return <div className="print-running-inner">{parts.join("  ·  ")}</div>;
}

export function CompactRunningFooter() {
  return (
    <div className="print-running-inner">
      033 45533767 &nbsp;·&nbsp; manalheights@gmail.com &nbsp;·&nbsp; Plot #04 Block B-Ext, MPCHS
      B-17 Islamabad
    </div>
  );
}

/**
 * `<table>` wrapper that turns a document into a page-1 letterhead +
 * repeating compact header / footer on subsequent A4 pages. The consumer
 * renders the full LetterheadHeader (page-1 only) as the first flow
 * element inside `children`; the compact bands in thead/tfoot repeat
 * automatically because browsers duplicate `display: table-header-group`
 * and `display: table-footer-group` sections on every printed page.
 */
export function PrintFrame({
  docTitle,
  bookingId,
  children,
}: {
  docTitle?: string | null;
  bookingId?: string | null;
  children: React.ReactNode;
}) {
  return (
    <table className="print-frame">
      <thead className="print-running print-running-header">
        <tr>
          <td>
            <CompactRunningHeader docTitle={docTitle} bookingId={bookingId} />
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="print-frame-body">{children}</td>
        </tr>
      </tbody>
      <tfoot className="print-running print-running-footer">
        <tr>
          <td>
            <CompactRunningFooter />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/* ---------- Shared print/document CSS ---------- */
/**
 * Print rules enforced everywhere: A4 / 12.7 mm margins, Times New Roman,
 * single-border tables with alt rows, page-break before each .doc-sheet,
 * and a hard hide of UI chrome (sidebar, navbar, buttons, banners) when
 * printing. Importable into both the live preview pages and the
 * `printOnLetterhead` pop-up window.
 */
export const PRINT_CSS = `
  .doc-body { font-family: "Times New Roman", Georgia, serif; font-size: 11pt; line-height: 1.55; color: #111; }
  .doc-body h1, .doc-body h2, .doc-body h3, .doc-body .doc-heading { font-size: 12pt; font-weight: 700; margin: 0 0 8pt 0; }
  .doc-body p { margin: 0 0 6pt 0; orphans: 3; widows: 3; }
  .doc-body table { width: 100%; border-collapse: collapse; font-size: 10.5pt; margin: 6pt 0; page-break-inside: auto; break-inside: auto; }
  .doc-body table th, .doc-body table td { border: 0.6pt solid #444; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  .doc-body table th { background: #ececec; font-weight: 700; }
  .doc-body table tbody tr { page-break-inside: avoid; break-inside: avoid; }
  .doc-body table tbody tr:nth-child(even) td { background: #f6f6f6; }
  .doc-body table thead { display: table-header-group; }
  .doc-body table tfoot { display: table-footer-group; }
  .doc-body .signature-block { margin-top: 28pt; display: flex; justify-content: space-between; gap: 40pt; page-break-inside: avoid; break-inside: avoid; }
  .doc-body .signature-block .sig { flex: 1; }
  .doc-body .signature-block .sig .line { border-top: 0.8pt solid #111; margin-bottom: 3pt; height: 1px; }
  .doc-body .signature-block .sig .label { font-size: 9.5pt; color: #333; }
  .doc-sheet { page-break-after: auto; break-after: auto; page-break-inside: auto; break-inside: auto; }
  .doc-sheet:last-child { page-break-after: auto; break-after: auto; }
  .doc-sheet + .doc-sheet { page-break-before: always; break-before: page; }

  @media print {
    /*
     * Cross-browser A4 consistency:
     *  - @page margin:0 → the .doc-sheet owns the 12.7 mm padding so margins
     *    don't double up (Chrome/Edge default "Default margins" adds its own).
     *  - exact color printing so gold dividers, alt-row greys, badge fills
     *    survive in Chromium, WebKit and Firefox.
     *  - explicit mm sizing on .doc-sheet to neutralise printer scaling.
     *  - tell the user to pick "Default" margins + "Background graphics ON"
     *    via the @page rule and color-adjust below; the layout still prints
     *    correctly if they don't.
     */
    @page { size: A4 portrait; margin: 0; }
    @page :first { margin: 0; }
    @page :left  { margin: 0; }
    @page :right { margin: 0; }

    html, body {
      width: 210mm;
      background: #fff !important;
      margin: 0 !important;
      padding: 0 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }

    /* Hide all app chrome — sidebar, navbar, buttons, banners, toasts. */
    aside, nav, header.app-header, .app-shell-sidebar, .app-shell-header,
    [data-print-hide], .print\\:hidden, button, [role="toolbar"],
    [data-sonner-toaster], .toaster, .Toaster { display: none !important; }

    /* Release ancestor layout clipping (AppShell uses h-screen + overflow-hidden
       and main uses overflow-y-auto, both of which would otherwise truncate
       the printable document to a single viewport-height page). */
    body * { overflow: visible !important; }
    html, body, #root, main, .doc-shell, .doc-shell > * {
      height: auto !important;
      max-height: none !important;
      min-height: 0 !important;
    }

    .doc-sheet {
      width: 210mm !important;
      min-height: 297mm !important;
      height: auto !important;
      box-shadow: none !important;
      margin: 0 !important;
      outline: none !important;
      border: none !important;
      background: #fff !important;
      overflow: visible !important;
      /* Override the global "body:has(...) * { visibility: hidden }" print rule
         in styles.css so the document body actually paints on paper. */
      visibility: visible !important;
    }
    .doc-sheet *, .print-running, .print-running * {
      visibility: visible !important;
    }

    /* Prevent images and figures from splitting awkwardly across pages. */
    img, svg, figure, .avoid-break { page-break-inside: avoid; break-inside: avoid; }

    /* Keep hyperlinks readable in print (no underlines for inline body text,
       no "(url)" suffix that some UA stylesheets append). */
    a, a:visited { color: inherit; text-decoration: none; }
    a[href]::after { content: "" !important; }

    /* --- Running compact header / footer on every page (via <thead>/<tfoot>) ---
     * Browsers repeat table-header-group and table-footer-group sections on
     * every printed page. We wrap the doc content in a <table class="print-frame">
     * whose <thead> is the compact header and <tfoot> is the compact footer.
     * Page 1's full LetterheadHeader lives inside the tbody row, so it only
     * appears on the first page (natural top-of-flow behaviour). */
    table.print-frame {
      width: 100% !important;
      border-collapse: collapse !important;
      table-layout: fixed !important;
    }
    table.print-frame > thead { display: table-header-group !important; }
    table.print-frame > tfoot { display: table-footer-group !important; }
    table.print-frame > thead > tr > td,
    table.print-frame > tfoot > tr > td,
    table.print-frame > tbody > tr > td.print-frame-body {
      border: none !important;
      padding: 0 !important;
      background: transparent !important;
    }
    .print-running {
      font-family: "Times New Roman", Georgia, serif;
      color: #1B2B4B;
      background: #fff !important;
    }
    .print-running-header .print-running-inner {
      padding: 2mm 4mm 3mm 4mm;
      text-align: center;
      font-size: 9pt;
      line-height: 1.2;
      border-bottom: 0.6pt solid #C9A84C;
      margin-bottom: 3mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .print-running-header .print-running-inner::after {
      content: "Page " counter(page);
      font-weight: 500;
    }
    .print-running-footer .print-running-inner {
      padding: 3mm 4mm 2mm 4mm;
      text-align: center;
      font-size: 8pt;
      line-height: 1.2;
      color: #555;
      border-top: 0.6pt solid #C9A84C;
      margin-top: 4mm;
    }
    /* Legacy mask classes: no-op now that thead/tfoot handle repetition. */
    .print-page1-mask, .print-page1-footer-mask {
      display: block;
      background: transparent;
    }
  }

  /* Off-print: the compact bands are hidden — screen preview keeps the
     existing full-letterhead-only look. */
  thead.print-running, tfoot.print-running { display: none; }

`;

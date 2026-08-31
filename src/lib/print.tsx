import { renderToStaticMarkup } from "react-dom/server";
import {
  LetterheadHeader,
  LetterheadFooter,
  LetterheadStyle,
  HEADER_H_MM,
  FOOTER_H_MM,
  PAGE_MARGIN_MM,
  PRINT_CSS,
} from "@/lib/letterhead";
import { loadSelectedLogoId } from "@/lib/logos";
import letterheadAsset from "@/assets/precise-letterhead.jpg.asset.json";

/** Legacy background-letterhead URL — kept for any consumer still using it. */
export const LETTERHEAD_URL = letterheadAsset.url;

/**
 * Open a print pop-up rendering a single document on the chosen letterhead
 * style (A or B). Enforces Section F print rules: A4, 12.7 mm margins,
 * Times New Roman 11pt body, single-border tables with alt rows.
 */
export function printOnLetterhead(opts: {
  title: string;
  body: string;
  /** Render body as raw HTML when true; otherwise it's escaped plain text. */
  html?: boolean;
  /** Letterhead style — defaults to B (transactional). */
  style?: LetterheadStyle;
  /** Logo id from `LOGO_OPTIONS`. Defaults to the last user-selected logo. */
  logoId?: string;
  /** Project name — drives the Style A brand title (Manal Heights vs Manal Arcade). */
  projectName?: string | null;
}) {
  const {
    title,
    body,
    html = false,
    style = "B",
    logoId = loadSelectedLogoId(),
    projectName,
  } = opts;

  const headerHtml = renderToStaticMarkup(
    <LetterheadHeader style={style} logoId={logoId} projectName={projectName} />,
  );

  const footerHtml = renderToStaticMarkup(<LetterheadFooter style={style} />);

  const headerH = HEADER_H_MM[style];
  const footerH = FOOTER_H_MM[style];

  const win = window.open("", "_blank", "width=900,height=1100");
  if (!win) throw new Error("Pop-up blocked — please allow pop-ups to print.");

  const safe = html
    ? body
    : body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body { font-family: "Times New Roman", Georgia, serif; font-size: 11pt; line-height: 1.55; }
  .doc-sheet {
    position: relative;
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: ${PAGE_MARGIN_MM}mm;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
  .doc-body-wrap { flex: 1; padding: 6mm 0 4mm 0; }
  pre.plain { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: inherit; line-height: 1.6; margin: 0; }
  ${PRINT_CSS}
  @media screen { body { background: #e5e7eb; padding: 12mm 0; } .doc-sheet { box-shadow: 0 1px 12px rgba(0,0,0,.15); background: #fff; } }
</style></head><body>
<div class="doc-sheet">
  ${headerHtml}
  <div class="doc-body-wrap doc-body">${html ? safe : `<pre class="plain">${safe}</pre>`}</div>
  ${footerHtml}
</div>
<script>
  setTimeout(() => { window.focus(); window.print(); }, 200);
</script>
</body></html>`);
  win.document.close();
}

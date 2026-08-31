import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Download, History, Trash2 } from "lucide-react";
import { tryCopyToClipboard } from "@/lib/shareLink";
import {
  buildSanitizerHistoryCsv,
  buildSanitizerHistoryJson,
  clearSanitizerHistory,
  readSanitizerHistory,
} from "@/lib/sanitizerHistory";

export type ResetChange = {
  /** The query-param key that was sanitized (e.g. "risk", "kpi"). */
  key: string;
  /** Original value as it appeared in the URL. Empty string means missing. */
  from: string;
  /** Replacement value, or the sentinel "removed" if the param was dropped. */
  to: string;
};

export interface UrlSanitizerDisclosureProps {
  changes: ResetChange[];
  /** Map of param-key → human-readable label (e.g. "Risk Level"). */
  paramLabels: Record<string, string>;
  /**
   * Sheet name used for the XLSX export. Defaults to "Invalid params".
   * Excel caps sheet names at 31 chars and forbids `: \ / ? * [ ]`, so the
   * value is sanitized and truncated before being written.
   */
  xlsxSheetName?: string;
}

/** Excel sheet-name constraints: max 31 chars, no `: \ / ? * [ ]`. */
function sanitizeSheetName(raw: string | undefined, fallback = "Invalid params"): string {
  const cleaned = (raw ?? "").replace(/[\\/?*[\]:]/g, " ").trim();
  const safe = cleaned.length > 0 ? cleaned : fallback;
  return safe.slice(0, 31);
}

const TRIGGER_ID = "url-sanitizer-details-toggle";
const PANEL_ID = "url-sanitizer-details-panel";

/**
 * Accessible disclosure used inside the URL-sanitizer banner.
 *
 * Disclosure pattern wiring (WAI-ARIA APG "Disclosure"):
 *   - The trigger is a real <button> with a stable `id` so the panel can
 *     reference it back via `aria-labelledby`.
 *   - `aria-controls={PANEL_ID}` points at the breakdown container so AT can
 *     describe / jump to the controlled region.
 *   - `aria-expanded` mirrors the open state ("true" / "false" — never
 *     omitted) so AT users hear expanded/collapsed transitions.
 *   - The panel uses `role="group"` + `aria-labelledby={TRIGGER_ID}` so a
 *     user navigating into it hears the trigger's accessible name as the
 *     group label.
 *   - The panel itself is `aria-hidden="true"` because the sibling sr-only
 *     list in the banner already conveys the same information; this prevents
 *     double announcement of the visible breakdown.
 *   - A polite `role="status"` region announces the expand/collapse state
 *     change without interrupting the assertive banner.
 */
export function UrlSanitizerDisclosure({
  changes,
  paramLabels,
  xlsxSheetName,
}: UrlSanitizerDisclosureProps) {
  const resolvedSheetName = sanitizeSheetName(xlsxSheetName);
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [copied, setCopied] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const userToggledRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any pending "Copied" reset on unmount so a late timer can't fire a
  // state update against an unmounted component (would trigger React act()
  // warnings in tests and leak work in production).
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!userToggledRef.current) return;
    userToggledRef.current = false;
    const raf =
      typeof window !== "undefined" && window.requestAnimationFrame
        ? window.requestAnimationFrame(() => toggleRef.current?.focus())
        : (setTimeout(() => toggleRef.current?.focus(), 0) as unknown as number);
    return () => {
      if (typeof window !== "undefined" && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(raf);
      } else {
        clearTimeout(raf as unknown as ReturnType<typeof setTimeout>);
      }
    };
  }, [open]);

  const count = changes.length;
  const noun = count === 1 ? "parameter" : "parameters";
  const changeNoun = count === 1 ? "change" : "changes";

  const handleToggle = () => {
    const next = !open;
    userToggledRef.current = true;
    setOpen(next);
    setAnnouncement(
      next
        ? `Invalid parameter details expanded. Showing ${count} ${changeNoun}.`
        : "Invalid parameter details collapsed.",
    );
  };

  const buildRows = () =>
    changes.map((c) => ({
      key: c.key,
      label: paramLabels[c.key] ?? c.key,
      original: c.from,
      outcome: c.to === "removed" ? "removed" : "replaced",
      replacement: c.to === "removed" ? "" : c.to,
    }));

  const downloadBlob = (filename: string, mime: string, body: string) => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revoke so the browser has a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      count,
      changes: buildRows(),
    };
    downloadBlob(
      "url-sanitizer-breakdown.json",
      "application/json",
      JSON.stringify(payload, null, 2),
    );
  };

  const handleExportCsv = () => {
    const esc = (v: string) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["key", "label", "original", "outcome", "replacement"];
    const lines = [header.join(",")];
    for (const r of buildRows()) {
      lines.push([r.key, r.label, r.original, r.outcome, r.replacement].map(esc).join(","));
    }
    downloadBlob(
      "url-sanitizer-breakdown.csv",
      "text/csv;charset=utf-8",
      lines.join("\r\n") + "\r\n",
    );
  };

  const handleExportXlsx = async () => {
    const XLSX = await import("xlsx");
    const rows = buildRows();
    const aoa = [
      ["key", "label", "original", "outcome", "replacement"],
      ...rows.map((r) => [r.key, r.label, r.original, r.outcome, r.replacement]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 24 }, { wch: 12 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, resolvedSheetName);
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "url-sanitizer-breakdown.xlsx";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadString = (filename: string, mime: string, body: string) =>
    downloadBlob(filename, mime, body);

  const historyTimestamp = () => new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");

  const handleHistoryJson = () => {
    const entries = readSanitizerHistory();
    downloadString(
      `url-sanitizer-history-${historyTimestamp()}.json`,
      "application/json",
      buildSanitizerHistoryJson(entries),
    );
    setAnnouncement(`Downloaded sanitizer history (${entries.length} entries) as JSON.`);
  };

  const handleHistoryCsv = () => {
    const entries = readSanitizerHistory();
    downloadString(
      `url-sanitizer-history-${historyTimestamp()}.csv`,
      "text/csv;charset=utf-8",
      buildSanitizerHistoryCsv(entries),
    );
    setAnnouncement(`Downloaded sanitizer history (${entries.length} entries) as CSV.`);
  };

  const handleHistoryXlsx = async () => {
    const entries = readSanitizerHistory();
    const XLSX = await import("xlsx");
    const header = [
      "at",
      "url",
      "finalTab",
      "finalKpi",
      "kpiLabel",
      "key",
      "original",
      "outcome",
      "replacement",
    ];
    const aoa: (string | number)[][] = [header];
    for (const e of entries) {
      if (e.changes.length === 0) {
        aoa.push([
          e.at,
          e.url,
          e.finalTab ?? "",
          e.finalKpi ?? "",
          e.kpiLabel ?? "",
          "",
          "",
          "",
          "",
        ]);
        continue;
      }
      for (const c of e.changes) {
        const outcome = c.to === "removed" ? "removed" : "replaced";
        const replacement = c.to === "removed" ? "" : c.to;
        aoa.push([
          e.at,
          e.url,
          e.finalTab ?? "",
          e.finalKpi ?? "",
          e.kpiLabel ?? "",
          c.key,
          c.from,
          outcome,
          replacement,
        ]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 24 },
      { wch: 48 },
      { wch: 10 },
      { wch: 14 },
      { wch: 20 },
      { wch: 12 },
      { wch: 22 },
      { wch: 12 },
      { wch: 22 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName("Sanitizer history"));
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `url-sanitizer-history-${historyTimestamp()}.xlsx`;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setAnnouncement(`Downloaded sanitizer history (${entries.length} entries) as XLSX.`);
  };

  const handleHistoryClear = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Clear all saved sanitizer history? This cannot be undone.")
    ) {
      return;
    }
    clearSanitizerHistory();
    setAnnouncement("Sanitizer history cleared.");
  };

  const handleCopyJson = async () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      count,
      changes: buildRows(),
    };
    const ok = await tryCopyToClipboard(JSON.stringify(payload, null, 2));
    if (ok) {
      setCopied(true);
      setAnnouncement(`Copied ${count} ${changeNoun} as JSON to clipboard.`);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 1500);
    } else {
      setAnnouncement("Copy to clipboard failed.");
    }
  };

  const exportDisabled = count === 0;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          ref={toggleRef}
          id={TRIGGER_ID}
          type="button"
          aria-expanded={open}
          aria-controls={PANEL_ID}
          aria-label={`${open ? "Hide" : "Show"} details for ${count} invalid ${noun}`}
          onClick={handleToggle}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-100 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          <ChevronRight
            className={`h-3 w-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
          {open ? "Hide details" : `Show details (${count})`}
        </button>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Export invalid-params breakdown"
        >
          <button
            type="button"
            data-testid="url-sanitizer-export-json"
            onClick={handleExportJson}
            disabled={exportDisabled}
            aria-label={`Download ${count} invalid ${noun} as JSON`}
            title="Download as JSON"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-300/70 dark:border-amber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-100 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            JSON
          </button>
          <button
            type="button"
            data-testid="url-sanitizer-export-csv"
            onClick={handleExportCsv}
            disabled={exportDisabled}
            aria-label={`Download ${count} invalid ${noun} as CSV`}
            title="Download as CSV"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-300/70 dark:border-amber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-100 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            CSV
          </button>
          <button
            type="button"
            data-testid="url-sanitizer-export-xlsx"
            onClick={handleExportXlsx}
            disabled={exportDisabled}
            aria-label={`Download ${count} invalid ${noun} as Excel workbook`}
            title="Download as XLSX"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-300/70 dark:border-amber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-100 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            XLSX
          </button>
          <button
            type="button"
            data-testid="url-sanitizer-copy-json"
            onClick={handleCopyJson}
            disabled={exportDisabled}
            aria-label={`Copy ${count} invalid ${noun} as JSON to clipboard`}
            title="Copy as JSON"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-300/70 dark:border-amber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-100 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copied ? (
              <Check className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Copy className="h-3 w-3" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>
        <div
          className="flex items-center gap-1 border-l border-amber-300/50 dark:border-amber-700/40 pl-2"
          role="group"
          aria-label="Sanitizer history across sessions"
        >
          <span className="text-[11px] text-amber-800/80 dark:text-amber-100/70 inline-flex items-center gap-1">
            <History className="h-3 w-3" aria-hidden="true" />
            History:
          </span>
          <button
            type="button"
            data-testid="url-sanitizer-history-json"
            onClick={handleHistoryJson}
            aria-label="Download full sanitizer history as JSON"
            title="Download history as JSON"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-300/70 dark:border-amber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-100 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            JSON
          </button>
          <button
            type="button"
            data-testid="url-sanitizer-history-csv"
            onClick={handleHistoryCsv}
            aria-label="Download full sanitizer history as CSV"
            title="Download history as CSV"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-300/70 dark:border-amber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-100 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            CSV
          </button>
          <button
            type="button"
            data-testid="url-sanitizer-history-xlsx"
            onClick={handleHistoryXlsx}
            aria-label="Download full sanitizer history as Excel workbook"
            title="Download history as XLSX"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-300/70 dark:border-amber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-100 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            XLSX
          </button>
          <button
            type="button"
            data-testid="url-sanitizer-history-clear"
            onClick={handleHistoryClear}
            aria-label="Clear saved sanitizer history"
            title="Clear sanitizer history"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-300/70 dark:border-amber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-100 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            Clear
          </button>
        </div>
      </div>
      {open && (
        <ul
          id={PANEL_ID}
          role="group"
          aria-labelledby={TRIGGER_ID}
          aria-hidden="true"
          className="mt-2 space-y-1 text-[12px] leading-snug"
        >
          {changes.map((c, i) => {
            const label = paramLabels[c.key] ?? c.key;
            const from = c.from ? `"${c.from}"` : "(missing)";
            const removed = c.to === "removed";
            return (
              <li key={`vis-${c.key}-${i}`} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-mono text-amber-900 dark:text-amber-100">{c.key}</span>
                <span className="text-amber-800/70 dark:text-amber-100/70">({label})</span>
                <span className="font-mono text-amber-900/90 dark:text-amber-100/90">{from}</span>
                {removed ? (
                  <span className="inline-flex items-center rounded-sm bg-amber-200/70 dark:bg-amber-800/60 px-1 text-[10px] font-semibold uppercase tracking-wide">
                    removed
                  </span>
                ) : (
                  <>
                    <span className="text-amber-700 dark:text-amber-200">→</span>
                    <span className="font-mono text-amber-900 dark:text-amber-100">"{c.to}"</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="url-sanitizer-details-live"
        className="sr-only"
      >
        {announcement}
      </div>
    </div>
  );
}

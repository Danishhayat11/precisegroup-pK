/**
 * Pure helpers for Dashboard URL query sanitization and defaults.
 * Mirrors the logic embedded in src/pages/Dashboard.tsx so it can be
 * unit-tested in isolation. Update both places together.
 */

export const DRILL_KEYS = [
  "sell",
  "cash",
  "adj_allowed",
  "adj_realised",
  "commission",
  "received",
  "pending",
  "overdue",
  "cancelled",
] as const;
export type DrillKey = (typeof DRILL_KEYS)[number];

export const RISK_VALUES = ["ALL", "HIGH", "MEDIUM"] as const;
export type RiskValue = (typeof RISK_VALUES)[number];

export const AGE_VALUES = ["ALL", "1-30", "31-60", "61-90", "90+"] as const;
export type AgeValue = (typeof AGE_VALUES)[number];

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const OVERDUE_SORT_KEYS = ["client_name", "unit_id", "_ov", "_amt", "_risk"] as const;
export type OverdueSortKey = (typeof OVERDUE_SORT_KEYS)[number];

export const DEFAULTS = {
  risk: "ALL" as RiskValue,
  age: "ALL" as AgeValue,
  overdueSort: { key: "_amt" as OverdueSortKey, dir: "desc" as "asc" | "desc" },
  pageSize: 25 as (typeof PAGE_SIZES)[number],
  page: 1,
};

const isInt = (s: string | null) =>
  !!s && Number.isFinite(Number(s)) && Number(s) > 0 && Number.isInteger(Number(s));
const isSize = (s: string | null) => !!s && (PAGE_SIZES as readonly number[]).includes(Number(s));

export const URL_VALIDATORS: Record<string, (v: string | null) => boolean> = {
  kpi: (v) => !!v && (DRILL_KEYS as readonly string[]).includes(v),
  risk: (v) => v === "HIGH" || v === "MEDIUM" || v === "ALL",
  age: (v) => v === "1-30" || v === "31-60" || v === "61-90" || v === "90+" || v === "ALL",
  osort: (v) => {
    if (!v) return false;
    const [k, d] = v.split(".");
    return (OVERDUE_SORT_KEYS as readonly string[]).includes(k) && (d === "asc" || d === "desc");
  },
  osize: isSize,
  opage: isInt,
  ksort: (v) => {
    if (!v) return false;
    const [i, d] = v.split(".");
    const n = Number(i);
    return (
      Number.isFinite(n) &&
      Number.isInteger(n) &&
      n >= 0 &&
      n <= 32 &&
      (d === "asc" || d === "desc")
    );
  },
  ksize: isSize,
  kpage: isInt,
  preset: (v) => !!v && v.length > 0 && v.length <= 64,
  oexp: (v) => !!v && v.length > 0 && v.length <= 64,
  kexp: (v) =>
    !!v &&
    Number.isFinite(Number(v)) &&
    Number.isInteger(Number(v)) &&
    Number(v) >= 0 &&
    Number(v) <= 100000,
  oq: (v) => typeof v === "string" && v.length > 0 && v.length <= 128,
  kq: (v) => typeof v === "string" && v.length > 0 && v.length <= 128,
  tab: (v) => v === "overdue" || v === "kpi",
};

const KPI_DEPENDENT_KEYS = ["ksort", "ksize", "kpage", "kexp", "kq"] as const;

/**
 * Strip unknown / invalid params from a search string. Also redirects
 * `tab=kpi` without a valid `kpi` to the safest default (`kpi=overdue`)
 * so a shared link still opens the KPI sheet. Returns the sanitized
 * search string (without leading "?"), whether anything changed, and the
 * list of keys that were reset (deduped, in deletion order) so callers
 * can surface a user-facing message.
 */
export function sanitizeDashboardSearch(search: string): {
  search: string;
  changed: boolean;
  stripped: string[];
} {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const stripped: string[] = [];
  // Snapshot intent signals BEFORE stripping:
  //  - any valid KPI sub-param survives and implies the user wanted the sheet
  //  - an invalid `kpi` itself still signals KPI intent (stale deep-link)
  //  - any KPI sub-param being present at all (even invalid) signals intent
  const hadValidKpiSub = KPI_DEPENDENT_KEYS.some((k) => sp.has(k) && URL_VALIDATORS[k](sp.get(k)));
  const hadAnyKpiSub = KPI_DEPENDENT_KEYS.some((k) => sp.has(k));
  const hadInvalidKpi = sp.has("kpi") && !URL_VALIDATORS.kpi(sp.get("kpi"));
  for (const key of Object.keys(URL_VALIDATORS)) {
    if (sp.has(key) && !URL_VALIDATORS[key](sp.get(key))) {
      sp.delete(key);
      stripped.push(key);
    }
  }
  // Recover to kpi=overdue when intent is clear: tab=kpi, a valid sub-param,
  // an invalid kpi value, or any sub-param present.
  if (
    !sp.has("kpi") &&
    (sp.get("tab") === "kpi" || hadValidKpiSub || hadInvalidKpi || hadAnyKpiSub)
  ) {
    sp.set("kpi", "overdue");
    if (!stripped.includes("kpi")) stripped.push("kpi");
  }

  // Keep tab and kpi in sync when a valid kpi survives.
  if (sp.has("kpi") && !sp.has("tab")) {
    sp.set("tab", "kpi");
  }
  if (!sp.has("kpi")) {
    for (const k of KPI_DEPENDENT_KEYS) {
      if (sp.has(k)) {
        sp.delete(k);
        stripped.push(k);
      }
    }
  }
  const unique = Array.from(new Set(stripped));
  return { search: sp.toString(), changed: unique.length > 0, stripped: unique };
}

/** Read tab with fallback to "overdue". */
export function readTab(search: string): "overdue" | "kpi" {
  const v = new URLSearchParams(search).get("tab");
  return v === "kpi" ? "kpi" : "overdue";
}

/** Read risk with fallback. */
export function readRisk(search: string): RiskValue {
  const v = new URLSearchParams(search).get("risk");
  return URL_VALIDATORS.risk(v) ? (v as RiskValue) : DEFAULTS.risk;
}

/** Read age with fallback. */
export function readAge(search: string): AgeValue {
  const v = new URLSearchParams(search).get("age");
  return URL_VALIDATORS.age(v) ? (v as AgeValue) : DEFAULTS.age;
}

/** Read kpi key or null. */
export function readKpi(search: string): DrillKey | null {
  const v = new URLSearchParams(search).get("kpi");
  return URL_VALIDATORS.kpi(v) ? (v as DrillKey) : null;
}

/** Read overdue sort with fallback. */
export function readOverdueSort(search: string) {
  const v = new URLSearchParams(search).get("osort");
  if (!URL_VALIDATORS.osort(v)) return DEFAULTS.overdueSort;
  const [k, d] = (v as string).split(".");
  return { key: k as OverdueSortKey, dir: d as "asc" | "desc" };
}

/** Read page size with fallback. */
export function readPageSize(search: string, key: "osize" | "ksize"): (typeof PAGE_SIZES)[number] {
  const v = new URLSearchParams(search).get(key);
  return URL_VALIDATORS[key](v) ? (Number(v) as (typeof PAGE_SIZES)[number]) : DEFAULTS.pageSize;
}

/** Read page number with fallback. */
export function readPage(search: string, key: "opage" | "kpage"): number {
  const v = new URLSearchParams(search).get(key);
  return URL_VALIDATORS[key](v) ? Number(v) : DEFAULTS.page;
}

/** Read KPI sort: { idx, dir } | null. */
export function readKpiSort(search: string) {
  const v = new URLSearchParams(search).get("ksort");
  if (!URL_VALIDATORS.ksort(v)) return null;
  const [i, d] = (v as string).split(".");
  return { idx: Number(i), dir: d as "asc" | "desc" };
}

// ---------- Toast description builder ----------

export const KPI_DRILL_LABELS: Record<DrillKey, string> = {
  sell: "Total Sell Value",
  cash: "Cash Recovered",
  adj_allowed: "Total Adjustment Approved",
  adj_realised: "Total Adjustment Realised",
  commission: "Commission Paid",
  received: "Total Received",
  pending: "Total Pending Balance",
  overdue: "Current Overdue Amount",
  cancelled: "Total Cancelled",
};
// Legacy/alias keys some links may carry — labels for toast display only.
const KPI_LABEL_ALIASES: Record<string, string> = {
  adj_approved: "Total Adjustment Approved",
};

export type SanitizationChange = { key: string; from: string; to: string };

export type SanitizationReport = {
  changes: SanitizationChange[];
  removed: SanitizationChange[];
  adjusted: SanitizationChange[];
  resetKeys: string[];
  finalTab: "overdue" | "kpi";
  finalKpi: string | null;
  kpiLabel: string | null;
  /** Final clamped row index (1-based) when kexp was adjusted, else null. */
  finalKexpRow: number | null;
  title: string;
  description: string;
};

const truncate = (s: string) => (s.length > 24 ? s.slice(0, 21) + "…" : s);

/**
 * Mirrors the sanitizer behavior used in src/pages/Dashboard.tsx but returns
 * a structured report with per-param from/to values, the final tab/kpi the
 * user lands on, and a human-readable description suitable for a toast.
 * Returns null when nothing was invalid.
 */
export function describeSanitization(search: string): SanitizationReport | null {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const changes: SanitizationChange[] = [];

  const hadValidKpiSub = KPI_DEPENDENT_KEYS.some((k) => sp.has(k) && URL_VALIDATORS[k](sp.get(k)));
  const hadAnyKpiSub = KPI_DEPENDENT_KEYS.some((k) => sp.has(k));
  const hadInvalidKpi = sp.has("kpi") && !URL_VALIDATORS.kpi(sp.get("kpi"));
  const rawKexp = sp.get("kexp");
  const kexpInvalid = sp.has("kexp") && !URL_VALIDATORS.kexp(rawKexp);

  // 1) Strip invalid params (kexp clamped below if kpi survives).
  for (const key of Object.keys(URL_VALIDATORS)) {
    if (key === "kexp") continue;
    if (sp.has(key) && !URL_VALIDATORS[key](sp.get(key))) {
      changes.push({ key, from: truncate(sp.get(key) ?? ""), to: "removed" });
      sp.delete(key);
    }
  }
  // 2) Recover kpi=overdue when intent is clear.
  if (
    !sp.has("kpi") &&
    (sp.get("tab") === "kpi" || hadValidKpiSub || hadInvalidKpi || hadAnyKpiSub)
  ) {
    sp.set("kpi", "overdue");
    const existing = changes.find((c) => c.key === "kpi");
    if (existing) existing.to = "overdue";
    else changes.push({ key: "kpi", from: "(missing)", to: "overdue" });
  }
  // 3) Sync tab to kpi when needed.
  if (sp.has("kpi") && !sp.has("tab")) sp.set("tab", "kpi");
  // 4) Clamp kexp when kpi survives, otherwise drop sub-params.
  if (sp.has("kpi") && kexpInvalid) {
    const n = Number(rawKexp);
    const clamped = Number.isFinite(n) && n > 100000 ? 100000 : 0;
    sp.set("kexp", String(clamped));
    changes.push({ key: "kexp", from: truncate(rawKexp ?? ""), to: `row #${clamped + 1}` });
  }
  if (!sp.has("kpi")) {
    for (const k of KPI_DEPENDENT_KEYS) {
      if (sp.has(k)) {
        changes.push({ key: k, from: truncate(sp.get(k) ?? ""), to: "removed" });
        sp.delete(k);
      }
    }
  }

  if (changes.length === 0) return null;

  const removed = changes.filter((c) => c.to === "removed");
  const adjusted = changes.filter((c) => c.to !== "removed");
  const fmtKV = (c: SanitizationChange) => `${c.key}="${c.from}"`;
  const fmtAdj = (c: SanitizationChange) => `${c.key}="${c.from}" → ${c.to}`;

  const finalTab: "overdue" | "kpi" = sp.get("tab") === "kpi" ? "kpi" : "overdue";
  const finalKpi = sp.get("kpi");
  const kpiLabel = finalKpi
    ? (KPI_DRILL_LABELS[finalKpi as DrillKey] ?? KPI_LABEL_ALIASES[finalKpi] ?? finalKpi)
    : null;

  const kpiWasAdjusted = adjusted.some((c) => c.key === "kpi");
  const kexpChange = adjusted.find((c) => c.key === "kexp");
  const finalKexpRow = kexpChange
    ? (() => {
        const m = /row #(\d+)/.exec(kexpChange.to);
        return m ? Number(m[1]) : null;
      })()
    : null;

  const parts: string[] = [];
  if (removed.length) parts.push(`Invalid (removed): ${removed.map(fmtKV).join(", ")}`);
  if (adjusted.length) parts.push(`Adjusted: ${adjusted.map(fmtAdj).join(", ")}`);

  // When both kpi and kexp were stale, surface the combined resolution so the
  // user sees the resolved KPI name and clamped row together in one message.
  if (finalTab === "kpi" && finalKpi && kpiWasAdjusted && finalKexpRow != null) {
    parts.push(`Resolved: KPI “${kpiLabel}” at row #${finalKexpRow} (kpi + kexp were both stale)`);
  } else if (finalTab === "kpi" && finalKpi && finalKexpRow != null) {
    parts.push(`Landing on: KPI tab → “${kpiLabel}” at row #${finalKexpRow}`);
  } else {
    parts.push(
      finalTab === "kpi" && finalKpi
        ? `Landing on: KPI tab → “${kpiLabel}”`
        : `Landing on: Overdue tab`,
    );
  }

  return {
    changes,
    removed,
    adjusted,
    resetKeys: Array.from(new Set(changes.map((c) => c.key))),
    finalTab,
    finalKpi: finalKpi ?? null,
    kpiLabel,
    finalKexpRow,
    title: "Some link parameters were invalid",
    description: parts.join(" · "),
  };
}

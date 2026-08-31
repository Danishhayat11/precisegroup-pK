/**
 * Logo registry — used by letterhead header for printed documents.
 * Users can pick which logo prints on each document; default is Auto, which
 * matches the logo to the document type / letterhead style.
 */
import manalColor from "@/assets/logos/manal-arcade-color.png.asset.json";
import manalWhite from "@/assets/logos/manal-arcade-white.png.asset.json";
import manalOrange from "@/assets/logos/manal-arcade-orange.png.asset.json";
import preciseColor from "@/assets/logos/precise-group-color.png.asset.json";
import preciseWhite from "@/assets/logos/precise-group-white.png.asset.json";
// New brand pack uploaded May 2025 — adds full wordmark variants and the Manal Associate brand.
import manalHeightsWordmarkColor from "@/assets/logos/manal-heights-wordmark-color.png.asset.json";
import manalHeightsWordmarkWhite from "@/assets/logos/manal-heights-wordmark-white.png.asset.json";
import manalArcadeMarkColor from "@/assets/logos/manal-arcade-mark-color.png.asset.json";
import manalArcadeMarkWhite from "@/assets/logos/manal-arcade-mark-white.png.asset.json";
import manalAssociateColor from "@/assets/logos/manal-associate-color.png.asset.json";
import manalAssociateWhite from "@/assets/logos/manal-associate-white.png.asset.json";
import preciseWordmarkColor from "@/assets/logos/precise-wordmark-color.png.asset.json";
import preciseWordmarkWhite from "@/assets/logos/precise-wordmark-white.png.asset.json";
import preciseRealtorsBuildersColor from "@/assets/logos/precise-realtors-builders-color.png.asset.json";

export type LogoOption = {
  id: string;
  label: string;
  url: string;
  /** Optional grouping shown in the picker. */
  group?: string;
  /** Logo glyph color — used to pick a background tile in preview/print so
   *  white-on-transparent logos remain visible. */
  bg?: "light" | "dark";
};

export const AUTO_LOGO_ID = "auto";

/** Concrete logo assets (excludes the Auto pseudo-option).
 *  Ordered by brand → preferred (color wordmark) → variants. New ids are
 *  appended so saved per-document selections keep resolving. */
export const LOGO_OPTIONS: LogoOption[] = [
  // ── Manal Heights ──────────────────────────────────────────────────────
  {
    id: "manal-heights-wordmark-color",
    label: "Manal Heights — Wordmark (Color)",
    url: manalHeightsWordmarkColor.url,
    group: "Manal Heights",
    bg: "light",
  },
  {
    id: "manal-heights-wordmark-white",
    label: "Manal Heights — Wordmark (White on dark)",
    url: manalHeightsWordmarkWhite.url,
    group: "Manal Heights",
    bg: "dark",
  },
  {
    id: "manal-color",
    label: "Manal Heights — Mark only (Color)",
    url: manalColor.url,
    group: "Manal Heights",
    bg: "dark",
  },
  {
    id: "manal-white",
    label: "Manal Heights — Mark only (White)",
    url: manalWhite.url,
    group: "Manal Heights",
    bg: "dark",
  },
  {
    id: "manal-orange",
    label: "Manal Heights — Mark only (Orange)",
    url: manalOrange.url,
    group: "Manal Heights",
    bg: "dark",
  },
  // ── Manal Arcade (M monogram) ─────────────────────────────────────────
  {
    id: "manal-arcade-mark-color",
    label: "Manal Arcade — M monogram (Color)",
    url: manalArcadeMarkColor.url,
    group: "Manal Arcade",
    bg: "light",
  },
  {
    id: "manal-arcade-mark-white",
    label: "Manal Arcade — M monogram (White on dark)",
    url: manalArcadeMarkWhite.url,
    group: "Manal Arcade",
    bg: "dark",
  },
  // ── Manal Associate ───────────────────────────────────────────────────
  {
    id: "manal-associate-color",
    label: "Manal Associate (Color)",
    url: manalAssociateColor.url,
    group: "Manal Associate",
    bg: "light",
  },
  {
    id: "manal-associate-white",
    label: "Manal Associate (White on dark)",
    url: manalAssociateWhite.url,
    group: "Manal Associate",
    bg: "dark",
  },
  // ── Precise Realtors & Builders ───────────────────────────────────────
  {
    id: "precise-wordmark-color",
    label: "Precise — Wordmark (Color)",
    url: preciseWordmarkColor.url,
    group: "Precise Realtors & Builders",
    bg: "light",
  },
  {
    id: "precise-wordmark-white",
    label: "Precise — Wordmark (White on dark)",
    url: preciseWordmarkWhite.url,
    group: "Precise Realtors & Builders",
    bg: "dark",
  },
  {
    id: "precise-realtors-builders-color",
    label: "Precise — Crew badge (Color)",
    url: preciseRealtorsBuildersColor.url,
    group: "Precise Realtors & Builders",
    bg: "light",
  },
  {
    id: "precise-color",
    label: "Precise Group — Legacy (Color)",
    url: preciseColor.url,
    group: "Precise Realtors & Builders",
    bg: "light",
  },
  {
    id: "precise-white",
    label: "Precise Group — Legacy (White)",
    url: preciseWhite.url,
    group: "Precise Realtors & Builders",
    bg: "dark",
  },
];

/** Pseudo-option presented in pickers. Resolved at render time via
 *  {@link resolveLogoOption} based on the document type / letterhead style. */
export const AUTO_LOGO_OPTION = {
  id: AUTO_LOGO_ID,
  label: "Auto (match document)",
} as const;

/** Selectable items for UI pickers (Auto first, then concrete logos). */
export const LOGO_PICKER_ITEMS: Array<
  Pick<LogoOption, "id" | "label"> & { url?: string; bg?: "light" | "dark" }
> = [AUTO_LOGO_OPTION, ...LOGO_OPTIONS];

/** Default = Auto so each document picks the right brand without user effort. */
export const DEFAULT_LOGO_ID = AUTO_LOGO_ID;

const LS_KEY = "doc-logo-id-v1";

export type LetterheadStyleHint = "A" | "B";
export type AutoContext = {
  /** DocumentView route `type` (e.g. "receipt", "legal-notice"). */
  docType?: string | null;
  /** Resolved letterhead style ("A" = notices/schedules, "B" = transactional). */
  style?: LetterheadStyleHint;
};

/* ---------------- Auto-mode mapping ---------------- */

/** Document types known to the auto-mapper. Keep in sync with `getDocStyle`. */
export type AutoDocType =
  | "receipt"
  | "payment-plan"
  | "allotment"
  | "possession"
  | "prov-possession"
  | "deposit-summary"
  | "demand-notice"
  | "transfer-form"
  | "sale-agreement"
  | "legal-notice"
  | "final-legal-notice"
  | "final-cancel-warning"
  | "cancellation-notice"
  | "possession-demand-notice";

export type AutoDocSpec = {
  id: AutoDocType;
  label: string;
  style: LetterheadStyleHint;
};

/** Catalog used by the Auto-logo editor (label + default style per doc type). */
export const AUTO_DOC_CATALOG: AutoDocSpec[] = [
  { id: "receipt", label: "Payment Receipt", style: "B" },
  { id: "payment-plan", label: "Payment Plan", style: "A" },
  { id: "allotment", label: "Allotment Letter", style: "B" },
  { id: "possession", label: "Possession Letter", style: "B" },
  { id: "prov-possession", label: "Provisional Possession", style: "B" },
  { id: "deposit-summary", label: "Deposit Summary", style: "B" },
  { id: "demand-notice", label: "Demand Notice", style: "A" },
  { id: "transfer-form", label: "Transfer Form", style: "B" },
  { id: "sale-agreement", label: "Agreement to Sell", style: "B" },
  { id: "legal-notice", label: "Show-Cause / Legal Notice", style: "A" },
  { id: "final-legal-notice", label: "Final Legal Notice", style: "A" },
  { id: "final-cancel-warning", label: "Final Cancellation Warning", style: "A" },
  { id: "cancellation-notice", label: "Cancellation Notice", style: "A" },
  { id: "possession-demand-notice", label: "Possession Demand Notice", style: "A" },
];

/** Hard-coded fallbacks used when the user hasn't customised the style. */
export const AUTO_STYLE_DEFAULTS: Record<LetterheadStyleHint, string> = {
  A: "precise-wordmark-color", // Notices issued by the legal/corporate entity
  B: "manal-heights-wordmark-color", // Transactional/contractual docs use the project brand
};

const LS_AUTO_MAP_KEY = "doc-auto-logo-map-v1"; // per-docType overrides
const LS_AUTO_STYLE_KEY = "doc-auto-logo-style-v1"; // per-style overrides

type AutoMap = Partial<Record<AutoDocType, string>>;
type AutoStyleMap = Partial<Record<LetterheadStyleHint, string>>;

const isValidLogoId = (v: unknown): v is string =>
  typeof v === "string" && LOGO_OPTIONS.some((o) => o.id === v);

export function loadAutoLogoMap(): AutoMap {
  try {
    const raw = localStorage.getItem(LS_AUTO_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: AutoMap = {};
    for (const k of Object.keys(parsed)) {
      const v = parsed[k];
      if (isValidLogoId(v) && AUTO_DOC_CATALOG.some((d) => d.id === k)) {
        out[k as AutoDocType] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAutoLogoMap(map: AutoMap) {
  try {
    localStorage.setItem(LS_AUTO_MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function loadAutoStyleMap(): AutoStyleMap {
  try {
    const raw = localStorage.getItem(LS_AUTO_STYLE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: AutoStyleMap = {};
    if (isValidLogoId(parsed.A)) out.A = parsed.A;
    if (isValidLogoId(parsed.B)) out.B = parsed.B;
    return out;
  } catch {
    return {};
  }
}

export function saveAutoStyleMap(map: AutoStyleMap) {
  try {
    localStorage.setItem(LS_AUTO_STYLE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Auto-mode resolution order (first match wins):
 *   1. Per-document-type override (Auto-logo editor)
 *   2. Per-letterhead-style override (Auto-logo editor)
 *   3. Hard-coded brand defaults (Style A → Precise, Style B → Manal)
 */
export function resolveAutoLogoId(ctx: AutoContext = {}): string {
  const docMap = loadAutoLogoMap();
  const styleMap = loadAutoStyleMap();
  const docKey = (ctx.docType || "").toLowerCase() as AutoDocType;
  if (docKey && docMap[docKey]) return docMap[docKey]!;
  if (ctx.style && styleMap[ctx.style]) return styleMap[ctx.style]!;
  if (ctx.style) return AUTO_STYLE_DEFAULTS[ctx.style];
  return AUTO_STYLE_DEFAULTS.B;
}

/** Resolve any selected logo id (including "auto") to a concrete LogoOption. */
export function resolveLogoOption(
  id: string | null | undefined,
  ctx: AutoContext = {},
): LogoOption {
  if (!id || id === AUTO_LOGO_ID) {
    return getLogoOption(resolveAutoLogoId(ctx));
  }
  return getLogoOption(id);
}

export function getLogoOption(id?: string | null): LogoOption {
  return LOGO_OPTIONS.find((o) => o.id === id) || LOGO_OPTIONS[0];
}

/** True when `id` matches Auto or a concrete logo currently registered.
 *  Use to detect stale per-document selections that point at a removed asset. */
export function isKnownLogoId(id: string | null | undefined): boolean {
  if (!id) return false;
  if (id === AUTO_LOGO_ID) return true;
  return LOGO_OPTIONS.some((o) => o.id === id);
}

/** A safe URL the letterhead `<img onError>` can fall back to when the
 *  selected logo asset fails to load (CDN miss, network blip, etc.). */
export const FALLBACK_LOGO_URL = LOGO_OPTIONS[0]?.url ?? "";

/** Per-docType selected-logo map. Lets each document type remember its own
 *  chosen logo (including "auto") independent of every other document. */
const LS_DOC_MAP_KEY = "doc-logo-id-by-type-v1";

function loadDocLogoMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_DOC_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      // Preserve raw strings here so callers can detect "missing" ids and
      // show a fallback indicator. Sanitization happens in loadSelectedLogoId.
      if (typeof v === "string" && v.length > 0) {
        out[k.toLowerCase()] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveDocLogoMap(map: Record<string, string>) {
  try {
    localStorage.setItem(LS_DOC_MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Read the raw saved logo id for a docType without sanitizing — returns the
 *  string even when it no longer matches a registered logo. Use this when
 *  rendering the picker so a stale id can be reported to the user. */
export function loadRawSelectedLogoId(docType?: string | null): string | null {
  try {
    if (docType) {
      const map = loadDocLogoMap();
      const v = map[docType.toLowerCase()];
      if (v) return v;
    }
    const v = localStorage.getItem(LS_KEY);
    return v ?? null;
  } catch {
    return null;
  }
}

/** Load the saved logo id for a specific docType. Unknown ids (e.g. a logo
 *  asset that's been removed) collapse to Auto so the document still
 *  renders — use `loadRawSelectedLogoId` to detect missing picks. */
export function loadSelectedLogoId(docType?: string | null): string {
  const raw = loadRawSelectedLogoId(docType);
  if (raw === AUTO_LOGO_ID) return AUTO_LOGO_ID;
  if (raw && LOGO_OPTIONS.some((o) => o.id === raw)) return raw;
  return DEFAULT_LOGO_ID;
}

/** Persist a logo selection. When `docType` is supplied the choice is
 *  remembered for that document type only; otherwise the legacy global
 *  selection is updated. */
export function saveSelectedLogoId(id: string, docType?: string | null) {
  try {
    if (docType) {
      const map = loadDocLogoMap();
      map[docType.toLowerCase()] = id;
      saveDocLogoMap(map);
      return;
    }
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* ignore */
  }
}

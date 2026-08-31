import { format, parseISO, isValid } from "date-fns";

/**
 * Format a number as a PKR amount string with consistent thousand separators
 * (en-US grouping: 1,234,567) and explicit negative handling.
 *
 *   fmtPKR(0)         → "0"
 *   fmtPKR(1234567)   → "1,234,567"
 *   fmtPKR(-1234)     → "−1,234"   (uses U+2212 minus, not ASCII hyphen)
 *   fmtPKR(null)      → "—"
 *   fmtPKR(NaN)       → "—"
 *
 * Options:
 *   decimals  — fraction digits (default 0; always minimum 0 so whole
 *               amounts stay clean).
 *   signed    — when true, prefixes positive values with "+" so deltas
 *               read unambiguously in adjustment / variance contexts.
 *
 * The "PKR" unit label is rendered separately by the call sites so screen
 * readers and badges can style it independently — this helper returns the
 * numeric portion only.
 */
export const fmtPKR = (
  n: number | null | undefined,
  opts?: { decimals?: number; signed?: boolean },
) => {
  if (n === null || n === undefined) return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";

  const decimals = opts?.decimals ?? 0;
  const abs = Math.abs(num).toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  });

  if (num < 0) return `\u2212${abs}`; // U+2212 MINUS SIGN
  if (opts?.signed && num > 0) return `+${abs}`;
  return abs;
};

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? parseISO(d) : d;
  return isValid(date) ? format(date, "dd-MMM-yyyy") : "—";
};

export const maskCNIC = (cnic?: string | null) => {
  if (!cnic) return "—";
  return cnic.replace(/^(\d{5})-?(\d{7})-?(\d)$/, "$1-•••••••-$3");
};

/**
 * Compact Pakistani-style magnitude formatter (Crore / Lakh / K). Preserves
 * the sign of the input so negatives render as "−1.2 Cr" rather than losing
 * the minus when small fractions are computed from abs().
 */
export const compact = (n: number | null | undefined) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const num = Number(n);
  const sign = num < 0 ? "\u2212" : "";
  const abs = Math.abs(num);
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toString()}`;
};

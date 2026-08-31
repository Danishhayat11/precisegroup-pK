import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Escapes characters that have special meaning in PostgREST .or() filters.
 * Specifically commas (,) and parentheses ((), ()) which are used for
 * delimiter and nesting control in filter strings.
 *
 * @param val The value to escape
 * @returns The escaped string safe for concatenation into a .or() filter
 */
export function escapePostgrestFilter(val: string | number | null | undefined): string {
  if (val == null) return "";
  const s = String(val);
  // PostgREST uses backslash as the escape character for delimiters like , and ()
  return s.replace(/([,()])/g, "\\$1");
}

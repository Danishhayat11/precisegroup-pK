/**
 * Static guard: pure overdue/aging modules MUST NOT call `new Date()` —
 * the only "today" they may see is the explicit parameter passed in by
 * the caller, which in production is `useSystemDate()` / `fetchSystemDate()`
 * sourced from the SQL `get_system_date()` override.
 *
 * Also asserts that `src/lib/systemDate.ts` is the single module that
 * resolves "today" from a real wall clock (its `todayISO()` fallback).
 *
 * Add files to GUARDED_FILES whenever a new ledger/overdue-deriving
 * module is introduced. Add files to OVERDUE_CONSUMERS to assert they
 * import the systemDate hook instead of computing their own "today".
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

const GUARDED_FILES = ["src/lib/overdue.ts", "src/lib/fifoEngine.ts", "src/lib/ledger.ts"];

const OVERDUE_CONSUMERS = [
  // UI pages that surface overdue/aging derived from the systemDate hook.
  // Each MUST import from "@/lib/systemDate" so the admin override flows
  // through. New consumers should be added here, not silently call `new Date()`.
  "src/pages/DataHealth.tsx",
];

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

describe("today source-of-truth — static guard", () => {
  it.each(GUARDED_FILES)("%s contains no `new Date()` call", (file) => {
    const src = read(file);
    // Strip line/block comments before scanning so prose like "never call
    // new Date()" in a doc-comment doesn't trip the guard.
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(
      stripped,
      `${file} must not call new Date() — accept \`today\` as a parameter`,
    ).not.toMatch(/\bnew\s+Date\s*\(/);
  });

  it.each(OVERDUE_CONSUMERS)("%s imports from @/lib/systemDate", (file) => {
    const src = read(file);
    expect(
      src,
      `${file} must import the systemDate hook instead of reading \`new Date()\``,
    ).toMatch(/from\s+["']@\/lib\/systemDate["']/);
  });

  it("systemDate.ts is the sole module containing a wall-clock fallback", () => {
    const src = read("src/lib/systemDate.ts");
    // The fallback exists (so the app still works when the override is unset)…
    expect(src).toMatch(/new\s+Date\s*\(\s*\)/);
    // …and the file is documented as the single source of truth.
    expect(src.toLowerCase()).toContain("single source-of-truth");
  });
});

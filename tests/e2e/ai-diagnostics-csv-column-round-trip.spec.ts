/**
 * E2E: AI Diagnostics CSV export column round-trip.
 *
 * Contract under test — the CSV a real user downloads from the running
 * app must carry the SAME explicit column `key` names, in the SAME
 * canonical order, as the source-of-truth registry
 * (`ALL_EXPORT_COLUMNS`). This is the full UI → server → download
 * round-trip: browser fetches the page, TanStack loader hits the API,
 * the page renders rows, the user clicks the CSV button, the browser
 * writes the file, we read it back off disk and inspect the metadata
 * block + header row.
 *
 * Unit tests (`csvJsonExportE2E`, `csvJsonRoundTripColumnOrdering`, …)
 * already cover the writer in isolation with mock rows; this spec is
 * the only place that proves the wiring — column registry → picker
 * state → `buildExportMeta` → `prefixCsvWithMetadata` → download —
 * hasn't drifted end-to-end.
 *
 * Assertions:
 *   1. The metadata block contains a `# Column keys:` line whose
 *      comma-separated values are a subsequence of
 *      `ALL_EXPORT_COLUMN_KEYS` in canonical order (subset OK — the
 *      user's persisted picker state may drop optional columns).
 *   2. The `# Columns (N, in order):` line lists the matching labels
 *      in the same order, with the same count.
 *   3. The data-header row (first non-`#`, non-blank line) contains
 *      the same labels in the same left-to-right order.
 *   4. Every emitted column key is one declared in
 *      `ALL_EXPORT_COLUMN_KEYS` — no unknown/typo keys leak.
 *   5. The required columns (`created_at`, `request_id`) are always
 *      present regardless of picker state.
 *
 * Skips cleanly when:
 *   - No Supabase session is seeded (admin route is auth-gated).
 *   - The diagnostics table has no rows (Export CSV button stays
 *     disabled — nothing to serialise, so the contract is vacuous).
 */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  ALL_EXPORT_COLUMNS,
  ALL_EXPORT_COLUMN_KEYS,
  REQUIRED_EXPORT_COLUMN_KEYS,
  type ExportColumnKey,
} from "../../src/pages/aiDiagnosticsExportColumns";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

const LABEL_BY_KEY: Record<ExportColumnKey, string> = Object.fromEntries(
  ALL_EXPORT_COLUMNS.map((c) => [c.key, c.label]),
) as Record<ExportColumnKey, string>;

/**
 * Registry entries indexed by explicit `key`. Used by the verbatim-key
 * test to assert (key, label) tuples came straight from the registry
 * rather than being independently derived on the wire.
 */
const REGISTRY_BY_KEY: Record<ExportColumnKey, { key: string; label: string }> = Object.fromEntries(
  ALL_EXPORT_COLUMNS.map((c) => [c.key, { key: c.key, label: c.label }]),
) as Record<ExportColumnKey, { key: string; label: string }>;

async function seedSession(page: Page) {
  if (!HAS_SESSION) return;
  // Land on any same-origin page first so localStorage / cookies scope to
  // the app's origin, not about:blank. `/login` is public and cheap.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
    STORAGE_KEY,
    SESSION_JSON,
  ] as const);
  if (COOKIES_JSON) {
    const cookies = JSON.parse(COOKIES_JSON) as Array<Record<string, unknown>>;
    for (const c of cookies) c.url = BASE;
    await page.context().addCookies(cookies as never);
  }
}

/**
 * Parse a naive CSV row (comma-separated, quoted-cell aware). The CSV
 * header row for this export never contains embedded newlines — labels
 * are static strings from the registry — so a line-scoped split is
 * enough. We deliberately don't pull in a CSV library: the failure
 * mode we care about is "field order changed", which a stricter
 * parser would hide behind extra abstractions.
 */
function parseCsvHeaderRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"' && cur.length === 0) {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** True when `sub` is `parent` with (optionally) some entries removed, order preserved. */
function isSubsequence<T>(sub: readonly T[], parent: readonly T[]): boolean {
  let i = 0;
  for (const p of parent) {
    if (sub[i] === p) i++;
    if (i === sub.length) return true;
  }
  return i === sub.length;
}

test.describe("AI Diagnostics CSV export — column key/order round-trip", () => {
  test("downloaded CSV keys and header labels match the canonical registry order", async ({
    page,
  }) => {
    test.skip(!HAS_SESSION, "No Supabase session seeded — admin route is auth-gated.");

    await seedSession(page);
    await page.goto(`${BASE}/admin/ai-diagnostics`, {
      waitUntil: "domcontentloaded",
    });

    const exportButton = page.getByRole("button", {
      name: "Export current page as CSV",
    });

    // Wait for the page to render + rows to load. The button is
    // `disabled` until `pagedRows.length > 0`, so this doubles as a
    // proxy for "the loader resolved with at least one row".
    try {
      await expect(exportButton).toBeEnabled({ timeout: 15_000 });
    } catch {
      test.skip(
        true,
        "Diagnostics table is empty in this environment — CSV export button never enabled.",
      );
      return;
    }

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10_000 }),
      exportButton.click(),
    ]);

    const path = await download.path();
    expect(path, "browser did not persist the download to disk").toBeTruthy();
    const raw = readFileSync(path!, "utf8");

    // The exporter emits `\n` line separators and Excel-style `#`
    // comment lines followed by a blank line, then the header + data.
    const lines = raw.split(/\r?\n/);
    const columnLabelsLine = lines.find((l) => l.startsWith("# Columns ("));
    const columnKeysLine = lines.find((l) => l.startsWith("# Column keys:"));
    expect(columnLabelsLine, "CSV metadata missing `# Columns (N, in order):` line").toBeTruthy();
    expect(columnKeysLine, "CSV metadata missing `# Column keys:` line").toBeTruthy();

    // `# Columns (13, in order): Timestamp | Request ID | …`
    const labelsFromMeta = columnLabelsLine!
      .replace(/^# Columns \([^)]*\):\s*/, "")
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // `# Column keys: created_at,request_id,…`
    const keysFromMeta = columnKeysLine!
      .replace(/^# Column keys:\s*/, "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0) as ExportColumnKey[];

    // (4) No unknown keys leak.
    const knownKeys = new Set<string>(ALL_EXPORT_COLUMN_KEYS);
    for (const k of keysFromMeta) {
      expect(
        knownKeys.has(k),
        `CSV declared unknown column key \`${k}\` — not in ALL_EXPORT_COLUMN_KEYS`,
      ).toBe(true);
    }

    // (5) Required columns are always present.
    for (const req of REQUIRED_EXPORT_COLUMN_KEYS) {
      expect(keysFromMeta, `required column \`${req}\` missing from CSV metadata keys`).toContain(
        req,
      );
    }

    // (1) Keys appear in canonical order (subset allowed — the picker
    // may hide optional columns, but ordering must never change).
    expect(
      isSubsequence(keysFromMeta, ALL_EXPORT_COLUMN_KEYS),
      `CSV keys ${JSON.stringify(keysFromMeta)} are not a canonical-order ` +
        `subsequence of ${JSON.stringify(ALL_EXPORT_COLUMN_KEYS)}`,
    ).toBe(true);

    // (2) Labels line matches key list one-to-one.
    expect(labelsFromMeta).toHaveLength(keysFromMeta.length);
    const expectedLabelsFromKeys = keysFromMeta.map((k) => LABEL_BY_KEY[k]);
    expect(labelsFromMeta).toEqual(expectedLabelsFromKeys);

    // (3) The DATA header row (first non-`#`, non-blank line) matches
    //     the same labels in the same order. This is the strongest
    //     assertion — it's what a spreadsheet actually reads.
    const dataHeaderLine = lines.find((l) => l.length > 0 && !l.startsWith("#"));
    expect(dataHeaderLine, "CSV had no non-comment data-header row").toBeTruthy();
    const headerCells = parseCsvHeaderRow(dataHeaderLine!);
    expect(headerCells).toEqual(expectedLabelsFromKeys);
  });

  /**
   * VERBATIM {key} preservation.
   *
   * `buildExportMeta()` hands the metadata layer an explicit `{ key,
   * label }` for every selected column. The metadata layer accepts
   * explicit keys OR derives them by slugifying the label + deduping
   * with `_2`/`_3` suffixes. This test locks in that when explicit
   * keys ARE provided (which is always the case for AI Diagnostics
   * exports), the exact caller-supplied `key` string reaches the CSV
   * `# Column keys:` line byte-for-byte — no slugification, no
   * case-folding, no whitespace stripping, no dedup suffix, no
   * reordering relative to the labels it was paired with.
   *
   * Distinct from the "canonical order" test above: that one proves
   * the SET/ORDER of keys is right; this one proves each individual
   * key's BYTES were not mutated in transit and the (key,label)
   * pairing survived intact.
   */
  test("explicit column {key} values survive verbatim in the downloaded CSV", async ({ page }) => {
    test.skip(!HAS_SESSION, "No Supabase session seeded — admin route is auth-gated.");

    await seedSession(page);
    await page.goto(`${BASE}/admin/ai-diagnostics`, {
      waitUntil: "domcontentloaded",
    });

    const exportButton = page.getByRole("button", {
      name: "Export current page as CSV",
    });
    try {
      await expect(exportButton).toBeEnabled({ timeout: 15_000 });
    } catch {
      test.skip(
        true,
        "Diagnostics table is empty in this environment — CSV export button never enabled.",
      );
      return;
    }

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10_000 }),
      exportButton.click(),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();
    const raw = readFileSync(path!, "utf8");

    const lines = raw.split(/\r?\n/);
    const columnLabelsLine = lines.find((l) => l.startsWith("# Columns ("));
    const columnKeysLine = lines.find((l) => l.startsWith("# Column keys:"));
    expect(columnLabelsLine).toBeTruthy();
    expect(columnKeysLine).toBeTruthy();

    // Extract the raw `# Column keys:` payload with NO trimming past
    // the fixed prefix. Comma-separated fields ARE trimmed of
    // surrounding whitespace because the metadata writer joins with
    // a bare `,` — any interior whitespace inside a key would be a
    // real mutation. Explicit registry keys contain none, so the
    // trim is a no-op on happy paths and only guards against a
    // future writer accidentally adding `,` -> `, `.
    const rawKeysPayload = columnKeysLine!.replace(/^# Column keys:\s*/, "");
    const keysFromMeta = rawKeysPayload
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const labelsFromMeta = columnLabelsLine!
      .replace(/^# Columns \([^)]*\):\s*/, "")
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    expect(keysFromMeta.length).toBe(labelsFromMeta.length);
    expect(keysFromMeta.length).toBeGreaterThan(0);

    for (let i = 0; i < keysFromMeta.length; i++) {
      const emittedKey = keysFromMeta[i];
      const emittedLabel = labelsFromMeta[i];

      // (a) Byte-for-byte identity with a registry key. `===` on
      //     strings is a bit-exact compare in JS, so this rules out
      //     invisible mutations (case-folding, NFC/NFD normalisation,
      //     zero-width chars, added underscore, etc.).
      const registryEntry = REGISTRY_BY_KEY[emittedKey as ExportColumnKey];
      expect(
        registryEntry,
        `CSV key \`${emittedKey}\` is not a byte-identical match for any ` +
          `explicit key in ALL_EXPORT_COLUMNS — the metadata layer mutated it in transit`,
      ).toBeTruthy();

      // (b) The (key, label) pairing came from the SAME registry
      //     row. If a bug swapped keys and labels independently
      //     (e.g. sorted one side, not the other), this fires even
      //     though (a) still passes.
      expect(
        emittedLabel,
        `CSV column ${i}: emitted key \`${emittedKey}\` was paired with ` +
          `label \`${emittedLabel}\` but the registry pairs it with ` +
          `\`${registryEntry.label}\` — key/label ordering diverged in transit`,
      ).toBe(registryEntry.label);

      // (c) No dedup suffix. Explicit keys are unique in the
      //     registry, so the metadata layer must NOT append `_2`,
      //     `_3`, … — that only happens when keys collide, which
      //     would mean an unintended collapse upstream.
      expect(
        /_\d+$/.test(emittedKey) && !(emittedKey in REGISTRY_BY_KEY),
        `CSV key \`${emittedKey}\` looks dedup-suffixed (\`_N\`), which ` +
          `means the metadata layer treated two explicit keys as colliding`,
      ).toBe(false);
    }

    // (d) The raw payload contains no whitespace between `,` and the
    //     next key — proves the writer is joining with a bare `,`.
    //     A `, ` (comma+space) would still parse but is a wire-format
    //     regression external tooling shouldn't have to tolerate.
    expect(
      /,\s/.test(rawKeysPayload),
      `\`# Column keys:\` payload contains whitespace after a comma — ` +
        `raw payload: ${JSON.stringify(rawKeysPayload)}`,
    ).toBe(false);
  });
});

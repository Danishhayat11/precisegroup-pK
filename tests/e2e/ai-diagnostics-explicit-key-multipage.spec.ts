/**
 * E2E: explicit column {key} preservation across multi-page filtered exports.
 *
 * The "Download filtered JSON" action pages through EVERY row matching
 * the current filters — it fires the REST API in `.range(from, to)`
 * chunks of 1 000 rows and keeps going until either the matched-total
 * is drained or the 50 000-row cap trips. This spec asserts that the
 * per-column explicit `{ key }` values from `ALL_EXPORT_COLUMNS`
 * survive that multi-page iteration byte-for-byte in the downloaded
 * `_meta.columns[]` envelope:
 *
 *   1. Iteration really spanned MULTIPLE chunk requests (proves this
 *      isn't accidentally exercising the single-page path).
 *   2. `rows.length` equals the mock's `MATCHED_TOTAL` (not one page).
 *   3. Every `_meta.columns[i].key` is a byte-identical string from
 *      `ALL_EXPORT_COLUMNS` — no slugification, case-folding,
 *      NFC/NFD normalisation, zero-width chars, or dedup `_N` suffix.
 *   4. Each `(key, label)` pair matches the registry's pairing — the
 *      key column and label column didn't drift independently while
 *      the exporter was busy paging.
 *   5. Required column keys (`created_at`, `request_id`) are present.
 *   6. `_meta.columns[].order` is a dense `0..N-1` sequence — the
 *      iterator didn't accidentally shuffle keys between pages.
 *
 * Sibling specs cover adjacent contracts and are intentionally not
 * duplicated here:
 *   • `ai-diagnostics-export-truncation-cap.spec.ts` — the 50k cap
 *     + truncation notice contract.
 *   • `ai-diagnostics-csv-column-round-trip.spec.ts` — byte-verbatim
 *     keys in the SINGLE-page CSV export.
 *
 * This spec is the canary that fires if a future refactor accumulates
 * chunks in a way that re-derives column keys per page (which would
 * collapse explicit keys into slugified/deduped variants) or that
 * only preserves keys on chunk 0.
 *
 * Runs on Chromium only — matches the truncation-cap spec's rationale;
 * the mocked pagination payload is heavy enough that one browser arm
 * is sufficient.
 *
 * Skips cleanly when no Supabase session is seeded (admin route is
 * auth-gated).
 */
import { readFileSync } from "node:fs";
import { test, expect, type Page, type Route } from "@playwright/test";
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

// Small enough to run fast, large enough to force multiple 1000-row
// chunk requests (the exporter's fixed page size). 2500 -> exactly 3
// chunk fetches (0-999, 1000-1999, 2000-2499) before the loop halts.
const MATCHED_TOTAL = 2_500;
const CHUNK = 1_000;
const EXPECTED_CHUNK_REQUESTS = Math.ceil(MATCHED_TOTAL / CHUNK);

const REGISTRY_BY_KEY: Record<ExportColumnKey, { key: string; label: string }> = Object.fromEntries(
  ALL_EXPORT_COLUMNS.map((c) => [c.key, { key: c.key, label: c.label }]),
) as Record<ExportColumnKey, { key: string; label: string }>;

async function seedSession(page: Page) {
  if (!HAS_SESSION) return;
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
 * Build one page of synthetic diagnostic rows in the shape the
 * production `select(...)` expects. Content is intentionally minimal
 * — the contract under test (explicit key preservation) is
 * independent of per-row values.
 */
function synthRows(from: number, count: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = new Array(count);
  const baseTs = Date.UTC(2026, 0, 1);
  for (let i = 0; i < count; i++) {
    const n = from + i;
    const iso = new Date(baseTs + n * 1000).toISOString();
    out[i] = {
      id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
      created_at: iso,
      request_id: `req-${n}`,
      round: 1,
      tool_name: "mock_tool",
      tool_args: null,
      tool_result: null,
      success: true,
      error_message: null,
      duration_ms: 10,
      gateway_status: 200,
      gateway_model: "mock",
      retry_strategy: null,
      in_flight: false,
      completed_at: iso,
    };
  }
  return out;
}

function parseSlice(url: string): { from: number; to: number } {
  const u = new URL(url);
  const offsetStr = u.searchParams.get("offset");
  const limitStr = u.searchParams.get("limit");
  const from = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;
  const limit = limitStr ? Math.max(1, parseInt(limitStr, 10) || 1) : 1;
  return { from, to: from + limit - 1 };
}

async function handleDiagnosticsRoute(route: Route, chunkCounter: { n: number }): Promise<void> {
  const request = route.request();
  const method = request.method();
  if (method === "OPTIONS") {
    await route.fulfill({
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers":
          "authorization,apikey,content-type,prefer,range,x-client-info,accept-profile,content-profile,range-unit",
        "access-control-expose-headers": "content-range,content-location",
      },
      body: "",
    });
    return;
  }
  if (method !== "GET") {
    await route.fulfill({ status: 405, body: "" });
    return;
  }
  const range = parseSlice(request.url());
  const wantCount = (request.headers()["prefer"] ?? "").includes("count=exact");
  const rangeSize = range.to - range.from + 1;
  const rowsToReturn = Math.min(rangeSize, Math.max(0, MATCHED_TOTAL - range.from));
  const body = JSON.stringify(synthRows(range.from, rowsToReturn));

  if (rangeSize === CHUNK) chunkCounter.n += 1;

  await route.fulfill({
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "content-range,content-location",
      "content-range": `${range.from}-${range.from + Math.max(0, rowsToReturn - 1)}/${
        wantCount ? MATCHED_TOTAL : "*"
      }`,
    },
    body,
  });
}

type JsonEnvelope = {
  _meta: {
    counts?: { shown?: number; filtered?: number; total?: number };
    columns?: Array<{ order: number; key: string; label: string }>;
  };
  rows: unknown[];
};

test.describe("AI Diagnostics — explicit column keys across multi-page filtered export", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Multi-page mock is heavy — chromium arm is sufficient.",
  );

  test("explicit {key} values win verbatim across every paged chunk", async ({ page }) => {
    test.skip(!HAS_SESSION, "No Supabase session seeded — admin route is auth-gated.");
    test.setTimeout(60_000);

    const chunkCounter = { n: 0 };
    await page.route("**/rest/v1/ai_tool_call_log*", (route) =>
      handleDiagnosticsRoute(route, chunkCounter),
    );

    await seedSession(page);
    await page.goto(`${BASE}/admin/ai-diagnostics`, { waitUntil: "domcontentloaded" });

    const button = page.getByRole("button", { name: /Download filtered JSON/i });
    await expect(button).toBeEnabled({ timeout: 20_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 45_000 }),
      button.click(),
    ]);
    const filePath = await download.path();
    expect(filePath, "browser did not persist the download to disk").toBeTruthy();

    const parsed = JSON.parse(readFileSync(filePath!, "utf8")) as JsonEnvelope;

    // (1) Iteration really did span multiple chunk requests.
    expect(
      chunkCounter.n,
      `expected exporter to page through ${EXPECTED_CHUNK_REQUESTS} chunk requests, ` +
        `got ${chunkCounter.n} — the multi-page contract wasn't exercised`,
    ).toBe(EXPECTED_CHUNK_REQUESTS);
    expect(chunkCounter.n).toBeGreaterThan(1);

    // (2) Every matched row was collected, not just one page.
    expect(parsed.rows).toHaveLength(MATCHED_TOTAL);
    expect(parsed._meta.counts?.shown).toBe(MATCHED_TOTAL);
    expect(parsed._meta.counts?.filtered).toBe(MATCHED_TOTAL);

    const columns = parsed._meta.columns;
    expect(columns, "_meta.columns missing from JSON envelope").toBeTruthy();
    expect(columns!.length).toBeGreaterThan(0);

    // (6) `order` is a dense 0..N-1 sequence — no shuffling between pages.
    for (let i = 0; i < columns!.length; i++) {
      expect(
        columns![i].order,
        `_meta.columns[${i}].order = ${columns![i].order}, expected ${i}`,
      ).toBe(i);
    }

    const knownKeys = new Set<string>(ALL_EXPORT_COLUMN_KEYS);
    for (let i = 0; i < columns!.length; i++) {
      const { key, label } = columns![i];

      // (3a) Byte-identical to a registry key. `===` on strings is a
      //      bit-exact compare in JS.
      const registryEntry = REGISTRY_BY_KEY[key as ExportColumnKey];
      expect(
        registryEntry,
        `_meta.columns[${i}].key = \`${key}\` is not byte-identical to any explicit ` +
          `ALL_EXPORT_COLUMNS entry — the multi-page exporter mutated it in transit`,
      ).toBeTruthy();
      expect(knownKeys.has(key)).toBe(true);

      // (3b) No dedup `_N` suffix — that only appears when the metadata
      //      layer thinks two keys collided, which means an explicit
      //      key was silently re-derived from its label somewhere.
      expect(
        /_\d+$/.test(key) && !(key in REGISTRY_BY_KEY),
        `_meta.columns[${i}].key = \`${key}\` looks dedup-suffixed — the metadata ` +
          `layer treated two explicit keys as colliding across pages`,
      ).toBe(false);

      // (4) (key, label) pairing survived — key and label didn't
      //     reorder independently across the paged iteration.
      expect(
        label,
        `_meta.columns[${i}]: key \`${key}\` paired with label \`${label}\`, ` +
          `registry pairs it with \`${registryEntry.label}\` — pairing drifted mid-paging`,
      ).toBe(registryEntry.label);
    }

    // (5) Required columns are always present regardless of picker state.
    const emittedKeys = new Set(columns!.map((c) => c.key));
    for (const req of REQUIRED_EXPORT_COLUMN_KEYS) {
      expect(
        emittedKeys.has(req),
        `required column \`${req}\` missing from multi-page JSON _meta.columns`,
      ).toBe(true);
    }
  });
});

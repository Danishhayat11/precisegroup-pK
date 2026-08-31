/**
 * E2E: filtered export truncation cap.
 *
 * The Filtered CSV / JSON / XLSX exports stream matching rows from the
 * REST API in chunks and hard-cap at `FILTERED_EXPORT_MAX = 50_000` so
 * the browser never has to hold an unbounded working set. When the
 * matched-total exceeds the cap the app is contractually obligated to:
 *
 *   1. Only serialise up to 50 000 rows.
 *   2. Set `_meta.extra.Notes = "Truncated at 50000 rows of <matched>
 *      matched"` on the JSON envelope (and the equivalent line in the
 *      CSV metadata block).
 *   3. Report row counts in `_meta.counts` that agree with (1) —
 *      `shown = 50_000`, `filtered = matched`, `total = matched`.
 *   4. Emit exactly 50 000 entries in `rows[]`.
 *
 * Producing 60 000 real rows in the database for a test run is
 * impractical, so this spec intercepts the REST calls with
 * `page.route()` and synthesises paged responses that:
 *
 *   - report `Content-Range: 0-999/60000` on the first chunk (the
 *     only chunk the exporter asks for `count=exact` on), and
 *   - return 1 000 synthetic rows per chunk until the exporter stops.
 *
 * The exporter's `for (offset < 50_000; step 1_000)` loop must then
 * fire exactly 50 chunk requests and stop, and the downloaded JSON
 * must satisfy every contract above. We assert them all.
 *
 * Runs on Chromium only — WebKit/Firefox arms of the nightly matrix
 * exercise the same code path with real data via other specs; the
 * >50k mock payload is heavy enough that we don't need to pay for it
 * three times per run.
 *
 * Skips cleanly when:
 *   - No Supabase session is seeded (admin route is auth-gated).
 */
import { readFileSync } from "node:fs";
import { test, expect, type Page, type Route } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

const MATCHED_TOTAL = 60_000;
const EXPECTED_CAP = 50_000;
const CHUNK = 1_000;

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
 * Build one page of synthetic diagnostic rows in the exact shape the
 * page's `select("id, created_at, request_id, …")` expects. Rows are
 * intentionally minimal so 50 000 of them still fit comfortably in
 * memory during the export.
 */
function synthRows(from: number, count: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = new Array(count);
  const baseTs = Date.UTC(2026, 0, 1);
  for (let i = 0; i < count; i++) {
    const n = from + i;
    // Same timestamp for every row keeps the response body compact; the
    // export contract we're testing (truncation + counts) is independent
    // of per-row content.
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

/**
 * Extract the effective `(from, to)` slice a supabase-js request is
 * asking for. `.range(from, to)` serialises to `?offset=<from>&limit=<n>`
 * on the URL (NOT a `Range` header), so we parse that. Unpaginated
 * requests (no `offset`/`limit`) get a tiny 1-row slice — we only care
 * that they succeed so the page can render; their content doesn't
 * matter for the assertions.
 */
function parseSlice(url: string): { from: number; to: number } {
  const u = new URL(url);
  const offsetStr = u.searchParams.get("offset");
  const limitStr = u.searchParams.get("limit");
  const from = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;
  const limit = limitStr ? Math.max(1, parseInt(limitStr, 10) || 1) : 1;
  return { from, to: from + limit - 1 };
}

/**
 * Fulfil an intercepted `/rest/v1/ai_tool_call_log*` request as a
 * synthesised PostgREST page. Handles CORS preflight and the
 * `Prefer: count=exact` count-header round-trip.
 */
async function handleDiagnosticsRoute(route: Route, chunkCounter: { n: number }): Promise<void> {
  const request = route.request();
  const method = request.method();
  // Preflight — reply with the exact headers @supabase/supabase-js sends
  // so the actual GET can be dispatched.
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

  // Respect the exporter's cap even though the mock could serve more —
  // matches how the real PostgREST layer honours `.range()`.
  const rowsToReturn = Math.min(rangeSize, Math.max(0, MATCHED_TOTAL - range.from));
  const body = JSON.stringify(synthRows(range.from, rowsToReturn));

  // Count only chunk-sized requests (this is what the exporter fires) so
  // the assertion at the end proves the 50-chunk cap, not the initial
  // 25-row page load.
  if (rangeSize === CHUNK) chunkCounter.n += 1;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "content-range,content-location",
    "content-range": `${range.from}-${range.from + Math.max(0, rowsToReturn - 1)}/${
      wantCount ? MATCHED_TOTAL : "*"
    }`,
  };
  await route.fulfill({ status: 200, headers, body });
}

test.describe("AI Diagnostics — filtered JSON export truncation cap", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "50k-row mock export is heavy — chromium arm is sufficient.",
  );

  test("caps at 50 000 rows, records truncation notice, and counts agree", async ({ page }) => {
    test.skip(!HAS_SESSION, "No Supabase session seeded — admin route is auth-gated.");
    // 50 mock chunks × transfer + JSON.stringify of 50k rows blows the
    // default 30s cap; give the render/serialise pipeline room.
    test.setTimeout(180_000);

    const chunkCounter = { n: 0 };
    await page.route("**/rest/v1/ai_tool_call_log*", (route) =>
      handleDiagnosticsRoute(route, chunkCounter),
    );

    await seedSession(page);
    await page.goto(`${BASE}/admin/ai-diagnostics`, { waitUntil: "domcontentloaded" });

    // The Filtered JSON button unlocks once the initial page load
    // resolves with a non-zero `totalRows` count. Our mock reports
    // 60 000, so this should flip quickly.
    const button = page.getByRole("button", {
      name: /Download filtered JSON/i,
    });
    await expect(button).toBeEnabled({ timeout: 20_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 150_000 }),
      button.click(),
    ]);
    const filePath = await download.path();
    expect(filePath, "browser did not persist the download to disk").toBeTruthy();

    const raw = readFileSync(filePath!, "utf8");
    const parsed = JSON.parse(raw) as {
      _meta: {
        counts?: { shown?: number; filtered?: number; total?: number };
        extra?: Record<string, string>;
        page?: unknown;
      };
      rows: unknown[];
    };

    // (4) The row payload itself is capped.
    expect(parsed.rows).toHaveLength(EXPECTED_CAP);

    // (2) Truncation notice is recorded verbatim on `_meta.extra.Notes`.
    expect(parsed._meta.extra?.Notes).toBe(
      `Truncated at ${EXPECTED_CAP} rows of ${MATCHED_TOTAL} matched`,
    );

    // (3) Counts agree with the truncated payload.
    expect(parsed._meta.counts?.shown).toBe(EXPECTED_CAP);
    expect(parsed._meta.counts?.filtered).toBe(MATCHED_TOTAL);
    expect(parsed._meta.counts?.total).toBe(MATCHED_TOTAL);

    // Filtered exports span all pages — `_meta.page` MUST be omitted
    // (JSON envelope drops it when null) so downstream tooling doesn't
    // treat this as a single-page slice.
    expect(parsed._meta.page).toBeUndefined();

    // (1) The exporter fired exactly cap/chunk requests before stopping.
    // Anything else means either it undershot (missing rows) or blew
    // past the cap (unbounded working set).
    expect(chunkCounter.n).toBe(EXPECTED_CAP / CHUNK);

    // In-page truncation banner mirrors the JSON envelope so a user who
    // dismissed the toast still sees the fact on screen.
    await expect(
      page.getByText(
        `Downloaded ${EXPECTED_CAP.toLocaleString()} of ${MATCHED_TOTAL.toLocaleString()} matching rows.`,
        { exact: false },
      ),
    ).toBeVisible({ timeout: 5_000 });
  });
});

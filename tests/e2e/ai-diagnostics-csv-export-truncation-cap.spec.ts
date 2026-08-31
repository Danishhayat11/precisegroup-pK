/**
 * E2E: filtered CSV export truncation cap.
 *
 * CSV counterpart to `ai-diagnostics-export-truncation-cap.spec.ts`
 * (which covers the JSON envelope path). Both exports share the same
 * `FILTERED_EXPORT_MAX = 50_000` cap and the same paging loop, but they
 * serialise the truncation contract into different wire formats and
 * are wired through independent handlers (`handleExportFilteredCsv`
 * vs `handleExportFilteredJson`). Regressing one without the other
 * has happened before, so we pin both.
 *
 * When matched-total exceeds the cap, the downloaded CSV must:
 *
 *   1. Contain a `# Notes: Truncated at 50000 rows of <matched> matched`
 *      line in the metadata block (emitted via the `extra.Notes` slot).
 *   2. Report `# Rows: 50000 shown · <matched> filtered · <matched> total`
 *      — every bucket agrees with (1).
 *   3. Contain exactly 50 000 data rows below the header (i.e.
 *      `total_lines - metadata_lines - 1 blank - 1 header == 50 000`).
 *   4. NOT emit a `# Page:` line (filtered exports span all pages).
 *   5. Trigger EXACTLY `cap / chunk = 50` chunk requests before the
 *      exporter stops (undershoot = lost rows, overshoot = unbounded
 *      working set).
 *
 * Runs on Chromium only for the same reason the JSON spec does — a
 * 50k-row mock payload is heavy and one browser arm is sufficient.
 *
 * Skips cleanly when no Supabase session is seeded.
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
 * Build one page of synthetic diagnostic rows in the shape the
 * production `select(...)` expects. Content is intentionally minimal
 * — the contract under test (truncation + counts) is independent of
 * per-row values.
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

test.describe("AI Diagnostics — filtered CSV export truncation cap", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "50k-row mock export is heavy — chromium arm is sufficient.",
  );

  test("caps at 50 000 rows, emits `# Notes: Truncated…` and matching `# Rows:`", async ({
    page,
  }) => {
    test.skip(!HAS_SESSION, "No Supabase session seeded — admin route is auth-gated.");
    // 50 mock chunks + CSV serialisation of 50k rows blows the default 30s cap.
    test.setTimeout(180_000);

    const chunkCounter = { n: 0 };
    await page.route("**/rest/v1/ai_tool_call_log*", (route) =>
      handleDiagnosticsRoute(route, chunkCounter),
    );

    await seedSession(page);
    await page.goto(`${BASE}/admin/ai-diagnostics`, { waitUntil: "domcontentloaded" });

    // Match the exact aria-label wired on the button so we're testing
    // the real filtered-CSV entry point, not the single-page CSV.
    const button = page.getByRole("button", {
      name: /Download filtered CSV \(all matching rows across pages\)/i,
    });
    await expect(button).toBeEnabled({ timeout: 20_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 150_000 }),
      button.click(),
    ]);
    const filePath = await download.path();
    expect(filePath, "browser did not persist the download to disk").toBeTruthy();

    const raw = readFileSync(filePath!, "utf8");
    const lines = raw.split(/\r?\n/);

    // Metadata block = leading `#`-prefixed lines terminated by the
    // first blank line (per `prefixCsvWithMetadata`'s contract).
    const blankIdx = lines.findIndex((l) => l === "");
    expect(blankIdx, "CSV metadata block was not terminated by a blank line").toBeGreaterThan(0);
    const metaLines = lines.slice(0, blankIdx);
    for (const l of metaLines) {
      expect(l.startsWith("#"), `metadata block contains non-# line: ${JSON.stringify(l)}`).toBe(
        true,
      );
    }

    // (1) Truncation notice line, byte-exact.
    const notesLine = metaLines.find((l) => l.startsWith("# Notes:"));
    expect(notesLine, "CSV metadata missing `# Notes:` truncation line").toBeTruthy();
    expect(notesLine).toBe(
      `# Notes: Truncated at ${EXPECTED_CAP} rows of ${MATCHED_TOTAL} matched`,
    );

    // (2) `# Rows:` line agrees with (1) — shown = cap, filtered/total = matched.
    const rowsLine = metaLines.find((l) => l.startsWith("# Rows:"));
    expect(rowsLine, "CSV metadata missing `# Rows:` summary line").toBeTruthy();
    expect(rowsLine).toBe(
      `# Rows: ${EXPECTED_CAP} shown · ${MATCHED_TOTAL} filtered · ${MATCHED_TOTAL} total`,
    );

    // (4) Filtered exports span all pages — no `# Page:` line should appear.
    expect(
      metaLines.some((l) => l.startsWith("# Page:")),
      "filtered CSV export must not emit a `# Page:` line — that's a single-page marker",
    ).toBe(false);

    // (3) Data-row count == cap. Everything below the blank line is
    //     one header row + N data rows (+ possibly one trailing empty
    //     line from a terminal newline). No data row is a CSV row
    //     that spans multiple lines because our synthetic payload
    //     contains no embedded newlines — every `\n` is a row break.
    const bodyLines = lines.slice(blankIdx + 1).filter((l) => l.length > 0);
    expect(bodyLines.length, "CSV body missing header + data rows").toBeGreaterThan(1);
    const dataRowCount = bodyLines.length - 1; // subtract the header row
    expect(dataRowCount).toBe(EXPECTED_CAP);

    // (5) Exporter fired exactly cap/chunk chunk requests before halting.
    expect(chunkCounter.n).toBe(EXPECTED_CAP / CHUNK);

    // In-page truncation banner mirrors the file — same rationale as
    // the JSON spec: a user who dismissed the toast still sees it.
    await expect(
      page.getByText(
        `Downloaded ${EXPECTED_CAP.toLocaleString()} of ${MATCHED_TOTAL.toLocaleString()} matching rows.`,
        { exact: false },
      ),
    ).toBeVisible({ timeout: 5_000 });
  });
});

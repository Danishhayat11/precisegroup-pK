/**
 * E2E regression: Dashboard loads and the payments list renders using
 * `receipt_no` — with no runtime SQL errors from a stale `payments.payment_id`
 * column reference.
 *
 * Guards against the bug that surfaced as:
 *   "Failed to load dashboard data. column payments.payment_id does not exist"
 *
 * Run:  bunx playwright test tests/a11y/dashboard-payments-receipt-no.spec.ts
 */
import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const SCREENSHOT_DIR = "/tmp/browser/dashboard-payments-receipt-no";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// HAR + console fixture
// ---------------------------------------------------------------------------
// Override the `context` fixture so every test in this file records a full
// HAR (request/response bodies + timings). The HAR is written to a per-test
// temp file, then closed in the fixture teardown and attached to the test
// report on FAILURE only — passing runs delete it to keep artifacts small.
// Console errors + pageerror events are also buffered per-page and attached
// on failure, giving a self-contained forensic bundle:
//   - trace.zip     (Playwright, retain-on-failure)
//   - video.webm    (Playwright, retain-on-failure)
//   - screenshot    (afterEach hook)
//   - page HTML     (afterEach hook)
//   - network.har   (this fixture) — full req/resp incl. Supabase REST bodies
//   - console.log   (this fixture) — every console.error + uncaught pageerror
const harPaths = new WeakMap<BrowserContext, string>();
const consoleErrors = new WeakMap<Page, string[]>();

export const test = base.extend<{ context: BrowserContext }>({
  context: async ({ browser }, use, testInfo) => {
    const safe = testInfo.title.replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
    const harPath = path.join(os.tmpdir(), `har-${safe}-${testInfo.retry}-${Date.now()}.har`);
    const context = await browser.newContext({
      recordHar: {
        path: harPath,
        // `full` = include request+response bodies (needed to inspect the
        // Supabase REST payload that revealed the `payment_id` column error).
        content: "embed",
        mode: "full",
      },
    });
    harPaths.set(context, harPath);
    await use(context);
    // Close context so Playwright flushes the HAR to disk before we attach.
    await context.close().catch(() => {});
    const failed = testInfo.status !== testInfo.expectedStatus;
    try {
      if (failed && fs.existsSync(harPath)) {
        await testInfo
          .attach(`network-har-attempt${testInfo.retry + 1}`, {
            path: harPath,
            contentType: "application/json",
          })
          .catch(() => {});
        // Mirror to the shared /tmp dir for local inspection.
        try {
          fs.copyFileSync(harPath, `${SCREENSHOT_DIR}/${safe}.har`);
        } catch {}
      }
      if (fs.existsSync(harPath)) fs.unlinkSync(harPath);
    } catch {
      // best-effort — never mask the original failure
    }
  },
});

test.use({
  viewport: { width: 1280, height: 1800 },
  colorScheme: "light",
  reducedMotion: "reduce",
});

async function seedSession(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
}

// ---------------------------------------------------------------------------
// payment_id auto-snapshotter
// ---------------------------------------------------------------------------
// Installed in beforeEach for every test in this file. Continuously buffers
// console + network activity. The moment ANY channel emits a `payment_id`
// SQL error signal, we snapshot: page HTML, screenshot, buffered console,
// and buffered network events → attach them to the Playwright report and
// mirror into /tmp so the artifact upload always contains a forensic bundle,
// even if the eventual assertion fails much later (or not at all — a hit
// is still logged for triage).
// Known-good column set for public.payments (source of truth: information_schema).
// Any missing-column signal referencing a name NOT in this set is a regression.
// Kept in-spec (rather than fetched at runtime) so the test fails deterministically
// and offline — update it in the same PR that changes the payments schema.
const PAYMENTS_KNOWN_COLUMNS = new Set<string>([
  "receipt_no",
  "payment_date",
  "booking_id",
  "client_name",
  "cnic",
  "project",
  "unit_no",
  "payment_head",
  "payment_mode",
  "amount",
  "cheque_txn_no",
  "account",
  "received_from",
  "memo",
  "posted_by",
  "status",
  "remarks",
  "cash_bank_include",
  "non_cash_adjustment",
  "safe_cash_amount",
  "created_at",
  "updated_at",
]);

// Regexes that surface a missing-column error against public.payments across
// Postgres / PostgREST / Supabase-JS error surfaces. Each capture yields the
// offending column identifier which we compare against PAYMENTS_KNOWN_COLUMNS.
// Covered surfaces:
//   1. Postgres 42703       — `column payments.<col> does not exist`
//   2. Postgres 42703 bare  — `column "<col>" does not exist` (payments-scoped)
//   3. PostgREST PGRST204   — `Could not find the '<col>' column of 'payments'`
//   4. Dotted reference     — `payments.<col>` in code/queries (payments-scoped)
const PAYMENTS_MISSING_COL_PATTERNS: RegExp[] = [
  /column\s+["']?payments?["']?\.["']?(?<col>[a-z_][a-z0-9_]*)["']?\s+does not exist/gi,
  /column\s+["']?(?<col>[a-z_][a-z0-9_]*)["']?\s+does not exist/gi,
  /Could not find the ['"]?(?<col>[a-z_][a-z0-9_]*)['"]?\s+column of ['"]?payments['"]?/gi,
  /payments?\.(?<col>[a-z_][a-z0-9_]*)\b/gi,
];

function detectPaymentsMissingColumns(text: string, urlHint = ""): string[] {
  if (!text) return [];
  const scoped = /payments/i.test(text) || /payments/i.test(urlHint);
  const hits = new Set<string>();
  PAYMENTS_MISSING_COL_PATTERNS.forEach((re, i) => {
    const gre = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = gre.exec(text)) !== null) {
      const col = (m.groups?.col ?? "").toLowerCase();
      if (!col) continue;
      // Patterns #2 and #4 (indexes 1 and 3) need a payments scope check to
      // avoid false positives from unrelated tables.
      if ((i === 1 || i === 3) && !scoped) continue;
      if (PAYMENTS_KNOWN_COLUMNS.has(col)) continue;
      hits.add(col);
    }
  });
  return [...hits];
}

// Back-compat: kept as a boolean predicate for the existing snapshotter call
// sites so we don't have to refactor every hit-check inline.
const PAYMENT_ID_RE = {
  test(text: string): boolean {
    return detectPaymentsMissingColumns(text).length > 0;
  },
};

type ConsoleEntry = { t: number; type: string; text: string };
type NetworkEntry = {
  t: number;
  kind: "response" | "requestfailed";
  method: string;
  url: string;
  status?: number;
  body?: string;
  error?: string;
};

const paymentIdBuffers = new WeakMap<
  Page,
  { console: ConsoleEntry[]; network: NetworkEntry[]; hits: string[]; snapshotCount: number }
>();

async function snapshotPaymentIdHit(
  page: Page,
  testInfo: import("@playwright/test").TestInfo,
  source: string,
  text: string,
) {
  const buf = paymentIdBuffers.get(page);
  if (!buf) return;
  buf.snapshotCount += 1;
  const idx = buf.snapshotCount;
  const safe = testInfo.title.replace(/[^a-z0-9]+/gi, "_").slice(0, 50);
  const stem = `payment-id-hit-${idx}-${safe}`;
  const htmlPath = testInfo.outputPath(`${stem}.html`);
  const shotPath = testInfo.outputPath(`${stem}.png`);
  const consolePath = testInfo.outputPath(`${stem}.console.json`);
  const networkPath = testInfo.outputPath(`${stem}.network.json`);
  const summaryPath = testInfo.outputPath(`${stem}.summary.txt`);

  try {
    const html = await page.content().catch(() => "");
    if (html) fs.writeFileSync(htmlPath, html);
    await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});
    fs.writeFileSync(consolePath, JSON.stringify(buf.console.slice(-500), null, 2));
    fs.writeFileSync(networkPath, JSON.stringify(buf.network.slice(-500), null, 2));
    fs.writeFileSync(
      summaryPath,
      `payment_id SQL error detected\n` +
        `test: ${testInfo.title}\n` +
        `source: ${source}\n` +
        `url: ${page.url()}\n` +
        `matched: ${text.slice(0, 500)}\n` +
        `console entries buffered: ${buf.console.length}\n` +
        `network entries buffered: ${buf.network.length}\n`,
    );

    // Loud stdout marker so CI logs point at the artifacts.
    console.error(
      `\n[payment_id-detector] HIT #${idx} in "${testInfo.title}" via ${source}\n` +
        `  matched: ${text.slice(0, 200)}\n` +
        `  html: ${htmlPath}\n  screenshot: ${shotPath}\n` +
        `  console: ${consolePath}\n  network: ${networkPath}\n`,
    );

    await Promise.all([
      testInfo.attach(`${stem}-html`, { path: htmlPath, contentType: "text/html" }).catch(() => {}),
      testInfo
        .attach(`${stem}-screenshot`, { path: shotPath, contentType: "image/png" })
        .catch(() => {}),
      testInfo
        .attach(`${stem}-console`, { path: consolePath, contentType: "application/json" })
        .catch(() => {}),
      testInfo
        .attach(`${stem}-network`, { path: networkPath, contentType: "application/json" })
        .catch(() => {}),
      testInfo
        .attach(`${stem}-summary`, { path: summaryPath, contentType: "text/plain" })
        .catch(() => {}),
    ]);

    // Mirror into the shared /tmp bundle for local runs.
    try {
      fs.copyFileSync(htmlPath, `${SCREENSHOT_DIR}/${stem}.html`);
      fs.copyFileSync(shotPath, `${SCREENSHOT_DIR}/${stem}.png`);
      fs.copyFileSync(consolePath, `${SCREENSHOT_DIR}/${stem}.console.json`);
      fs.copyFileSync(networkPath, `${SCREENSHOT_DIR}/${stem}.network.json`);
      fs.copyFileSync(summaryPath, `${SCREENSHOT_DIR}/${stem}.summary.txt`);
    } catch {}
  } catch {
    // never mask the underlying assertion failure
  }
}

function installPaymentIdSnapshotter(page: Page, testInfo: import("@playwright/test").TestInfo) {
  const buf = {
    console: [] as ConsoleEntry[],
    network: [] as NetworkEntry[],
    hits: [] as string[],
    snapshotCount: 0,
  };
  paymentIdBuffers.set(page, buf);
  const now = () => Date.now();

  const check = (source: string, text: string, urlHint = "") => {
    if (!text) return;
    const cols = detectPaymentsMissingColumns(text, urlHint);
    if (cols.length === 0) return;
    buf.hits.push(`${source} [payments missing cols: ${cols.join(",")}]: ${text.slice(0, 300)}`);
    // Fire-and-forget snapshot; awaited via testInfo.attach in the handler.
    void snapshotPaymentIdHit(page, testInfo, `${source} (cols=${cols.join(",")})`, text);
  };

  page.on("console", (msg) => {
    const entry = { t: now(), type: msg.type(), text: msg.text() };
    buf.console.push(entry);
    if (buf.console.length > 1000) buf.console.splice(0, buf.console.length - 1000);
    check(`console.${entry.type}`, entry.text);
  });
  page.on("pageerror", (err) => {
    const text = `${err.name}: ${err.message}`;
    buf.console.push({ t: now(), type: "pageerror", text });
    check("pageerror", text);
  });
  page.on("requestfailed", (req) => {
    const entry: NetworkEntry = {
      t: now(),
      kind: "requestfailed",
      method: req.method(),
      url: req.url(),
      error: req.failure()?.errorText ?? "",
    };
    buf.network.push(entry);
    check("requestfailed", `${entry.method} ${entry.url} — ${entry.error}`);
  });
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!/supabase|\/rest\/v1\/|\/functions\/v1\//i.test(url)) return;
    const status = resp.status();
    const shouldReadBody = status >= 400 || /payments/i.test(url);
    const body = shouldReadBody ? await resp.text().catch(() => "") : "";
    const entry: NetworkEntry = {
      t: now(),
      kind: "response",
      method: resp.request().method(),
      url,
      status,
      body: body ? body.slice(0, 2000) : undefined,
    };
    buf.network.push(entry);
    if (buf.network.length > 1000) buf.network.splice(0, buf.network.length - 1000);
    if (body) check(`http.${status}`, `${url} — ${body}`, url);
  });
}

// (detectPaymentsMissingColumns / PAYMENTS_KNOWN_COLUMNS are file-local and
// used by the tests below via closure.)

// Exposed so individual tests can read the running list of payment_id hits
// (they still assert === [] at the end; this just avoids duplicate listeners).
function paymentIdHits(page: Page): string[] {
  return paymentIdBuffers.get(page)?.hits ?? [];
}

// Per-test tracker of failed dashboard-data requests (requestfailed + HTTP 5xx)
// against Supabase REST / edge endpoints. Populated in beforeEach, asserted in
// afterEach so EVERY test in this file enforces the "no failed data requests"
// invariant without duplicating listener boilerplate.
const failedRequests = new WeakMap<Page, string[]>();
const isDashboardDataUrl = (url: string) => /supabase|\/rest\/v1\/|\/functions\/v1\//i.test(url);

test.beforeEach(async ({ page }, testInfo) => {
  // Install the payment_id auto-snapshotter FIRST so it captures listeners
  // for every test in this file with zero per-test wiring.
  installPaymentIdSnapshotter(page, testInfo);

  const bucket: string[] = [];
  failedRequests.set(page, bucket);

  // Per-test buffer of console.error + uncaught pageerror events. Attached
  // in afterEach on failure so root-cause analysis has the JS-side view
  // (Supabase client errors, React error boundary output, network parse
  // failures) alongside the HAR and traces.
  const errs: string[] = [];
  consoleErrors.set(page, errs);
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errs.push(`[console.error] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    errs.push(`[pageerror] ${err.name}: ${err.message}\n${err.stack ?? ""}`);
  });

  page.on("requestfailed", (req) => {
    const url = req.url();
    if (!isDashboardDataUrl(url)) return;
    // Playwright reports user-initiated aborts here too; ignore those since
    // they happen on navigation/unload and are not real failures.
    const failure = req.failure()?.errorText ?? "";
    if (/aborted|cancelled|ERR_ABORTED/i.test(failure)) return;
    bucket.push(`requestfailed ${req.method()} ${url} — ${failure}`);
  });

  page.on("response", (resp) => {
    const url = resp.url();
    if (!isDashboardDataUrl(url)) return;
    if (resp.status() >= 500) {
      bucket.push(`http ${resp.status()} ${resp.request().method()} ${url}`);
    }
  });
});

// On any failure, capture a full-page screenshot AND the rendered HTML into
// the per-test output dir so CI's `test-results/` artifact upload includes
// both. `trace`, `screenshot`, and `video` are already retained on failure
// via playwright.config.ts — this adds the DOM snapshot for post-mortem.
//
// Retry-aware capture: Playwright creates a per-attempt output dir
// (`test-results/<test>-retry<N>/`) so each attempt's artifacts are isolated.
// We tag filenames + attachments with the attempt index so it's obvious in
// the CI report which snapshot came from the FINAL (last) retry — the run
// that actually decided the test outcome. The shared /tmp mirror is only
// written on the final attempt (retry === project.retries) so local /
// artifact consumers always see the definitive failing run, not a superseded
// earlier attempt.
test.afterEach(async ({ page }, testInfo) => {
  // Assert the "no failed dashboard data requests" invariant BEFORE bailing
  // on already-failed tests, so a green test that quietly leaked a 5xx or
  // requestfailed event still fails the run.
  const failures = failedRequests.get(page) ?? [];
  if (testInfo.status === testInfo.expectedStatus) {
    expect(
      failures,
      `Dashboard data requests failed during "${testInfo.title}":\n${failures.join("\n")}`,
    ).toEqual([]);
    return;
  }
  const attempt = testInfo.retry; // 0 = first run, 1..N = retries
  const maxRetries = testInfo.project.retries ?? 0;
  const isFinalAttempt = attempt >= maxRetries;
  const attemptTag = `attempt${attempt + 1}-of-${maxRetries + 1}${isFinalAttempt ? "-final" : ""}`;
  try {
    const safe = testInfo.title.replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
    const shotPath = testInfo.outputPath(`failure-${safe}-${attemptTag}.png`);
    const htmlPath = testInfo.outputPath(`failure-${safe}-${attemptTag}.html`);
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => "");
    if (html) fs.writeFileSync(htmlPath, html);
    await testInfo
      .attach(`failure-screenshot-${attemptTag}`, { path: shotPath, contentType: "image/png" })
      .catch(() => {});
    if (html)
      await testInfo
        .attach(`failure-html-${attemptTag}`, { path: htmlPath, contentType: "text/html" })
        .catch(() => {});
    if (failures.length) {
      await testInfo
        .attach(`failed-dashboard-requests-${attemptTag}`, {
          body: failures.join("\n"),
          contentType: "text/plain",
        })
        .catch(() => {});
    }
    // Attach buffered console errors + pageerror events. Written even when
    // the buffer is empty so triage always sees a definitive "no JS-side
    // errors" signal alongside the HAR.
    const errs = consoleErrors.get(page) ?? [];
    const consoleLogPath = testInfo.outputPath(`console-errors-${safe}-${attemptTag}.log`);
    const consoleBody = errs.length
      ? errs.join("\n\n")
      : "(no console.error or pageerror events captured during this attempt)";
    try {
      fs.writeFileSync(consoleLogPath, consoleBody);
    } catch {}
    await testInfo
      .attach(`console-errors-${attemptTag}`, {
        body: consoleBody,
        contentType: "text/plain",
      })
      .catch(() => {});

    // Mirror into the shared /tmp dir ONLY for the final attempt so local
    // consumers / downstream tooling always reflect the actual failing run
    // (earlier retry attempts are superseded and would otherwise clobber
    // the definitive artifacts).
    if (isFinalAttempt) {
      try {
        fs.copyFileSync(shotPath, `${SCREENSHOT_DIR}/${safe}.png`);
        if (html) fs.writeFileSync(`${SCREENSHOT_DIR}/${safe}.html`, html);
        try {
          fs.writeFileSync(`${SCREENSHOT_DIR}/${safe}.console.log`, consoleBody);
        } catch {}

        fs.writeFileSync(
          `${SCREENSHOT_DIR}/${safe}.meta.json`,
          JSON.stringify(
            {
              attempt: attempt + 1,
              totalAttempts: maxRetries + 1,
              final: true,
              status: testInfo.status,
              expectedStatus: testInfo.expectedStatus,
              project: testInfo.project.name,
              title: testInfo.title,
              timestamp: new Date().toISOString(),
            },
            null,
            2,
          ),
        );
      } catch {}
    }
  } catch {
    // best-effort — never mask the original failure
  }
});

test("Dashboard loads and payments list renders with receipt_no (no SQL errors)", async ({
  page,
}) => {
  // Capture browser console + failed responses so we can assert on them.
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  const sqlErrorHits: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      consoleErrors.push(text);
      if (/payments\.payment_id|does not exist|column .* does not exist/i.test(text)) {
        sqlErrorHits.push(`console: ${text}`);
      }
    }
  });
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!/supabase|\/rest\/v1\//i.test(url)) return;
    if (resp.status() >= 400) {
      const body = await resp.text().catch(() => "");
      badResponses.push(`${resp.status()} ${url} — ${body.slice(0, 300)}`);
      if (/payments\.payment_id|does not exist/i.test(body)) {
        sqlErrorHits.push(`http: ${resp.status()} ${body.slice(0, 200)}`);
      }
    }
  });

  await seedSession(page);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

  // 1) The error UI must never surface for this bug.
  const errorAlert = page.getByRole("alert").filter({ hasText: /Failed to load dashboard data/i });
  await expect(errorAlert).toHaveCount(0, { timeout: 20_000 });

  // 2) The dashboard header lands (proves fetch_success + hydration).
  await expect(page.getByText(/PRECISE REALTORS & BUILDERS/i).first()).toBeVisible({
    timeout: 20_000,
  });

  await page.screenshot({ path: `${SCREENSHOT_DIR}/1_dashboard.png` });

  // 3) The "Recent Payments" list is present, and each rendered receipt code
  //    is a non-empty string (i.e. `receipt_no` was read, not the missing
  //    `payment_id`). We tolerate a completely empty dataset.
  const receiptCells = page
    .locator('[class*="font-mono"]')
    .filter({ hasText: /^[A-Za-z0-9\-\/]+$/ });
  const receiptCount = await receiptCells.count();
  if (receiptCount > 0) {
    for (let i = 0; i < Math.min(receiptCount, 5); i++) {
      const text = (await receiptCells.nth(i).innerText()).trim();
      expect(text.length, `receipt cell ${i} should have content`).toBeGreaterThan(0);
      expect(text, `receipt cell ${i} should not be a UUID placeholder`).not.toMatch(
        /^undefined$|^null$/,
      );
    }
  }

  // 4) No SQL error about payments.payment_id anywhere.
  expect(
    sqlErrorHits,
    `Expected zero payments.payment_id SQL errors, saw:\n${sqlErrorHits.join("\n")}`,
  ).toEqual([]);

  // 5) No REST 4xx from Supabase referencing the payments table.
  const paymentsFailures = badResponses.filter((r) => /payments/i.test(r));
  expect(
    paymentsFailures,
    `Expected zero failed payments requests, saw:\n${paymentsFailures.join("\n")}`,
  ).toEqual([]);
});

test("Dashboard never triggers a payment_id SQL error and the error alert stays hidden", async ({
  page,
}) => {
  // Broad-signal guard: watch every channel where a stale `payment_id`
  // reference could surface (console, page errors, network bodies) and
  // assert the visible error alert never appears during the full dashboard
  // lifecycle: initial load, settle, and a short interaction window.
  const paymentIdHits: string[] = [];

  const scan = (source: string, text: string) => {
    if (!text) return;
    if (
      /payments?\.payment_id\b/i.test(text) ||
      /column\s+["']?payments?["']?\.["']?payment_id["']?\s+does not exist/i.test(text) ||
      /column\s+payment_id\s+does not exist/i.test(text)
    ) {
      paymentIdHits.push(`${source}: ${text.slice(0, 300)}`);
    }
  };

  page.on("console", (msg) => scan(`console.${msg.type()}`, msg.text()));
  page.on("pageerror", (err) => scan("pageerror", `${err.name}: ${err.message}`));
  page.on("requestfailed", (req) =>
    scan("requestfailed", `${req.method()} ${req.url()} — ${req.failure()?.errorText ?? ""}`),
  );
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!/supabase|\/rest\/v1\//i.test(url)) return;
    const status = resp.status();
    if (status < 400) {
      // Even 200s can contain PostgREST error bodies on batched RPCs — cheap to scan.
      if (!/payments/i.test(url)) return;
    }
    const body = await resp.text().catch(() => "");
    scan(`http.${status}`, `${url} — ${body}`);
  });

  await seedSession(page);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

  const errorAlert = page.getByRole("alert").filter({ hasText: /Failed to load dashboard data/i });

  // Header proves the dashboard reached fetch_success and rendered.
  await expect(page.getByText(/PRECISE REALTORS & BUILDERS/i).first()).toBeVisible({
    timeout: 20_000,
  });

  // Alert must be hidden right after mount…
  await expect(errorAlert).toHaveCount(0);

  // …and stay hidden through the settle window (background refetches, retries).
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2_000);
  await expect(errorAlert).toHaveCount(0);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/2_no_error_alert.png` });

  expect(
    paymentIdHits,
    `Dashboard emitted payment_id-related SQL errors:\n${paymentIdHits.join("\n")}`,
  ).toEqual([]);
});

/**
 * Slow-network guard: throttle every Supabase / REST call by ~1.2s and confirm
 * the "Failed to load dashboard data" error alert *never* appears — at mount,
 * after `networkidle`, and after an extended settle window. Any code path
 * that retries the payments query with a stale `payment_id` column would
 * eventually surface here.
 */
test("Slow network — payment_id error alert stays hidden across mount, idle, and long settle", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);

  const paymentIdHits: string[] = [];
  const scan = (source: string, text: string) => {
    if (!text) return;
    if (
      /payments?\.payment_id\b/i.test(text) ||
      /column\s+["']?payments?["']?\.["']?payment_id["']?\s+does not exist/i.test(text) ||
      /column\s+payment_id\s+does not exist/i.test(text)
    ) {
      paymentIdHits.push(`${source}: ${text.slice(0, 300)}`);
    }
  };
  page.on("console", (msg) => scan(`console.${msg.type()}`, msg.text()));
  page.on("pageerror", (err) => scan("pageerror", `${err.name}: ${err.message}`));
  page.on("response", async (resp) => {
    if (!/supabase|\/rest\/v1\//i.test(resp.url())) return;
    if (resp.status() < 400 && !/payments/i.test(resp.url())) return;
    const body = await resp.text().catch(() => "");
    scan(`http.${resp.status()}`, `${resp.url()} — ${body}`);
  });

  // Throttle all Supabase REST + edge traffic by ~1.2s per request. We only
  // delay — we never rewrite the response — so live schema/order guarantees
  // still apply.
  const THROTTLE_MS = 1200;
  await context.route(/supabase|\/rest\/v1\/|\/functions\/v1\//i, async (route) => {
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
    await route.continue();
  });

  await seedSession(page);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

  const errorAlert = page.getByRole("alert").filter({ hasText: /Failed to load dashboard data/i });

  // 1) Immediately after mount — nothing has loaded yet, alert must be absent.
  await expect(errorAlert).toHaveCount(0);

  // 2) Header eventually lands even under throttling (fetch_success path).
  await expect(page.getByText(/PRECISE REALTORS & BUILDERS/i).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(errorAlert).toHaveCount(0);

  // 3) Networkidle window — every throttled request has drained.
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await expect(errorAlert).toHaveCount(0);

  // 4) Long settle — allow retries / background refetches to fire once more.
  await page.waitForTimeout(8_000);
  await expect(errorAlert).toHaveCount(0);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/3_slow_network_no_alert.png` });

  expect(
    paymentIdHits,
    `Slow-network run emitted payment_id-related SQL errors:\n${paymentIdHits.join("\n")}`,
  ).toEqual([]);
});

/**
 * Recent Payments table (Payments page) — the canonical list rendered from the
 * same Supabase payments query the Dashboard depends on. This guards two
 * invariants at once:
 *   (a) every visible row exposes a real `receipt_no` (never blank / "null" /
 *       "undefined" — which is what a stale `payment_id` lookup would produce)
 *   (b) rows are sorted by `payment_date` DESC (matches the `.order(
 *       "payment_date", { ascending: false })` in src/pages/Payments.tsx)
 * A regression in either the SELECT list or the ORDER BY clause fails here.
 */
test("Recent Payments table renders receipt_no and is sorted by payment_date DESC", async ({
  page,
}) => {
  const sqlErrorHits: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (/payments\.payment_id|column .* does not exist/i.test(t))
      sqlErrorHits.push(`console: ${t}`);
  });
  page.on("response", async (resp) => {
    if (!/supabase|\/rest\/v1\/payments/i.test(resp.url())) return;
    if (resp.status() < 400) return;
    const body = await resp.text().catch(() => "");
    if (/payments\.payment_id|does not exist/i.test(body)) {
      sqlErrorHits.push(`http ${resp.status()}: ${body.slice(0, 200)}`);
    }
  });

  await seedSession(page);
  await page.goto(`${BASE}/payments`, { waitUntil: "domcontentloaded" });

  // Table lands (empty state is acceptable — we assert on it below).
  const table = page.locator("table").first();
  await expect(table).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => {});

  const rowLocator = table
    .locator("tbody > tr")
    .filter({ hasNot: page.locator('td[colspan="9"]') });
  const rowCount = await rowLocator.count();

  if (rowCount === 0) {
    // Empty dataset is a valid state — nothing to sort, but the "No payments…"
    // placeholder must be shown (guarding the render path from silently failing).
    await expect(table.locator("tbody")).toContainText(/No payments/i);
  } else {
    const receiptTexts: string[] = [];
    const dateTexts: string[] = [];
    const sample = Math.min(rowCount, 25);
    for (let i = 0; i < sample; i++) {
      const cells = rowLocator.nth(i).locator("td");
      receiptTexts.push((await cells.nth(0).innerText()).trim());
      dateTexts.push((await cells.nth(1).innerText()).trim());
    }

    // (a) receipt_no rendering — every cell has real content
    for (let i = 0; i < receiptTexts.length; i++) {
      const r = receiptTexts[i];
      expect(r.length, `row ${i} receipt_no should be non-empty`).toBeGreaterThan(0);
      expect(r, `row ${i} receipt_no should not be a null/undefined placeholder`).not.toMatch(
        /^(null|undefined|—|-)$/i,
      );
    }

    // (b) sort — dates are non-increasing when parsed from the `dd-MMM-yyyy`
    // format produced by fmtDate() in src/lib/format.ts.
    const timestamps = dateTexts.map((d) => {
      const t = Date.parse(d);
      expect(Number.isFinite(t), `row date "${d}" should parse via Date.parse`).toBe(true);
      return t;
    });
    for (let i = 1; i < timestamps.length; i++) {
      expect(
        timestamps[i],
        `row ${i} date (${dateTexts[i]}) must be <= row ${i - 1} date (${dateTexts[i - 1]}) — payment_date DESC order broken`,
      ).toBeLessThanOrEqual(timestamps[i - 1]);
    }
  }

  expect(
    sqlErrorHits,
    `Recent Payments emitted payment_id-related SQL errors:\n${sqlErrorHits.join("\n")}`,
  ).toEqual([]);
});

/**
 * Detector self-check: proves the missing-column scanner catches ANY unknown
 * payments column (not just `payment_id`). Uses synthetic error strings — no
 * network required — so a broken detector fails CI before it silently green-
 * lights a real schema regression against fields like `payment_date`,
 * `bank_name`, `paid_at`, etc.
 */
test("Detector catches missing-column signals for any payments field (not just payment_id)", async ({
  page,
}) => {
  // Sanity: known-good column is NOT flagged even in an error-shaped string.
  expect(detectPaymentsMissingColumns(`column payments.payment_date does not exist`)).toEqual([]);
  expect(detectPaymentsMissingColumns(`column payments.amount does not exist`)).toEqual([]);

  // Regression cases — each unknown column must be surfaced exactly once.
  const cases: Array<{ text: string; url?: string; expect: string[] }> = [
    { text: `error: column payments.payment_id does not exist`, expect: ["payment_id"] },
    { text: `error: column payments.bank_name does not exist`, expect: ["bank_name"] },
    { text: `error: column payments.paid_at does not exist`, expect: ["paid_at"] },
    {
      text: `error: column "txn_id" does not exist` /* payments-scoped via URL */,
      url: "/rest/v1/payments?select=*",
      expect: ["txn_id"],
    },
    {
      text: `{"code":"PGRST204","message":"Could not find the 'reference_no' column of 'payments' in the schema cache"}`,
      expect: ["reference_no"],
    },
    { text: `select payments.legacy_ref from payments`, expect: ["legacy_ref"] },
    // Multi-hit in one blob should dedupe.
    {
      text: `column payments.foo does not exist\ncolumn payments.foo does not exist`,
      expect: ["foo"],
    },
  ];
  for (const c of cases) {
    expect(
      detectPaymentsMissingColumns(c.text, c.url),
      `detector missed unknown columns in: ${c.text.slice(0, 80)}`,
    ).toEqual(c.expect);
  }

  // Unrelated-table errors must NOT be attributed to payments.
  expect(detectPaymentsMissingColumns(`column bookings.foo does not exist`)).toEqual([]);
  expect(detectPaymentsMissingColumns(`column "foo" does not exist`, "/rest/v1/bookings")).toEqual(
    [],
  );

  // And the live dashboard still holds the "alert stays hidden" invariant
  // while the detector is armed — no synthetic errors should slip through.
  await seedSession(page);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/PRECISE REALTORS & BUILDERS/i).first()).toBeVisible({
    timeout: 20_000,
  });
  const errorAlert = page.getByRole("alert").filter({ hasText: /Failed to load dashboard data/i });
  await expect(errorAlert).toHaveCount(0);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1_500);
  await expect(errorAlert).toHaveCount(0);

  // The beforeEach-installed snapshotter feeds into paymentIdHits(page); any
  // real missing-column signal from the live app fails the run here.
  expect(
    paymentIdHits(page),
    `Live dashboard emitted payments missing-column errors:\n${paymentIdHits(page).join("\n")}`,
  ).toEqual([]);
});

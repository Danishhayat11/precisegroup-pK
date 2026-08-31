import {
  test as base,
  expect,
  type ConsoleMessage,
  type Request,
  type Response,
} from "@playwright/test";

/**
 * Shared Playwright fixture for the breadcrumbs-overflow ARIA specs.
 *
 * ── Why a custom fixture ──────────────────────────────────────────────
 * The overflow specs exercise Radix DropdownMenu portals, keyboard
 * activation, and hydration timing — three things that historically
 * produce flakes that are HARD to diagnose from CI logs alone
 * ("expected menu to be visible; got count=0" tells you nothing).
 *
 * This fixture upgrades those specs so that when they flake, the
 * failing attempt ships with:
 *
 *   1. A Playwright *trace* (already retained on failure by
 *      playwright.config.ts `trace: 'retain-on-failure'`). We force
 *      `trace.start({ screenshots, snapshots, sources })` here so
 *      DOM snapshots and source-mapped stacks are always included,
 *      not just action timings.
 *   2. The full browser *console log* (every level) captured live
 *      into an in-memory buffer and attached as `console.log` on
 *      test failure. Radix warnings, React hydration mismatches,
 *      and our own `console.warn` calls all land here.
 *   3. A *network log* — one line per request with method, URL,
 *      final status, and failure reason. Portalled menus rely on
 *      route-level data (breadcrumb crumbs, auth session), so a
 *      404/500 on a background fetch is often the real root cause
 *      of "menu opened but items were wrong".
 *
 * Everything is attached ONLY on failure via `test.info().attach()`,
 * which keeps green runs fast and clean. On success the buffers are
 * dropped without touching disk.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   import { test, expect } from './_overflowDebugFixture';
 *
 *   test('...', async ({ page }) => { ... });
 *
 * No further wiring per-spec is required — the fixture is `auto: true`
 * so every test in the file that imports this `test` object gets the
 * console/network capture and forced-trace behaviour automatically.
 */

type CapturedConsole = {
  type: string;
  text: string;
  location?: string;
  timestamp: string;
};

type CapturedRequest = {
  method: string;
  url: string;
  status: number | null;
  failure: string | null;
  timestamp: string;
};

export const test = base.extend<{ overflowDebugCapture: void }>({
  overflowDebugCapture: [
    async ({ page, context }, use) => {
      const consoleEntries: CapturedConsole[] = [];
      const networkEntries: CapturedRequest[] = [];
      const requestStartById = new Map<string, string>();

      const onConsole = (msg: ConsoleMessage) => {
        const loc = msg.location();
        consoleEntries.push({
          type: msg.type(),
          text: msg.text(),
          location: loc?.url ? `${loc.url}:${loc.lineNumber}:${loc.columnNumber}` : undefined,
          timestamp: new Date().toISOString(),
        });
      };

      const onPageError = (err: Error) => {
        consoleEntries.push({
          type: "pageerror",
          text: `${err.name}: ${err.message}\n${err.stack ?? ""}`,
          timestamp: new Date().toISOString(),
        });
      };

      const onRequest = (req: Request) => {
        // Store start time keyed by request identity so we can compute
        // per-request duration if we want it later. For now we use it
        // as a stable dedupe key across the request/response pair.
        requestStartById.set(reqKey(req), new Date().toISOString());
      };

      const onResponse = (res: Response) => {
        const req = res.request();
        networkEntries.push({
          method: req.method(),
          url: req.url(),
          status: res.status(),
          failure: null,
          timestamp: requestStartById.get(reqKey(req)) ?? new Date().toISOString(),
        });
      };

      const onRequestFailed = (req: Request) => {
        networkEntries.push({
          method: req.method(),
          url: req.url(),
          status: null,
          failure: req.failure()?.errorText ?? "unknown failure",
          timestamp: requestStartById.get(reqKey(req)) ?? new Date().toISOString(),
        });
      };

      page.on("console", onConsole);
      page.on("pageerror", onPageError);
      page.on("request", onRequest);
      page.on("response", onResponse);
      page.on("requestfailed", onRequestFailed);

      // Force-start a rich trace for every test. `retain-on-failure` in
      // playwright.config.ts controls whether the trace is *kept* — this
      // just guarantees screenshots, DOM snapshots, and source frames
      // are inside the trace when it is kept. If tracing is already
      // running (e.g. via a project-level config), start() is a no-op
      // that throws; guard it so we don't fail the test setup.
      try {
        await context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true,
          title: test.info().title,
        });
      } catch {
        // Tracing already active — fine, playwright.config handles retention.
      }

      // Run the test.
      await use();

      // Detach listeners so background traffic after the test body
      // doesn't keep growing the buffers (matters for shard reuse).
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);

      // Only attach artifacts when the test failed. `test.info().status`
      // is populated after the body runs; `failed` and `timedOut` both
      // signal a bad outcome that a human will want to debug.
      const info = test.info();
      const failed = info.status !== info.expectedStatus;

      if (failed) {
        await info.attach("console.log", {
          body: consoleEntries
            .map(
              (e) =>
                `[${e.timestamp}] ${e.type.toUpperCase()} ${e.text}${e.location ? `  (${e.location})` : ""}`,
            )
            .join("\n"),
          contentType: "text/plain",
        });
        await info.attach("network.log", {
          body: networkEntries
            .map((e) => {
              const status = e.failure ? `FAIL(${e.failure})` : String(e.status);
              return `[${e.timestamp}] ${e.method.padEnd(6)} ${status.padEnd(20)} ${e.url}`;
            })
            .join("\n"),
          contentType: "text/plain",
        });
      }
    },
    { auto: true },
  ],
});

export { expect };

function reqKey(req: Request): string {
  // Playwright doesn't give a stable id; the (method,url,timing) triple
  // is unique enough for dedupe within a single test.
  return `${req.method()} ${req.url()}`;
}

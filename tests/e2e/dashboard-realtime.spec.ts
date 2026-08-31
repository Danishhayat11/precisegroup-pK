/**
 * E2E: dashboard realtime plumbing.
 *
 * Simulates Supabase `postgres_changes` INSERT / UPDATE / DELETE events
 * against the tables the dashboard subscribes to, and verifies the
 * dashboard reacts — i.e. React Query invalidates and re-fetches the
 * underlying data — without a manual page reload.
 *
 * How we "simulate" without touching the real database
 * ----------------------------------------------------
 * The dashboard subscribes to `bookings` / `units` / `payments` /
 * `adjustments` / `installment_ledger` via `supabase.channel(...)` and
 * calls `queryClient.invalidateQueries({ queryKey: ['dashboard'] })`
 * on every event. That handler does NOT inspect the event payload — it
 * treats INSERT, UPDATE and DELETE identically.
 *
 * We import the already-mounted Supabase client via Vite's dev-server
 * module URL (`/src/integrations/supabase/client.ts`), find the live
 * dashboard channel with `supabase.getChannels()`, and dispatch a
 * synthetic `postgres_changes` payload with `channel._trigger(...)` —
 * the same code path Realtime uses internally when a real DB event
 * arrives. This exercises the ACTUAL subscription callback, not a
 * test double, so any regression in the subscribe / filter / cleanup
 * wiring is caught.
 *
 * The verification is a network-side proof: we count outbound
 * requests to Supabase's REST/RPC surface before and after each
 * simulated event, and assert new requests were issued. That's the
 * definitive signal that "the dashboard updated in real time" — a
 * refetch happened without navigation, keystroke, or refresh.
 *
 * Auth: this route lives under `_authenticated/`, so the spec skips
 * cleanly when no Supabase session is seeded (mirrors the header /
 * responsive suites).
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

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
 * Dispatch a synthetic `postgres_changes` event onto the running
 * dashboard channel. Returns the number of channels found matching
 * `dashboard-live` (must be ≥1 for the test to be meaningful).
 */
async function dispatchRealtimeEvent(
  page: Page,
  table: string,
  eventType: "INSERT" | "UPDATE" | "DELETE",
) {
  return await page.evaluate(
    async ({ table, eventType }) => {
      // Vite serves TS source at its on-disk path in dev mode — this
      // reuses the SAME module instance the app already mounted, so
      // `getChannels()` returns the live subscriptions (not a fresh
      // client that would have zero channels).
      const mod = await import(/* @vite-ignore */ "/src/integrations/supabase/client.ts");
      const client = (mod as { supabase: unknown }).supabase as {
        getChannels: () => Array<{
          topic: string;
          _trigger?: (type: string, payload: unknown, ref?: string) => void;
        }>;
      };
      const channels = client.getChannels();
      const dash = channels.find((c) => c.topic.includes("dashboard-live"));
      if (!dash || typeof dash._trigger !== "function") {
        return { matched: 0, topics: channels.map((c) => c.topic) };
      }
      // Shape mirrors realtime-js's PostgresChangesPayload. The
      // dashboard handler ignores payload contents, but we build a
      // realistic one so the test doubles as documentation of the
      // wire format.
      const now = new Date().toISOString();
      const row =
        table === "bookings"
          ? { id: "e2e-fake", project_code: "E2E", updated_at: now }
          : { id: "e2e-fake", updated_at: now };
      const payload = {
        schema: "public",
        table,
        commit_timestamp: now,
        eventType,
        new: eventType === "DELETE" ? {} : row,
        old: eventType === "INSERT" ? {} : row,
        errors: null,
      };
      dash._trigger("postgres_changes", payload);
      return { matched: 1, topics: [dash.topic] };
    },
    { table, eventType },
  );
}

test.describe("dashboard realtime — simulated postgres_changes events", () => {
  test.skip(!HAS_SESSION, "No Supabase session seeded — dashboard is auth-only.");

  test("INSERT / UPDATE / DELETE on subscribed tables refetch dashboard data", async ({ page }) => {
    // Track outbound Supabase REST/RPC calls. That's the ground truth
    // for "dashboard refetched" — React Query invalidation without a
    // network request would be a no-op.
    const restRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (/\/rest\/v1\/|\/functions\/v1\/|\/graphql\/v1/.test(url)) {
        restRequests.push(url);
      }
    });

    await seedSession(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });

    // Wait for the dashboard shell + first data paint. Any of these
    // signals proves loaders resolved and the realtime `useEffect`
    // has had a chance to subscribe.
    await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });
    // Give the realtime WebSocket handshake a moment — the channel
    // is created in a useEffect that fires after paint, and
    // `getChannels()` won't return it until subscribe() runs.
    await page.waitForFunction(
      async () => {
        try {
          const mod = await import(/* @vite-ignore */ "/src/integrations/supabase/client.ts");
          const client = (mod as { supabase: { getChannels: () => Array<{ topic: string }> } })
            .supabase;
          return client.getChannels().some((c) => c.topic.includes("dashboard-live"));
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: 15_000 },
    );

    // Give initial loaders a beat to flush so our "before" baseline
    // for each event is stable.
    await page.waitForTimeout(750);

    const cases: Array<{
      table: string;
      eventType: "INSERT" | "UPDATE" | "DELETE";
    }> = [
      { table: "bookings", eventType: "INSERT" },
      { table: "payments", eventType: "UPDATE" },
      { table: "adjustments", eventType: "DELETE" },
      { table: "units", eventType: "INSERT" },
      { table: "installment_ledger", eventType: "UPDATE" },
    ];

    for (const { table, eventType } of cases) {
      const before = restRequests.length;

      const result = await dispatchRealtimeEvent(page, table, eventType);
      expect(
        result.matched,
        `expected a live dashboard-live channel to receive the ${eventType} on ${table}; found channels: ${JSON.stringify(result.topics)}`,
      ).toBeGreaterThan(0);

      // Wait for the invalidation → refetch round-trip. React Query
      // fires the request on the next tick; the network response
      // comes back within a normal Supabase latency window.
      await page.waitForFunction(
        (baseline: number) =>
          (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((e) =>
            /\/rest\/v1\/|\/functions\/v1\/|\/graphql\/v1/.test(e.name),
          ).length > baseline,
        before,
        { timeout: 10_000 },
      );

      const delta = restRequests.length - before;
      expect(
        delta,
        `${eventType} on ${table} did not trigger a dashboard refetch (0 new Supabase requests observed)`,
      ).toBeGreaterThan(0);
    }

    // No dashboard errors should have surfaced during the simulated
    // event burst — a broken invalidation path often shows up as a
    // React Query "error" toast or a boundary render.
    await expect(page.locator("text=/Something went wrong|Failed to load/i")).toHaveCount(0);
  });
});

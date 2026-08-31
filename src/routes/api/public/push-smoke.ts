/**
 * Runtime smoke test for the Web Push server flow.
 *
 * GET /api/public/push-smoke
 *
 * Loads `@/lib/push.server` (which statically imports `webpush-webcrypto`)
 * and calls `pushSmokeCheck()`, which exercises the module's crypto path
 * against ephemeral keys — no VAPID env, no DB, no real push endpoint.
 *
 * Purpose: confirm in production that `webpush-webcrypto` resolves and its
 * WebCrypto call graph works on the Cloudflare Worker runtime. If the
 * module fails to load or sign, this endpoint returns 500 with the error.
 *
 * Public prefix (`/api/public/*`) bypasses auth. The check is read-only,
 * takes no input, and returns no secrets, so no signature/token guard is
 * required. Optionally set `PUSH_SMOKE_TOKEN` to gate it — when set, the
 * request must send `x-smoke-token: <value>`.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/push-smoke")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const gate = process.env.PUSH_SMOKE_TOKEN;
        if (gate) {
          const sent = request.headers.get("x-smoke-token");
          if (sent !== gate) {
            return new Response("Forbidden", { status: 403 });
          }
        }

        const started = Date.now();
        try {
          const { pushSmokeCheck } = await import("@/lib/push.server");
          const result = await pushSmokeCheck();
          return Response.json(
            { ...result, durationMs: Date.now() - started },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return Response.json(
            { ok: false, error: message, durationMs: Date.now() - started },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});

/**
 * Shared authentication for /api/public/* cron endpoints.
 *
 * Cron routes MUST NOT authorize with the Supabase publishable/anon key —
 * that key ships in the client bundle and is trivially replayable. Instead
 * verify a server-only CRON_SECRET sent as a Bearer token, using a
 * timing-safe comparison.
 *
 * pg_cron jobs should send `Authorization: Bearer <CRON_SECRET>`.
 */
import { timingSafeEqual } from "node:crypto";

export function verifyCronSecret(request: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return new Response(JSON.stringify({ error: "cron secret not configured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const header = request.headers.get("authorization") || request.headers.get("x-cron-secret") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();

  if (!presented) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}

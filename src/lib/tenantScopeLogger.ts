/**
 * Global server-function middleware that logs the authenticated user_id and
 * their current_company_id for every server function invocation.
 *
 * Purpose: give operators a per-request audit trail confirming that every
 * database query is scoped to the correct tenant. RLS still enforces the
 * scoping; this middleware surfaces it in the server logs so it can be
 * verified end-to-end.
 *
 * Log format (one line per call):
 *   [tenant-scope] fn=<path> user=<uuid|anon> company=<uuid|-> status=<ok|err> ms=<n>
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type CachedCompany = { companyId: string | null; expiresAt: number };
const COMPANY_TTL_MS = 5 * 60 * 1000;
const companyCache = new Map<string, CachedCompany>();

function decodeJwtSub(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { sub?: string };
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

async function resolveCompanyId(token: string, userId: string): Promise<string | null> {
  const now = Date.now();
  const cached = companyCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.companyId;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  try {
    const client = createClient<Database>(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data } = await client.rpc("current_company_id");
    const companyId = typeof data === "string" ? data : null;
    companyCache.set(userId, { companyId, expiresAt: now + COMPANY_TTL_MS });
    return companyId;
  } catch {
    return null;
  }
}

export const tenantScopeLogger = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const started = Date.now();
  const request = (() => {
    try {
      return getRequest();
    } catch {
      return null;
    }
  })();

  const path = request ? new URL(request.url).pathname + new URL(request.url).search : "-";
  const authHeader = request?.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const userId = token ? decodeJwtSub(token) : null;

  // Kick off company lookup in parallel; don't block the handler on it.
  const companyPromise = token && userId ? resolveCompanyId(token, userId) : Promise.resolve(null);

  let status: "ok" | "err" = "ok";
  try {
    return await next();
  } catch (e) {
    status = "err";
    throw e;
  } finally {
    const companyId = await companyPromise;
    const ms = Date.now() - started;

    console.info(
      `[tenant-scope] fn=${path} user=${userId ?? "anon"} company=${companyId ?? "-"} status=${status} ms=${ms}`,
    );
    // Persist to audit table (fire-and-forget; never block the response).
    void (async () => {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("tenant_scope_logs").insert({
          user_id: userId,
          company_id: companyId,
          fn_path: path,
          status,
          duration_ms: ms,
        });
      } catch {
        // Swallow: logging must never affect the request outcome.
      }
    })();
  }
});

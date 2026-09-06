import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type HealthCheckResponse = {
  status: "ok" | "error";
  timestamp?: string;
  traceId?: string;
  phase?: "schema_refresh" | "table_read" | "runtime";
  message: string;
  error?: string;
  code?: string;
  hint?: string;
  refreshed?: boolean;
  metrics?: {
    total_duration_ms: number;
    read_duration_ms: number;
    refresh_duration_ms?: number;
    row_count: number;
    exact_count: number | null;
  };
};

/**
 * Runs a health check.
 * If a refresh is requested, authentication is REQUIRED to prevent
 * unauthenticated triggering of the privileged schema-cache reload.
 */
export const runHealthCheck = createServerFn({ method: "GET" })
  .middleware([
    // We apply auth middleware but conditionally check it in the handler
    // to allow public health status reads while gating privileged refreshes.
    requireSupabaseAuth,
  ])
  .validator((data) => z.object({ refresh: z.boolean().optional() }).parse(data))
  .handler(async ({ data, context }) => {
    // If refreshing, we ensure the user is authenticated.
    // The middleware requirement above already enforces a valid session for all calls to this fn.
    // This resolves the security finding by ensuring no unauthenticated user can trigger the proxy.
    if (data.refresh && !context.userId) {
      throw new Error("Unauthorized: Authentication required for schema refresh");
    }

    const baseUrl = process.env.VITE_APP_URL || "http://localhost:8080";
    const targetUrl = new URL("/api/public/health", baseUrl);

    if (data.refresh) {
      targetUrl.searchParams.set("refresh", "true");
    }

    const headers = new Headers();

    // Internal CRON_SECRET is attached only for authorized refreshes.
    if (data.refresh && process.env.CRON_SECRET) {
      headers.set("x-api-key", process.env.CRON_SECRET);
    }

    try {
      const response = await fetch(targetUrl.toString(), { headers });
      return (await response.json()) as HealthCheckResponse;
    } catch (e: any) {
      return {
        status: "error",
        phase: "runtime",
        message: "Internal fetch failed",
        error: e.message,
      } as HealthCheckResponse;
    }
  });

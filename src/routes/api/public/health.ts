import { createFileRoute } from "@tanstack/react-router";
import { sendHealthAlert } from "@/lib/healthAlert.server";

/**
 * OpenTelemetry placeholder tracing for the health-check flow.
 */

class TraceSpan {
  constructor(
    public name: string,
    public traceId: string,
    public parentSpanId?: string,
    public attributes: Record<string, any> = {},
  ) {
    this.spanId = crypto.randomUUID();
    this.startTime = Date.now();
    console.log(
      `[OTEL][SpanStart] name=${name} traceId=${traceId} spanId=${this.spanId} parentSpanId=${parentSpanId || "root"}`,
    );
  }

  public spanId: string;
  public startTime: number;
  public endTime?: number;

  end(attributes: Record<string, any> = {}) {
    this.endTime = Date.now();
    const duration = this.endTime - this.startTime;
    Object.assign(this.attributes, attributes);
    console.log(
      `[OTEL][SpanEnd] name=${this.name} traceId=${this.traceId} spanId=${this.spanId} duration=${duration}ms attributes=${JSON.stringify(this.attributes)}`,
    );
  }
}

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const startTime = Date.now();
        const traceId = request.headers.get("x-trace-id") || crypto.randomUUID();
        const rootSpan = new TraceSpan("health-check-request", traceId, undefined, {
          url: request.url,
          method: "GET",
        });

        const url = new URL(request.url);
        const refresh = url.searchParams.get("refresh") === "true";
        const apiKey = request.headers.get("x-api-key");

        const CRON_SECRET = process.env["CRON_SECRET"];
        const isAuthorized = apiKey && CRON_SECRET && apiKey === CRON_SECRET;

        rootSpan.attributes["refresh_requested"] = refresh;
        rootSpan.attributes["is_authorized"] = !!isAuthorized;

        try {
          if (refresh && !isAuthorized) {
            rootSpan.end({ status: "unauthorized", status_code: 401 });
            return new Response(
              JSON.stringify({
                status: "error",
                traceId,
                phase: "schema_refresh",
                message: "Unauthorized: Missing or invalid API key",
                error: "Unauthorized: Missing or invalid API key",
                hint: "When ?refresh=true is used, you must provide a valid x-api-key header.",
              }),
              { status: 401, headers: { "Content-Type": "application/json" } },
            );
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          let refreshDuration = 0;

          if (refresh && isAuthorized) {
            const refreshSpan = new TraceSpan("schema-cache-refresh", traceId, rootSpan.spanId);
            const startRefresh = Date.now();
            const { error: refreshError } = await (supabaseAdmin.rpc as any)("reload_schema_cache");
            refreshDuration = Date.now() - startRefresh;

            if (refreshError) {
              refreshSpan.end({
                error: refreshError.message,
                code: refreshError.code,
                duration_ms: refreshDuration,
              });
              rootSpan.end({ status: "error", phase: "schema_refresh" });

              await sendHealthAlert({
                phase: "schema_refresh",
                message: "Failed to reload PostgREST schema cache.",
                error: refreshError.message,
                traceId,
              });

              return new Response(
                JSON.stringify({
                  status: "error",
                  traceId,
                  phase: "schema_refresh",
                  duration_ms: refreshDuration,
                  message: "Failed to reload PostgREST schema cache.",
                  error: refreshError.message,
                  code: refreshError.code,
                  hint: "Ensure the reload_schema_cache function exists and service_role has EXECUTE permissions.",
                }),
                { status: 500, headers: { "Content-Type": "application/json" } },
              );
            }

            refreshSpan.end({ success: true, duration_ms: refreshDuration });
          }

          // Verify marketing_controls read
          const readSpan = new TraceSpan("database-table-read", traceId, rootSpan.spanId, {
            table: "marketing_controls",
          });
          const startRead = Date.now();
          const { data, error, count } = await supabaseAdmin
            .from("marketing_controls")
            .select("section_key, is_enabled", { count: "exact" });
          const readDuration = Date.now() - startRead;

          if (error) {
            readSpan.end({ error: error.message, code: error.code, duration_ms: readDuration });
            const isSchemaError =
              error.code === "PGRST100" || error.message?.includes("Could not find the table");
            rootSpan.end({ status: "error", phase: "table_read" });

            await sendHealthAlert({
              phase: "table_read",
              message: isSchemaError
                ? "Schema discovery failed: table not found."
                : "Database query failed.",
              error: error.message,
              traceId,
            });

            return new Response(
              JSON.stringify({
                status: "error",
                traceId,
                phase: "table_read",
                duration_ms: readDuration,
                message: isSchemaError
                  ? "Schema discovery failed: table not found."
                  : "Database query failed.",
                error: error.message,
                code: error.code,
                hint: isSchemaError
                  ? "The table public.marketing_controls might be missing or PostgREST cache is stale. Try calling this endpoint with ?refresh=true and x-api-key header."
                  : "Check database connectivity and RLS/GRANT permissions for the service_role.",
              }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          readSpan.end({
            row_count: data?.length || 0,
            exact_count: count,
            duration_ms: readDuration,
          });
          const totalDuration = Date.now() - startTime;
          rootSpan.end({ status: "ok", status_code: 200, total_duration_ms: totalDuration });

          return new Response(
            JSON.stringify({
              status: "ok",
              traceId,
              timestamp: new Date().toISOString(),
              metrics: {
                total_duration_ms: totalDuration,
                read_duration_ms: readDuration,
                refresh_duration_ms: refreshDuration || undefined,
                row_count: data?.length || 0,
                exact_count: count,
              },
              refreshed: refresh && isAuthorized,
              read_success: true,
              data_sample: data,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        } catch (e: any) {
          rootSpan.end({ status: "exception", error: e.message });
          return new Response(
            JSON.stringify({
              status: "error",
              traceId,
              phase: "runtime",
              duration_ms: Date.now() - startTime,
              message: "An unexpected exception occurred in the health check handler.",
              error: e.message || "Unknown error",
              hint: "Check server logs for a full stack trace.",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});

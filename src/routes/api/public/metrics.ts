import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/metrics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestId = crypto.randomUUID();
        const startTime = Date.now();

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // We reuse the health check logic but format as Prometheus text
          const readStart = Date.now();
          const { data, error, count } = await supabaseAdmin
            .from("marketing_controls")
            .select("section_key", { count: "exact" });
          const readDuration = Date.now() - readStart;
          const totalDuration = Date.now() - startTime;

          if (error) {
            console.error(`[Metrics][${requestId}] Failed to fetch metrics:`, error);
            return new Response(
              `# HELP health_check_status Current status of the health check (1 = ok, 0 = error)\n# TYPE health_check_status gauge\nhealth_check_status 0\n`,
              {
                status: 500,
                headers: {
                  "Content-Type": "text/plain; version=0.0.4",
                  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                },
              },
            );
          }

          const metrics =
            [
              `# HELP health_check_status Current status of the health check (1 = ok, 0 = error)`,
              `# TYPE health_check_status gauge`,
              `health_check_status 1`,
              ``,
              `# HELP health_check_read_duration_ms Time taken to read marketing_controls in milliseconds`,
              `# TYPE health_check_read_duration_ms gauge`,
              `health_check_read_duration_ms ${readDuration}`,
              ``,
              `# HELP health_check_total_duration_ms Total request duration in milliseconds`,
              `# TYPE health_check_total_duration_ms gauge`,
              `health_check_total_duration_ms ${totalDuration}`,
              ``,
              `# HELP health_check_row_count Number of rows in marketing_controls`,
              `# TYPE health_check_row_count gauge`,
              `health_check_row_count ${data?.length || 0}`,
              ``,
              `# HELP health_check_exact_count Exact row count from database`,
              `# TYPE health_check_exact_count gauge`,
              `health_check_exact_count ${count || 0}`,
            ].join("\n") + "\n";

          return new Response(metrics, {
            status: 200,
            headers: {
              "Content-Type": "text/plain; version=0.0.4",
              "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            },
          });
        } catch (e: any) {
          console.error(`[Metrics][${requestId}] Unexpected error:`, e);
          return new Response(
            `# HELP health_check_status Current status of the health check (1 = ok, 0 = error)\n# TYPE health_check_status gauge\nhealth_check_status 0\n`,
            {
              status: 500,
              headers: {
                "Content-Type": "text/plain; version=0.0.4",
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
              },
            },
          );
        }
      },
    },
  },
});

import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "overdue_summary",
  title: "Overdue summary",
  description:
    "Return the top overdue bookings (highest total_overdue_amount first) with next_action guidance. Useful for daily collections triage.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .describe("Rows to return. Default 10, max 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("bookings")
      .select(
        "booking_id, client_name, project_name, unit_id, risk_level, current_overdue_count, total_overdue_amount, oldest_overdue_date, next_action, booking_status",
      )
      .gt("total_overdue_amount", 0)
      .neq("booking_status", "Cancelled")
      .order("total_overdue_amount", { ascending: false })
      .limit(Math.min(limit ?? 10, 50));
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const totalExposure = (data ?? []).reduce(
      (sum, r) => sum + Number(r.total_overdue_amount ?? 0),
      0,
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            count: data?.length ?? 0,
            total_overdue_exposure: totalExposure,
            rows: data,
          }),
        },
      ],
      structuredContent: {
        count: data?.length ?? 0,
        total_overdue_exposure: totalExposure,
        rows: data ?? [],
      },
    };
  },
});

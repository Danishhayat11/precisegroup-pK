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
  name: "list_bookings",
  title: "List bookings",
  description:
    "List real-estate bookings visible to the signed-in user. Supports optional status, risk-level, and project filters, and returns a compact summary suitable for further analysis.",
  inputSchema: {
    status: z
      .enum(["Active", "Cancelled", "Closed"])
      .optional()
      .describe("Filter by booking status."),
    risk_level: z
      .enum(["LOW", "MEDIUM", "HIGH"])
      .optional()
      .describe("Filter by computed risk level."),
    project_code: z.string().trim().optional().describe("Filter by project code (e.g. 'MA')."),
    limit: z
      .number()
      .int()
      .positive()
      .max(200)
      .optional()
      .describe("Max rows to return. Defaults to 50, hard cap 200."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, risk_level, project_code, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("bookings")
      .select(
        "booking_id, booking_date, project_code, project_name, unit_id, client_name, booking_status, risk_level, total_contract_value, remaining_balance, current_overdue_count, total_overdue_amount, next_action",
      )
      .order("booking_date", { ascending: false })
      .limit(Math.min(limit ?? 50, 200));
    if (status) q = q.eq("booking_status", status);
    if (risk_level) q = q.eq("risk_level", risk_level);
    if (project_code) q = q.eq("project_code", project_code);

    const { data, error } = await q;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ count: data?.length ?? 0, rows: data }) }],
      structuredContent: { count: data?.length ?? 0, rows: data ?? [] },
    };
  },
});

import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

/**
 * Escapes characters that have special meaning in PostgREST .or() filters.
 * Specifically commas (,) and parentheses ((), ()) which are used for
 * delimiter and nesting control in filter strings.
 */
function escapePostgrestFilter(val: string): string {
  return val.replace(/([,()])/g, "\\$1");
}

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "search_clients",
  title: "Search clients",
  description:
    "Search the clients directory by name, CNIC, or mobile number. Case-insensitive substring match. Returns up to 25 rows.",
  inputSchema: {
    query: z
      .string()
      .trim()
      .min(2)
      .describe("Substring to search across client_name, cnic, and mobile."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const escapedQuery = escapePostgrestFilter(query);
    const like = `%${escapedQuery}%`;
    const { data, error } = await sb
      .from("clients")
      .select("client_ref, client_name, cnic, mobile, address")
      .or(`client_name.ilike.${like},cnic.ilike.${like},mobile.ilike.${like}`)
      .limit(25);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify({ count: data?.length ?? 0, rows: data }) }],
      structuredContent: { count: data?.length ?? 0, rows: data ?? [] },
    };
  },
});

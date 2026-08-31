import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listBookingsTool from "./tools/list-bookings";
import getBookingTool from "./tools/get-booking";
import searchClientsTool from "./tools/search-clients";
import overdueSummaryTool from "./tools/overdue-summary";

// The OAuth issuer MUST be the direct Supabase host. On publish, SUPABASE_URL
// is rewritten to the `.lovable.cloud` proxy, which mcp-js rejects (RFC 8414
// issuer mismatch). The project ref is the only Supabase value that survives
// publish unchanged. `import.meta.env.VITE_SUPABASE_PROJECT_ID` is inlined by
// Vite at build time. The fallback keeps the issuer well-formed if the literal
// is unset during the throwaway manifest-extract eval; the published build
// inlines the real ref, and a token never verifies against the sentinel.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "precise-erp-mcp",
  title: "Precise ERP MCP",
  version: "0.1.0",
  instructions:
    "Precise Realtors & Builders ERP tools. Read-only access to bookings, clients, and collections data for the signed-in user. Use `overdue_summary` for daily triage, `list_bookings` to filter across the book, `get_booking` to drill into one deal, and `search_clients` to look up a party.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listBookingsTool, getBookingTool, searchClientsTool, overdueSummaryTool],
});

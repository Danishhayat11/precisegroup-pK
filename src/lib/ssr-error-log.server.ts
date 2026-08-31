// Fire-and-forget recorder for catastrophic-SSR fallback renders.
// Imported only from src/server.ts (Worker entry) — uses the service-role
// client because the Worker has no end-user session.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SsrErrorKind = "catastrophic" | "thrown";

export type RecordSsrErrorInput = {
  kind: SsrErrorKind;
  request: Request;
  errorId: string;
  error?: unknown;
};

function summarize(error: unknown): string | undefined {
  if (!error) return undefined;
  if (error instanceof Error) {
    const msg = error.message ?? "";
    return msg.length > 500 ? msg.slice(0, 500) + "…" : msg;
  }
  try {
    const s = typeof error === "string" ? error : JSON.stringify(error);
    return s.length > 500 ? s.slice(0, 500) + "…" : s;
  } catch {
    return String(error).slice(0, 500);
  }
}

export function recordSsrError({ kind, request, errorId, error }: RecordSsrErrorInput): void {
  let path = request.url;
  try {
    path = new URL(request.url).pathname + new URL(request.url).search;
  } catch {}

  const row = {
    kind,
    method: request.method,
    path: path.length > 1000 ? path.slice(0, 1000) : path,
    error_id: errorId,
    message: summarize(error),
    user_agent: (request.headers.get("user-agent") ?? "").slice(0, 500) || null,
  };

  // Fire-and-forget. We never want the recorder to block sending the
  // fallback HTML or to throw and surface to the user.
  Promise.resolve()
    .then(() => supabaseAdmin.from("ssr_error_events").insert(row))
    .then(({ error: insertError }) => {
      if (insertError) console.error("[ssr-error-log] insert failed:", insertError.message);
    })
    .catch((err) => console.error("[ssr-error-log] unexpected error:", err));
}

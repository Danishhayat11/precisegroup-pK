/**
 * Server-side admin gate for document generation, printing, and the
 * Document Vault. UI callers invoke `assertAdminDocumentAccess` before
 * rendering the print preview or the vault; the handler asks the DB to
 * confirm the current session belongs to an admin. Non-admins get a
 * 403-shaped error and the UI must block the action.
 *
 * Enforcement lives at three layers:
 *   1. Row-level security on `public.booking_documents` (admin-only writes).
 *   2. Row-level security on `storage.objects` for the `booking-documents`
 *      bucket (admin-only uploads / updates / deletes).
 *   3. This server function, so UI code paths that don't touch the DB
 *      (e.g. client-side PDF generation) still hit a server check first.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callServerRpc } from "@/integrations/supabase/serverRpc";

export const assertAdminDocumentAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { scope?: string } | undefined) => ({
    scope: input?.scope ?? "documents",
  }))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await callServerRpc(context.supabase, "assert_admin_access", {
      _scope: data.scope,
    });
    if (error) {
      // Bubble up as a plain Error so the client sees a 500-shaped rejection
      // it can display via toast; the DB helper already raised 42501.
      throw new Error(error.message || "Admin only");
    }
    return ok as { ok: true; scope: string; uid: string };
  });

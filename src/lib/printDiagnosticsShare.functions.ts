import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const BUCKET = "print-diagnostics";
// 7 days — long enough for teammates to inspect without a permanent link.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

const inputSchema = z.object({
  // Serialized diagnostics payload (JSON string). Kept as a string so this
  // function does not need to know the exact shape and can accept future
  // additions without a schema bump. Capped to keep the upload bounded.
  payload: z.string().min(2).max(2_000_000),
});

/**
 * Uploads a print-readiness diagnostics JSON blob to private storage and
 * returns a time-limited signed URL that can be shared with teammates.
 *
 * Security notes:
 *  - Requires an authenticated session (requireSupabaseAuth middleware).
 *  - Path is scoped per-user (`<userId>/<uuid>.json`) so users can't
 *    accidentally overwrite each other.
 *  - Bucket is private; the returned URL is a signed URL that expires.
 *  - Storage writes use the admin client after authorization above; we
 *    never expose service-role capabilities to the caller.
 */
export const uploadPrintDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const id = crypto.randomUUID();
    const path = `${context.userId}/${id}.json`;
    const bytes = new TextEncoder().encode(data.payload);

    const uploadRes = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
      contentType: "application/json; charset=utf-8",
      upsert: false,
    });
    if (uploadRes.error) {
      throw new Error(`Upload failed: ${uploadRes.error.message}`);
    }

    const signed = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(`Sign failed: ${signed.error?.message ?? "no url returned"}`);
    }

    const expiresAtIso = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();

    return {
      url: signed.data.signedUrl,
      path,
      expiresAtIso,
      ttlSeconds: SIGNED_URL_TTL_SECONDS,
    };
  });

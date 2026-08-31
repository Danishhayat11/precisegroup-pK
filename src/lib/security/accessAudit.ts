/**
 * Structured audit logging for /security-review access attempts.
 *
 * Wraps the `log_security_review_access` RPC (SECURITY DEFINER) so the
 * caller cannot forge identity — the DB stamps `actor_id` from
 * `auth.uid()` (NULL for anonymous redirects) and rejects mismatched
 * event types (e.g. an anon session trying to log `granted_admin`).
 *
 * All calls are best-effort and never throw: audit failures must not
 * break the user-visible auth flow.
 */
import { supabase } from "@/integrations/supabase/client";
import { callRpc } from "@/integrations/supabase/approvedRpc";

export type SecurityReviewAccessEvent =
  | "unauthenticated_redirect"
  | "denied_non_admin"
  | "granted_admin";

// Coalesce bursts of identical events (e.g. React StrictMode double-invoke,
// or a rapid remount) into a single audit row.
const RECENT_WINDOW_MS = 2_000;
const recent = new Map<string, number>();

export async function logSecurityReviewAccess(
  event: SecurityReviewAccessEvent,
  path: string,
  note?: string,
): Promise<void> {
  const key = `${event}|${path}`;
  const now = Date.now();
  const last = recent.get(key) ?? 0;
  if (now - last < RECENT_WINDOW_MS) return;
  recent.set(key, now);

  try {
    await callRpc("log_security_review_access" as any, {
      _event_type: event,
      _path: path.slice(0, 200),
      _note: note ? note.slice(0, 500) : null,
    });
  } catch {
    // Swallow — this is telemetry, never block the auth flow on it.
  }
}

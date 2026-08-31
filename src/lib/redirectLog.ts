/**
 * Redirect reason logging — client helper.
 *
 * Fires a fire-and-forget insert into `public.redirect_events` via the
 * `log_redirect_reason` RPC. The RPC is SECURITY DEFINER + reason-whitelisted,
 * so it's safe to expose to both `anon` and `authenticated` — pre-auth
 * redirects (e.g. "no session → /login") are logged too.
 *
 * Failures are swallowed: production misroute logging must never break the
 * redirect it's trying to observe. Use for every deliberate navigation the
 * app performs on the user's behalf, not for user-initiated clicks.
 */
import { supabase } from "@/integrations/supabase/client";
import { callRpc } from "@/integrations/supabase/approvedRpc";

export type RedirectReason =
  | "no_session_redirect_to_login"
  | "signed_out_redirect_to_login"
  | "onboarding_incomplete_redirect"
  | "onboarding_complete_leave_wizard"
  | "non_admin_denied"
  | "admin_granted"
  | "invite_accepted_redirect"
  | "oauth_return_to_intended"
  | "root_marketing_redirect"
  | "plan_gate_blocked";

export type LogRedirectOptions = {
  from?: string | null;
  to?: string | null;
  /** Extra structured context. `user_agent` is pulled out server-side. */
  meta?: Record<string, unknown>;
};

/**
 * Fire-and-forget. Never throws, never blocks the caller.
 */
export function logRedirectReason(reason: RedirectReason, opts: LogRedirectOptions = {}): void {
  // Client-only: SSR/prerender has no real user, and duplicate server+client
  // fires would double-count every navigation.
  if (typeof window === "undefined") return;
  try {
    const ua =
      typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
        ? navigator.userAgent
        : undefined;
    const meta = { ...(opts.meta ?? {}), ...(ua ? { user_agent: ua } : {}) };

    // Fire-and-forget — no await, no throw.
    void callRpc("log_redirect_reason", {
      _reason: reason,
      _from_path: opts.from ?? null,
      _to_path: opts.to ?? null,
      _meta: meta,
    } as any).then((r: { error?: { message?: string } | null }) => {
      if (r?.error && import.meta.env?.DEV) {
        // Dev-only signal; production stays silent so misroute paths
        // aren't cascaded by console noise.

        console.debug("[redirectLog] rpc error", r.error.message);
      }
    });
  } catch {
    // Silent by contract.
  }
}

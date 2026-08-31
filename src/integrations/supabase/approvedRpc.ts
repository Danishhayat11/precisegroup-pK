/**
 * RPC allowlist — the single source of truth for which SECURITY DEFINER /
 * Data-API functions client code is permitted to call.
 *
 * Rules:
 *   1. Add a name here ONLY if the function is intentionally exposed to
 *      authenticated (or anon) users AND enforces its own role/tenant checks.
 *   2. Server-only / trigger / internal helpers MUST NOT appear here — even
 *      if `Database["public"]["Functions"]` lists them, they've had EXECUTE
 *      revoked from anon/authenticated at the DB layer.
 *   3. CI enforces this list via `scripts/check-rpc-allowlist.mjs`.
 *
 * Prefer `callRpc(name, args)` over `supabase.rpc(name, args)` in new code
 * so TypeScript rejects names outside this list at compile time.
 */
import { supabase } from "./client";
import type { Database } from "./types";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { getRevokedRpcMappings } from "./revokedRpcMappings";
import { newCorrelationId } from "./correlationId";

export const APPROVED_RPCS = [
  // Admin operations (internal role checks)
  "admin_cleanup_test_tenant",
  "admin_create_invitation",
  "admin_deactivate_company",
  "admin_delete_payment",
  "admin_edit_payment",
  "admin_list_users",
  "admin_restructure_plan",
  "admin_set_role",
  "admin_set_user_active",
  "admin_transfer_ownership",
  // Tenant-aware helpers used from server functions / auth gates
  "count_rows_by_company",
  "current_company_id",
  "has_role",
  "is_super_admin",
  "list_admin_contacts",
  "assert_admin_access",

  // Business RPCs (own authorization internally)
  "bootstrap_company",
  "generate_maintenance_charges",
  "next_adjustment_id",
  "recalculate_ledger_for_booking",
  "reconcile_payment_allocations",
  "reseed_demo_data",
  "waive_maintenance_charge",
  // Diagnostics / logging
  "check_ssr_spike",
  "explain_ai_tool_call_log",
  "get_ssr_error_stats",
  "log_redirect_reason",
  "log_security_review_access",
  "mark_onboarding_complete",
  // Public token-scoped client endpoints
  "client_add_note_by_token",
  "client_get_payment_by_token",
] as const satisfies ReadonlyArray<keyof Database["public"]["Functions"]>;

export type ApprovedRpc = (typeof APPROVED_RPCS)[number];

const APPROVED_SET: ReadonlySet<string> = new Set(APPROVED_RPCS);

export function isApprovedRpc(name: string): name is ApprovedRpc {
  return APPROVED_SET.has(name);
}

type Fns = Database["public"]["Functions"];
type ArgsOf<N extends ApprovedRpc> = Fns[N] extends { Args: infer A } ? A : never;

/**
 * Return-type mapping — one entry per approved RPC. Derived from the
 * generated `Database` types so the mapping stays in sync with the DB
 * schema. `callRpc` uses this to type `result.data`, giving compile-time
 * enforcement of the expected response shape at every call site.
 */
export type RpcReturns<N extends ApprovedRpc> = Fns[N] extends { Returns: infer R } ? R : never;

export type RpcResponse<N extends ApprovedRpc> = PostgrestSingleResponse<RpcReturns<N>>;

/**
 * Explicit per-RPC map — kept as a type alias, not a runtime object, so it
 * has zero bundle cost. Use `RpcReturnsMap["<name>"]` for a fully-named
 * annotation at a call site, e.g.
 *
 *   const users: RpcReturnsMap["admin_list_users"] = data ?? [];
 */
export type RpcReturnsMap = {
  [N in ApprovedRpc]: RpcReturns<N>;
};

/**
 * Postgres / PostgREST error signatures that indicate a call was blocked
 * because EXECUTE was revoked from the caller's role (or the function is
 * not exposed on the API schema at all). We normalize these into a single
 * user-friendly authorization error instead of leaking generic RPC failure
 * text.
 *
 * The concrete lists live in `./revokedRpcMappings` and can be extended
 * without touching this file via env vars or `registerRevokedRpcMappings`.
 *
 * Detection is deliberately over-inclusive on the "revoked" side: any of
 * these signals is enough. Unrelated errors (constraint violations, network
 * failures, application errors thrown from the function body) keep flowing
 * through untouched — see the `isRevokedRpcError` tests for the boundary.
 */

export type RpcAuthErrorReason = "no_session" | "forbidden";

export class RpcAuthorizationError extends Error {
  readonly code = "RPC_NOT_AUTHORIZED" as const;
  readonly rpcName: string;
  readonly reason: RpcAuthErrorReason;
  readonly details: string;
  readonly hint: string;
  readonly correlationId: string;
  readonly cause?: unknown;
  constructor(
    rpcName: string,
    cause?: unknown,
    reason: RpcAuthErrorReason = "forbidden",
    correlationId: string = newCorrelationId(),
  ) {
    super(
      (reason === "no_session"
        ? `You must be signed in to perform this action (${rpcName}). ` +
          `Your session is missing or expired — please sign in again and retry.`
        : `You are not authorized to perform this action (${rpcName}). ` +
          `If you believe this is a mistake, contact an administrator.`) +
        ` [ref: ${correlationId}]`,
    );
    this.name = "RpcAuthorizationError";
    this.rpcName = rpcName;
    this.reason = reason;
    this.correlationId = correlationId;
    this.details = "";
    this.hint = reason === "no_session" ? "Sign in and try again." : "";
    this.cause = cause;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      reason: this.reason,
      details: this.details,
      hint: this.hint,
      correlationId: this.correlationId,
      code: this.code as string,
    };
  }
}

/**
 * Detect "the request arrived without a valid user session" specifically —
 * either no bearer token at all, or a token PostgREST/GoTrue rejected as
 * invalid/expired. Distinct from a 403 where the token is valid but the
 * role lacks EXECUTE / RLS grants.
 */
export function isNoSessionRpcError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: string | number;
    status?: number;
    statusCode?: number;
    message?: string;
    details?: string;
    hint?: string;
  };
  const status = e.status ?? e.statusCode;
  const code = e.code != null ? String(e.code).toLowerCase() : "";
  const haystack = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`.toLowerCase();
  if (code === "bad_jwt" || code === "no_authorization" || code === "pgrst301") return true;
  if (
    haystack.includes("jwt expired") ||
    haystack.includes("invalid jwt") ||
    haystack.includes("no authorization header") ||
    haystack.includes("missing authorization") ||
    haystack.includes("unauthorized: no authorization header")
  ) {
    return true;
  }
  if (status === 401) {
    // 401 without a role/grant hint typically means the gateway rejected the
    // token itself; a "permission denied for function" 401 would still fall
    // through to the generic forbidden path via isRevokedRpcError.
    if (haystack.includes("permission denied") || haystack.includes("not allowed")) {
      return false;
    }
    return true;
  }
  return false;
}

export function isRevokedRpcError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: string | number;
    status?: number;
    statusCode?: number;
    message?: string;
    details?: string;
    hint?: string;
  };
  const { codes, textMarkers } = getRevokedRpcMappings();
  // Normalize code — Supabase-js gives strings, but PostgREST-over-fetch
  // shims occasionally surface numeric statuses on `.code`.
  const code = e.code != null ? String(e.code) : "";

  // LOGGING: Schema cache / table discovery failures
  if (code === "PGRST100" || (e.message && e.message.includes("Could not find the table"))) {
    console.error(
      "[Supabase:SchemaError] Table discovery failed. This usually means the table is missing or the schema cache is stale.",
      {
        code,
        message: e.message,
        details: e.details,
        hint: e.hint,
      },
    );
  }

  if (code && codes.has(code)) return true;
  const status = e.status ?? e.statusCode;
  // 401/403 with no other classification means the API gateway rejected the
  // request outright — same user-facing message applies.
  if (status === 401 || status === 403) return true;
  const haystack = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`.toLowerCase();
  if (!haystack.trim()) return false;
  return textMarkers.some((m: string) => haystack.includes(m));
}

/**
 * Typed wrapper around `supabase.rpc` that only accepts approved function names.
 * Using this in new code guarantees TS2345 if a revoked SECURITY DEFINER
 * function is referenced.
 *
 * At runtime, if the DB rejects the call because EXECUTE was revoked (or the
 * function is not exposed on the API schema), the returned `{ error }` is
 * replaced with a `RpcAuthorizationError` carrying a clear, user-facing
 * message. All other errors pass through untouched.
 */
export async function callRpc<N extends ApprovedRpc>(
  name: N,
  ...args: ArgsOf<N> extends Record<string, never> | undefined
    ? [args?: ArgsOf<N>]
    : [args: ArgsOf<N>]
): Promise<RpcResponse<N>> {
  const correlationId = newCorrelationId();
  // Runtime guard: TypeScript rejects unlisted names, but a `as never` /
  // `as ApprovedRpc` cast at a call site — or a dynamically-built name —
  // would bypass that. Refuse to issue the request at all. Fires only when
  // the compile-time check has been circumvented; well-typed callers never
  // hit this branch.
  if (typeof name !== "string" || !isApprovedRpc(name)) {
    const denied = new RpcAuthorizationError(String(name), undefined, "forbidden", correlationId);
    void logRevokedRpcAttempt(
      String(name),
      {
        code: "RPC_NOT_ALLOWLISTED",
        message: `Blocked client-side call to non-allowlisted RPC "${String(name)}"`,
      },
      correlationId,
    );
    console.warn("[rpc-denied]", { rpc: String(name), correlationId, reason: "not_allowlisted" });
    return {
      data: null,
      error: denied,
      count: null,
      status: 403,
      statusText: "Forbidden",
    } as unknown as RpcResponse<N>;
  }

  const result = (await supabase.rpc(
    name as string as never,
    (args[0] ?? undefined) as never,
  )) as unknown as RpcResponse<N>;
  if (result.error && isRevokedRpcError(result.error)) {
    // Fire-and-forget audit log — never let a logging failure surface as an
    // extra error at the call site.
    void logRevokedRpcAttempt(name, result.error, correlationId);
    const reason: RpcAuthErrorReason = isNoSessionRpcError(result.error)
      ? "no_session"
      : "forbidden";
    console.warn("[rpc-denied]", { rpc: name, correlationId, reason });
    return {
      ...result,
      data: null,
      error: new RpcAuthorizationError(name, result.error, reason, correlationId),
    } as unknown as RpcResponse<N>;
  }
  return result;
}

/**
 * Best-effort insert into `public.rpc_authorization_denied_log`. RLS pins
 * `user_id = auth.uid()` and defaults `company_id` to `current_company_id()`,
 * so a user cannot forge someone else's audit row. Unauthenticated calls and
 * network failures are swallowed on purpose.
 */
async function logRevokedRpcAttempt(
  rpcName: string,
  dbError: unknown,
  correlationId: string,
): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user?.id) return; // anon → no audit row
    const e = (dbError ?? {}) as { code?: string; message?: string };
    await supabase.from("rpc_authorization_denied_log").insert({
      rpc_name: rpcName,
      error_code: e.code ?? null,
      error_message: e.message ?? null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      page_path: typeof window !== "undefined" ? (window.location?.pathname ?? null) : null,
      correlation_id: correlationId,
    });
  } catch {
    // never propagate; auditing is best-effort
  }
}

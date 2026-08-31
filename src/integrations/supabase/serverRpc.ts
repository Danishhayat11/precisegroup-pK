/**
 * Server-side counterpart to `callRpc` — enforces the SAME approved-RPC
 * allowlist for `context.supabase.rpc(...)` calls inside server functions.
 *
 * Why this exists:
 *   `requireSupabaseAuth` gives handlers a user-scoped Supabase client on
 *   `context.supabase`. Calling `context.supabase.rpc("some_name", ...)`
 *   directly bypasses the compile-time allowlist enforced by `callRpc` on
 *   the browser client. A handler could therefore invoke any function the
 *   authenticated role still has EXECUTE on — including ones we've decided
 *   should not be reachable from the app.
 *
 * Rules for server code:
 *   - Never call `context.supabase.rpc(...)` directly in a `.functions.ts`
 *     handler. Route every call through `callServerRpc`.
 *   - Adding a new server-side RPC target ALWAYS means adding it to
 *     `APPROVED_RPCS` (single source of truth). If the function must not be
 *     reachable from clients but IS legitimately called by a server fn,
 *     it still belongs on the list — the DB layer (EXECUTE grants) is the
 *     boundary for external callers, not this list.
 *   - CI (`scripts/check-rpc-allowlist.mjs`) enforces both the name allowlist
 *     and forbids raw `context.supabase.rpc(...)` in `*.functions.ts`.
 *
 * Runtime behavior mirrors `callRpc`:
 *   - Revoked-EXECUTE / not-exposed errors are normalized into
 *     `RpcAuthorizationError`.
 *   - Attempts are audit-logged best-effort into
 *     `public.rpc_authorization_denied_log` via the service-role client so
 *     server-side rejections show up alongside client ones.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import {
  APPROVED_RPCS,
  isApprovedRpc,
  isNoSessionRpcError,
  isRevokedRpcError,
  RpcAuthorizationError,
  type ApprovedRpc,
  type RpcAuthErrorReason,
  type RpcResponse,
} from "./approvedRpc";
import { newCorrelationId } from "./correlationId";

type Fns = Database["public"]["Functions"];
type ArgsOf<N extends ApprovedRpc> = Fns[N] extends { Args: infer A } ? A : never;

type ServerSupabase = SupabaseClient<Database>;

/** Options accepted by every server-side RPC call. */
export interface CallServerRpcOptions {
  /**
   * Correlation id used to join this call's browser log entry, this server
   * function's console log, and the resulting `rpc_authorization_denied_log`
   * row. Callers that already have an id (e.g. `assertSuperAdmin` at the top
   * of a handler) should pass it in so every downstream RPC in the same
   * request shares one id. When omitted a fresh id is generated per call.
   */
  correlationId?: string;
}

/**
 * Runtime + compile-time guard around `context.supabase.rpc`.
 *
 * TS refuses any name outside `APPROVED_RPCS`. At runtime we double-check
 * against the same set so a `as never` cast at a call site can't smuggle an
 * unlisted name through.
 */
export async function callServerRpc<N extends ApprovedRpc>(
  supabase: ServerSupabase,
  name: N,
  args?: ArgsOf<N>,
  options?: CallServerRpcOptions,
): Promise<RpcResponse<N>> {
  const correlationId = options?.correlationId ?? newCorrelationId();
  if (!isApprovedRpc(name)) {
    // Belt-and-braces: refuse to issue the request at all. This path is
    // unreachable from well-typed callers; it fires only if someone has
    // cast around the compile-time check.
    throw new RpcAuthorizationError(name, undefined, "forbidden", correlationId);
  }

  const result = (await supabase.rpc(
    name as string as never,
    (args ?? undefined) as never,
  )) as unknown as RpcResponse<N>;

  if (result.error && isRevokedRpcError(result.error)) {
    void logRevokedServerRpcAttempt(supabase, name, result.error, correlationId);
    const reason: RpcAuthErrorReason = isNoSessionRpcError(result.error)
      ? "no_session"
      : "forbidden";
    console.error("[rpc-denied:server]", {
      rpc: name,
      correlationId,
      reason,
      code: (result.error as { code?: string })?.code ?? null,
    });
    return {
      ...result,
      data: null,
      error: new RpcAuthorizationError(name, result.error, reason, correlationId),
    } as unknown as RpcResponse<N>;
  }
  return result;
}

/**
 * Best-effort insert into `public.rpc_authorization_denied_log` from the
 * server side. We prefer the service-role client so the audit row lands
 * even when the caller's own RLS would block the insert (e.g. anon session,
 * expired JWT). Failures are swallowed — auditing must never surface as an
 * extra error at the handler.
 */
async function logRevokedServerRpcAttempt(
  userClient: ServerSupabase,
  rpcName: string,
  dbError: unknown,
  correlationId: string,
): Promise<void> {
  try {
    const e = (dbError ?? {}) as { code?: string; message?: string };
    let userId: string | null = null;
    try {
      const { data } = await userClient.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      // no-op — we still write the row with user_id = null
    }

    const { supabaseAdmin } = await import("./client.server");
    await supabaseAdmin.from("rpc_authorization_denied_log").insert({
      rpc_name: rpcName,
      error_code: e.code ?? null,
      error_message: e.message ?? null,
      user_agent: "server-fn",
      page_path: null,
      correlation_id: correlationId,
      ...(userId ? { user_id: userId } : {}),
    });
  } catch {
    // never propagate; auditing is best-effort
  }
}

/** Re-export for callers that need to introspect the shared allowlist. */
export { APPROVED_RPCS, RpcAuthorizationError };
export type { ApprovedRpc };

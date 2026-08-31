/**
 * Consistent surfacing for `RpcAuthorizationError` — the normalized error
 * `callRpc()` returns when a SECURITY DEFINER / Data-API function rejects a
 * caller because EXECUTE was revoked (or the function isn't exposed).
 *
 *   • `showRpcAuthorizationError(err)` — imperative toast (deduped).
 *   • `handleRpcError(err)`          — toast + `true` if it was an auth error,
 *                                       so call sites can early-return.
 *   • `<RpcAuthorizationBanner />`   — inline banner for forms / detail pages
 *                                       where a toast alone isn't enough.
 *
 * All three read the message straight off `RpcAuthorizationError`, so users
 * always see the same "You are not authorized…" copy regardless of surface.
 */
import * as React from "react";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { RpcAuthorizationError } from "@/integrations/supabase/approvedRpc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function isRpcAuthorizationError(err: unknown): err is RpcAuthorizationError {
  return err instanceof RpcAuthorizationError;
}

/** Dedupe identical auth-toasts within a short window to avoid spam on retry loops. */
const TOAST_DEDUPE_MS = 4000;
const lastToastByRpc = new Map<string, number>();

export function showRpcAuthorizationError(err: RpcAuthorizationError): void {
  const now = Date.now();
  const last = lastToastByRpc.get(err.rpcName) ?? 0;
  if (now - last < TOAST_DEDUPE_MS) return;
  lastToastByRpc.set(err.rpcName, now);

  toast.error("Not authorized", {
    id: `rpc-auth:${err.rpcName}`,
    description: err.message,
    duration: 6000,
  });
}

/**
 * Convenience for imperative flows:
 *
 *   const { error } = await callRpc("admin_set_role", args);
 *   if (handleRpcError(error)) return;   // toast already shown
 *   if (error) throw error;              // other errors handled normally
 */
export function handleRpcError(err: unknown): err is RpcAuthorizationError {
  if (!isRpcAuthorizationError(err)) return false;
  showRpcAuthorizationError(err);
  return true;
}

export interface RpcAuthorizationBannerProps {
  error: unknown;
  className?: string;
}

/**
 * Inline banner for pages where a toast can be missed (multi-step forms,
 * detail pages loaded via server function). Renders `null` for anything
 * other than `RpcAuthorizationError` so it's safe to place unconditionally.
 */
export function RpcAuthorizationBanner({ error, className }: RpcAuthorizationBannerProps) {
  if (!isRpcAuthorizationError(error)) return null;
  return (
    <Alert variant="destructive" role="alert" className={className}>
      <ShieldAlert className="h-4 w-4" aria-hidden />
      <AlertTitle>Not authorized</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}

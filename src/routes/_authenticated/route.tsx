import { useEffect } from "react";
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import AppShell from "@/components/AppShell";
import { logSecurityReviewAccess } from "@/lib/security/accessAudit";
import { logRedirectReason } from "@/lib/redirectLog";
import { useAuth } from "@/lib/auth";
import { RouteErrorBoundary, RouteNotFound } from "@/components/RouteErrorBoundary";
import { AuthNetworkFallback, AUTH_NETWORK_ERROR_TAG } from "@/components/AuthNetworkFallback";
import { isRedirect } from "@tanstack/react-router";

function isNetworkLikeError(err: unknown): boolean {
  if (!err) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|network|networkerror|load failed|fetch failed|timeout|offline/i.test(msg);
}

const AUTH_RETRY_ATTEMPTS = 3;
const AUTH_RETRY_BASE_MS = 250;
const AUTH_RETRY_MAX_MS = 2000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Call supabase.auth.getUser() with exponential backoff on transient network
 * failures. Non-network errors and successful responses (including "no user")
 * short-circuit and return on the first attempt.
 */
async function getUserWithRetry(): Promise<Awaited<ReturnType<typeof supabase.auth.getUser>>> {
  let lastNetworkErr: unknown = null;
  for (let attempt = 0; attempt < AUTH_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await supabase.auth.getUser();
      if (res.error && isNetworkLikeError(res.error)) {
        lastNetworkErr = res.error;
      } else {
        return res;
      }
    } catch (thrown) {
      if (isRedirect(thrown)) throw thrown;
      if (!isNetworkLikeError(thrown)) throw thrown;
      lastNetworkErr = thrown;
    }
    if (attempt < AUTH_RETRY_ATTEMPTS - 1) {
      const delay = Math.min(AUTH_RETRY_MAX_MS, AUTH_RETRY_BASE_MS * 2 ** attempt);
      const jitter = Math.random() * (delay * 0.25);
      await sleep(delay + jitter);
    }
  }
  const err =
    lastNetworkErr instanceof Error
      ? lastNetworkErr
      : new Error(String(lastNetworkErr ?? "Network request failed"));
  throw err;
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    let data: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"] | undefined;
    let error: Awaited<ReturnType<typeof supabase.auth.getUser>>["error"] | undefined;
    try {
      const res = await getUserWithRetry();
      data = res.data;
      error = res.error ?? undefined;
    } catch (thrown) {
      if (isRedirect(thrown)) throw thrown;
      const netErr = new Error(thrown instanceof Error ? thrown.message : "Network request failed");
      (netErr as Error & { tag?: string }).tag = AUTH_NETWORK_ERROR_TAG;
      throw netErr;
    }

    if (error && isNetworkLikeError(error)) {
      const netErr = new Error(error.message || "Network request failed");
      (netErr as Error & { tag?: string }).tag = AUTH_NETWORK_ERROR_TAG;
      throw netErr;
    }

    if (error || !data?.user) {
      if (location.pathname.startsWith("/security-review")) {
        void logSecurityReviewAccess("unauthenticated_redirect", location.pathname);
      }
      logRedirectReason("no_session_redirect_to_login", {
        from: location.pathname,
        to: "/login",
        meta: { auth_error: error?.message ?? null },
      });
      throw redirect({
        to: "/login",
        search: { next: location.href || location.pathname },
        replace: true,
      });
    }
  },

  component: AuthenticatedLayout,
  errorComponent: (props) => {
    const tag = (props.error as Error & { tag?: string })?.tag;
    if (tag === AUTH_NETWORK_ERROR_TAG) {
      return <AuthNetworkFallback error={props.error} reset={props.reset} />;
    }
    return <RouteErrorBoundary {...props} routeLabel="This page" boundary="route:_authenticated" />;
  },
  notFoundComponent: AuthenticatedNotFound,
});

function AuthenticatedLayout() {
  return <AppShell />;
}

function AuthenticatedNotFound() {
  const { loading, user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (loading || user) return;
    void navigate({
      to: "/login",
      search: { next: pathname } as never,
      replace: true,
    });
  }, [loading, navigate, pathname, user]);

  if (loading || !user) {
    return (
      <div
        className="grid min-h-[50dvh] place-items-center bg-background px-4"
        role="status"
        aria-live="polite"
      >
        <div className="text-sm text-muted-foreground">Redirecting to sign in…</div>
      </div>
    );
  }

  return <RouteNotFound backTo="/" />;
}

export { Outlet };

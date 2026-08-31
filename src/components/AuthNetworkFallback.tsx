import { useEffect, useState } from "react";
import { useRouter, Link } from "@tanstack/react-router";
import { WifiOff, RefreshCw, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

export const AUTH_NETWORK_ERROR_TAG = "auth_network_error";

interface AuthNetworkFallbackProps {
  error: Error;
  reset: () => void;
}

/**
 * Friendly fallback shown when supabase.auth.getUser() fails for network
 * reasons (offline, sandbox with no egress, DNS failure). Offers a retry
 * that re-runs the _authenticated beforeLoad gate.
 */
export function AuthNetworkFallback({ error, reset }: AuthNetworkFallbackProps) {
  const router = useRouter();
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const retry = async () => {
    setRetrying(true);
    try {
      await router.invalidate();
      reset();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className="grid min-h-[70dvh] place-items-center bg-background px-4"
      role="alert"
      aria-live="polite"
    >
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 md:p-8 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-muted p-3 text-muted-foreground">
            <WifiOff className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-foreground">Can't reach the server</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {online
                ? "We couldn't verify your session. Check your connection and try again."
                : "You appear to be offline. Reconnect and try again."}
            </p>
            {error?.message && (
              <p className="mt-3 rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground break-words">
                {error.message}
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={retry} size="sm" className="gap-2" disabled={retrying}>
                <RefreshCw
                  className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {retrying ? "Retrying…" : "Try again"}
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-2">
                <Link to="/login">
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  Go to sign in
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

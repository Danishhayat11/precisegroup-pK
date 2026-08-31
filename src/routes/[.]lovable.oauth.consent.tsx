import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";

/**
 * OAuth 2.1 consent screen for the Supabase-hosted authorization server.
 *
 * Flow: an MCP client (ChatGPT, Claude, Cursor…) redirects the user here
 * with `?authorization_id=...`. We look up the pending authorization,
 * show the requesting client's name, and let the user Approve or Deny.
 * On success we forward the browser to the redirect URL Supabase returns.
 *
 * `ssr: false` — the Supabase browser client reads its session from
 * localStorage, which is absent on the SSR pass. Without this the
 * server would see no session and bounce every request to /login.
 */
export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      // Same-origin relative path so the user returns to the same
      // consent URL with the same authorization_id after signing in.
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/login", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    // The auth.oauth namespace is beta and not always in the generated
    // types. Cast narrowly rather than reaching for `any` on the whole
    // client.
    const oauth = (
      supabase.auth as unknown as {
        oauth: {
          getAuthorizationDetails: (id: string) => Promise<{
            data: {
              client?: { name?: string; client_uri?: string };
              redirect_url?: string;
              redirect_to?: string;
            } | null;
            error: { message: string } | null;
          }>;
        };
      }
    ).oauth;
    const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    // Already-approved client: Supabase resolves immediately — bounce.
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="max-w-md text-center space-y-2">
        <h1 className="text-xl font-semibold">Authorization unavailable</h1>
        <p className="text-sm text-muted-foreground">
          {(error as Error)?.message ?? String(error)}
        </p>
      </div>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "an external app";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const oauth = (
      supabase.auth as unknown as {
        oauth: {
          approveAuthorization: (id: string) => Promise<{
            data: { redirect_url?: string; redirect_to?: string } | null;
            error: { message: string } | null;
          }>;
          denyAuthorization: (id: string) => Promise<{
            data: { redirect_url?: string; redirect_to?: string } | null;
            error: { message: string } | null;
          }>;
        };
      }
    ).oauth;
    const { data, error: authError } = approve
      ? await oauth.approveAuthorization(authorization_id)
      : await oauth.denyAuthorization(authorization_id);
    if (authError) {
      setBusy(false);
      setError(authError.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("The authorization server did not return a redirect URL.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="min-h-dvh grid place-items-center p-6 bg-background">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary grid place-items-center">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Connect {clientName}</h1>
            <p className="text-xs text-muted-foreground">Precise ERP · Agent integration</p>
          </div>
        </div>

        <p className="text-sm">
          <strong>{clientName}</strong> is asking to use Precise ERP as you. Approve only if you
          started this connection. You can revoke access at any time from your account settings.
        </p>

        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
          <li>Read bookings, clients, and collections data</li>
          <li>Act with your permissions and audit trail</li>
        </ul>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" disabled={busy} onClick={() => decide(false)}>
            Deny
          </Button>
          <Button disabled={busy} onClick={() => decide(true)}>
            {busy ? "Working…" : `Approve ${clientName}`}
          </Button>
        </div>
      </div>
    </main>
  );
}

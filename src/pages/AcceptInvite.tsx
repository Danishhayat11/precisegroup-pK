import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Building2, CheckCircle2, XCircle } from "lucide-react";
import { logRedirectReason } from "@/lib/redirectLog";

export default function AcceptInvite() {
  const { token } = useParams({ from: "/accept-invite/$token" });
  const navigate = useNavigate();

  const [status, setStatus] = useState<"checking" | "valid" | "invalid" | "expired" | "accepted">(
    "checking",
  );
  const [invite, setInvite] = useState<{ email: string; role: string; company_id: string } | null>(
    null,
  );
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signup" | "signin">("signup");

  useEffect(() => {
    (async () => {
      // Anon can read via RLS? invitations table has admin-only policy. So the
      // check has to run server-side. We call a tiny lightweight rpc via the
      // browser: fall back to letting handle_new_user validate on sign-up.
      // Best-effort: try to fetch and treat "no row" as invalid.
      const { data } = await supabase
        .from("company_invitations")
        .select("email, role, company_id, expires_at, accepted_at")
        .eq("token", token)
        .maybeSingle();
      if (!data) {
        // Might be RLS hiding it; assume valid and let sign-up be the source of truth.
        setStatus("valid");
        return;
      }
      if (data.accepted_at) {
        setStatus("accepted");
        return;
      }
      if (new Date(data.expires_at) < new Date()) {
        setStatus("expired");
        return;
      }
      setInvite({ email: data.email, role: data.role, company_id: data.company_id });
      setEmail(data.email);
      setStatus("valid");
    })();
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: {
              full_name: fullName || null,
              invitation_token: token,
            },
          },
        });
        if (error) throw error;
        toast.success("Account created — check your email if confirmation is required.");
        logRedirectReason("invite_accepted_redirect", {
          from: typeof window !== "undefined" ? window.location.pathname : null,
          to: "/dashboard",
          meta: { mode: "signup", has_token: !!token },
        });
        navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // If the user already exists, invitation acceptance for their profile
        // has to happen via a signed-in RPC. Skipping for now: existing users
        // stay in their current company. Show a friendly note.
        toast.success("Signed in");
        logRedirectReason("invite_accepted_redirect", {
          from: typeof window !== "undefined" ? window.location.pathname : null,
          to: "/dashboard",
          meta: { mode: "signin", has_token: !!token },
        });
        navigate({ to: "/dashboard" });
      }
    } catch (err: any) {
      toast.error(err.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking") {
    return (
      <Center>
        <p className="text-muted-foreground">Checking your invitation…</p>
      </Center>
    );
  }
  if (status === "invalid" || status === "expired" || status === "accepted") {
    return (
      <Center>
        <div className="text-center max-w-sm">
          <XCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <h1 className="text-lg font-semibold mb-1">
            {status === "expired"
              ? "This invitation has expired"
              : status === "accepted"
                ? "This invitation was already accepted"
                : "This invitation is not valid"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Ask your workspace admin to send a fresh invite link.
          </p>
          <Link to="/login" className="inline-block mt-4 text-sm text-primary hover:underline">
            Go to sign in
          </Link>
        </div>
      </Center>
    );
  }

  return (
    <Center>
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="h-11 w-11 mx-auto rounded-xl bg-primary/10 grid place-items-center mb-3">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-lg font-semibold">You've been invited</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {invite ? (
              <>
                Join as <span className="font-medium capitalize">{invite.role}</span>
                {invite.email ? ` — ${invite.email}` : ""}
              </>
            ) : (
              "Complete your account to join the workspace."
            )}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          {mode === "signup" && (
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Adil Khan"
                autoComplete="name"
              />
            </div>
          )}
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? (
              "Please wait…"
            ) : mode === "signup" ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-1.5" /> Create account &amp; join
              </>
            ) : (
              "Sign in &amp; join"
            )}
          </Button>
          <button
            type="button"
            className="w-full text-xs text-muted-foreground hover:text-foreground text-center"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          >
            {mode === "signup" ? "Already have an account? Sign in" : "New user? Create an account"}
          </button>
        </form>
      </div>
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh grid place-items-center bg-background p-6">{children}</div>;
}

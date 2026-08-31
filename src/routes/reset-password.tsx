import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@/lib/router-compat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Building2, KeyRound, ShieldAlert, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  head: () => ({
    meta: [
      { title: "Reset password — Precise ERP" },
      {
        name: "description",
        content: "Set a new password for your Precise ERP account.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: "/reset-password" }],
  }),
});

type Status =
  | { kind: "loading" }
  | { kind: "ready"; email: string | null }
  | { kind: "invalid"; message: string }
  | { kind: "saving" }
  | { kind: "done" };

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    // Supabase places the recovery session on the URL hash. Wait for the
    // client to hydrate it, then confirm we have a real recovery session
    // before letting the user set a new password.
    let cancelled = false;

    const check = async () => {
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const isRecoveryLink = hash.includes("type=recovery");

      const { data, error } = await supabase.auth.getUser();
      if (cancelled) return;

      if (error || !data.user) {
        setStatus({
          kind: "invalid",
          message: isRecoveryLink
            ? "Your reset link is invalid or has expired. Request a new one from the sign-in page."
            : "Open the password reset link from your email to continue.",
        });
        return;
      }
      setStatus({ kind: "ready", email: data.user.email ?? null });
    };

    check();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") void check();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setStatus({ kind: "saving" });
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus({ kind: "done" });
      toast.success("Password updated. You're signed in.");
      setTimeout(() => navigate("/dashboard"), 800);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not update password.");
      setStatus({ kind: "ready", email: null });
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-[400px] flex flex-col items-center">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-primary-foreground shadow-lg mb-4">
            <Building2 className="w-7 h-7" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Precise Realtors &amp; Builders
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Internal Enterprise Resource Platform
          </p>
        </div>

        <div className="w-full bg-card border border-border/60 rounded-[32px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 sm:p-10">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" aria-hidden />
              Set new password
            </h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              Choose a strong password. You&apos;ll stay signed in after saving.
            </p>
          </div>

          {status.kind === "loading" && (
            <p className="text-sm text-muted-foreground">Verifying reset link…</p>
          )}

          {status.kind === "invalid" && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" aria-hidden />
                <AlertTitle>Reset link problem</AlertTitle>
                <AlertDescription>{status.message}</AlertDescription>
              </Alert>
              <Button className="w-full min-h-11 rounded-xl" onClick={() => navigate("/login")}>
                Back to sign in
              </Button>
            </div>
          )}

          {status.kind === "done" && (
            <Alert className="border-primary/30">
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              <AlertTitle>Password updated</AlertTitle>
              <AlertDescription>Redirecting to your dashboard…</AlertDescription>
            </Alert>
          )}

          {(status.kind === "ready" || status.kind === "saving") && (
            <form onSubmit={submit} className="space-y-4">
              {status.kind === "ready" && status.email && (
                <p className="text-[12px] text-muted-foreground ml-1">
                  Resetting password for{" "}
                  <span className="font-medium text-foreground">{status.email}</span>
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="ml-1 text-[13px]">
                  New password
                </Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  className="min-h-11 rounded-xl bg-muted/60 border-border/60"
                  disabled={status.kind === "saving"}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="ml-1 text-[13px]">
                  Confirm new password
                </Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Re-enter the password"
                  className="min-h-11 rounded-xl bg-muted/60 border-border/60"
                  disabled={status.kind === "saving"}
                />
              </div>
              <Button
                type="submit"
                className="w-full mt-2 min-h-11 rounded-xl font-medium"
                disabled={status.kind === "saving"}
              >
                {status.kind === "saving" ? "Saving…" : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

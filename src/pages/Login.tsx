/* allow-raw-color-file: login hero overlays dynamic linear gradients for backdrop grid mask and subtle button gloss */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, Navigate, Link } from "@/lib/router-compat";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Building2, ArrowLeft, MailCheck, ShieldAlert, KeyRound } from "lucide-react";

/**
 * Same-origin relative-path guard for the `?next=` param. Blocks protocol
 * hijacks (`//evil.com`, `javascript:`, `http://…`) so we can only ever
 * bounce back into this app — critical for the OAuth consent round-trip
 * used by MCP clients, which parks the consent URL in `next` before
 * sign-in and expects to land back on `/.lovable/oauth/consent?...`.
 */
function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

type Mode = "signin" | "forgot";
type ResetStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const nextParam =
    typeof window !== "undefined"
      ? safeNext(new URLSearchParams(window.location.search).get("next"))
      : "/dashboard";
  const initialEmail =
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("email") ?? "")
      : "";
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [resetEmail, setResetEmail] = useState(initialEmail);
  const [resetStatus, setResetStatus] = useState<ResetStatus>({ kind: "idle" });

  if (loading) return null;
  if (user) return <Navigate to={nextParam} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Welcome back");
      navigate(nextParam);
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    const target = resetEmail.trim();
    if (!EMAIL_RE.test(target)) {
      setResetStatus({
        kind: "error",
        message: "Enter a valid email address (e.g. name@precise.com).",
      });
      return;
    }
    setResetStatus({ kind: "sending" });
    try {
      const redirectTo = "https://www.preciseerp.org/reset-password";
      const { error } = await supabase.auth.resetPasswordForEmail(target, {
        redirectTo,
      });
      if (error) throw error;
      setResetStatus({ kind: "sent", email: target });
      toast.success("Password reset email sent");
    } catch (err: any) {
      const message = err?.message ?? "Could not send reset email.";
      setResetStatus({ kind: "error", message });
      toast.error(message);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background relative isolate overflow-hidden p-6">
      {/* Subtle architectural backdrop grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
          maskImage: "radial-gradient(100% 80% at 50% 40%, #000 30%, transparent 80%)",
        }}
      />
      {/* Ambient background glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full blur-3xl opacity-20"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--primary) 60%, transparent) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full blur-3xl opacity-25"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--primary) 40%, transparent) 0%, transparent 70%)",
        }}
      />

      <div className="w-full max-w-[420px] flex flex-col items-center relative z-10">
        {/* Brand mark */}
        <div className="mb-8 text-center flex flex-col items-center">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl text-primary-foreground shadow-lg mb-4 transition-transform hover:scale-105 duration-300"
            style={{
              backgroundColor: "var(--primary)",
              background:
                "linear-gradient(135deg, color-mix(in oklab, var(--primary) 85%, #fff 15%) 0%, var(--primary) 100%)",
              boxShadow:
                "0 8px 24px -4px color-mix(in oklab, var(--primary) 40%, transparent), inset 0 1px 0 0 hsl(0 0% 100% / 0.4)",
            }}
          >
            <Building2 className="w-8 h-8" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-display">
            Precise Realtors &amp; Builders
          </h1>
          <p className="text-[13px] text-muted-foreground mt-1 tracking-wide font-medium">
            Enterprise Resource Platform · Islamabad
          </p>
        </div>

        {/* Card */}
        <div
          className="w-full bg-card/95 backdrop-blur-md border border-border/80 rounded-[28px] p-8 sm:p-9 shadow-lg"
          style={{
            boxShadow:
              "0 4px 6px -1px color-mix(in oklab, var(--foreground) 3%, transparent), 0 20px 40px -15px color-mix(in oklab, var(--primary) 12%, transparent), inset 0 1px 0 0 hsl(0 0% 100% / 0.8)",
          }}
        >
          {mode === "signin" ? (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">Sign in</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Access your organization workspace
                </p>
              </div>

              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="ml-1 text-[13px] font-medium">
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="name@precisegroup.pk"
                    className="min-h-11 rounded-xl bg-muted/40 border-border/70 focus-visible:ring-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between ml-1">
                    <Label htmlFor="password" className="text-[13px] font-medium">
                      Password
                    </Label>
                    <button
                      type="button"
                      className="text-[12px] text-muted-foreground hover:text-foreground font-medium underline-offset-4 hover:underline"
                      onClick={() => {
                        setResetEmail(email);
                        setResetStatus({ kind: "idle" });
                        setMode("forgot");
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="min-h-11 rounded-xl bg-muted/40 border-border/70 focus-visible:ring-primary"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full mt-6 min-h-12 rounded-full font-semibold text-[14px] shadow-[0_4px_16px_rgba(0,122,255,0.25),inset_0_1px_0_rgba(255,255,255,0.3)] transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:scale-[1.02] active:scale-[0.96]"
                  disabled={busy}
                  style={{
                    backgroundColor: "var(--primary)",
                    background:
                      "linear-gradient(180deg, color-mix(in oklab, var(--primary) 90%, #fff 10%) 0%, var(--primary) 100%)",
                  }}
                >
                  {busy ? "Signing in…" : "Sign in to ERP"}
                </Button>
              </form>

              <div className="mt-6 pt-5 border-t border-border/50 text-center">
                <p className="text-[13px] text-muted-foreground">
                  Need an account?{" "}
                  <a
                    href="/signup"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate("/signup");
                    }}
                    className="text-foreground font-semibold hover:underline underline-offset-4"
                  >
                    Register new company
                  </a>
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="mb-6">
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground mb-4 font-medium"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Back to sign in
                </button>
                <h2 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-primary" aria-hidden />
                  Reset password
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your email address. We&apos;ll send a secure reset link.
                </p>
              </div>

              <form onSubmit={submitReset} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email" className="ml-1 text-[13px] font-medium">
                    Account email
                  </Label>
                  <Input
                    id="reset-email"
                    type="email"
                    value={resetEmail}
                    onChange={(e) => {
                      setResetEmail(e.target.value);
                      if (resetStatus.kind === "error" || resetStatus.kind === "sent") {
                        setResetStatus({ kind: "idle" });
                      }
                    }}
                    required
                    autoComplete="email"
                    inputMode="email"
                    placeholder="name@precisegroup.pk"
                    aria-invalid={resetStatus.kind === "error"}
                    aria-describedby="reset-status"
                    disabled={resetStatus.kind === "sending"}
                    className="min-h-11 rounded-xl bg-muted/40 border-border/70"
                  />
                  <p className="ml-1 text-[12px] text-muted-foreground">
                    Password reset instructions will be sent to this email.
                  </p>
                </div>

                <div id="reset-status" aria-live="polite" className="min-h-0">
                  {resetStatus.kind === "sent" && (
                    <Alert className="border-primary/30">
                      <MailCheck className="h-4 w-4 text-primary" aria-hidden />
                      <AlertTitle>Check your inbox</AlertTitle>
                      <AlertDescription>
                        If an account exists for{" "}
                        <span className="font-medium text-foreground">{resetStatus.email}</span>, a
                        password reset link is on its way. The link expires in 1 hour.
                      </AlertDescription>
                    </Alert>
                  )}
                  {resetStatus.kind === "error" && (
                    <Alert variant="destructive">
                      <ShieldAlert className="h-4 w-4" aria-hidden />
                      <AlertTitle>Couldn&apos;t send reset email</AlertTitle>
                      <AlertDescription>{resetStatus.message}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full mt-2 min-h-11 rounded-xl font-semibold"
                  disabled={resetStatus.kind === "sending"}
                >
                  {resetStatus.kind === "sending"
                    ? "Sending reset link…"
                    : resetStatus.kind === "sent"
                      ? "Resend reset link"
                      : "Send reset link"}
                </Button>
              </form>

              <p className="mt-5 text-[12px] text-muted-foreground text-center">
                Secure end-to-end authentication powered by Supabase.
              </p>
            </>
          )}
        </div>

        {/* Public marketing return link & footer */}
        <div className="mt-8 text-center space-y-2">
          <Link
            to="/site"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium transition-colors"
          >
            ← View Public Marketing Website
          </Link>
          <p className="text-[11px] text-muted-foreground/70">
            © {new Date().getFullYear()} Precise Realtors &amp; Builders (Pvt.) Ltd. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}

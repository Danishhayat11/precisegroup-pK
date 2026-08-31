/* allow-raw-color-file: signup hero overlays dynamic linear gradients for button gloss */
/**
 * Public signup page — creates a new user, then bootstraps a company for
 * them via `bootstrap_company` RPC (SECURITY DEFINER, reassigns their
 * profile + role atomically). On success we hand off to /onboarding.
 *
 * Rendered on a public route; the auth-gated redirect takes over from
 * /onboarding onwards.
 */
import { useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, Navigate } from "@/lib/router-compat";
import { useAuth } from "@/lib/auth";
import { useServerFn } from "@tanstack/react-start";
import { bootstrapCompany } from "@/lib/bootstrapCompany.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { toastError } from "@/lib/friendlyError";
import { Building2, Check } from "lucide-react";
import { PLAN_LABEL, type Plan } from "@/lib/plans";

type PlanCard = {
  id: Plan;
  price: string;
  tagline: string;
  features: string[];
};

const PLANS: PlanCard[] = [
  {
    id: "starter",
    price: "Free trial",
    tagline: "Core booking + payment workflows",
    features: [
      "Bookings & Payments",
      "Installment Ledger",
      "Documents vault",
      "Maintenance (view only)",
    ],
  },
  {
    id: "professional",
    price: "Popular",
    tagline: "Everything in Starter + operations",
    features: [
      "HR, Payroll & Attendance",
      "Office Expenses",
      "Reports & Audit log",
      "Maintenance (full module)",
    ],
  },
  {
    id: "builder",
    price: "Full suite",
    tagline: "Everything in Professional + growth",
    features: [
      "Construction Costs",
      "Leads & CRM pipeline",
      "Multi-user Management",
      "Advanced Reports & API",
    ],
  },
];

const schema = z
  .object({
    company_name: z.string().trim().min(2, "Company name is required").max(120),
    full_name: z.string().trim().min(2, "Your name is required").max(120),
    phone: z
      .string()
      .trim()
      .regex(/^[+\d][\d\s\-()]{9,20}$/, "Enter a valid mobile number"),
    email: z.string().trim().email("Enter a valid email").max(254),
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
    confirm: z.string(),
    plan: z.enum(["starter", "professional", "builder"]),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });

export default function Signup() {
  const { user, loading, refreshCompany } = useAuth();
  const navigate = useNavigate();
  const bootstrap = useServerFn(bootstrapCompany);

  const [form, setForm] = useState({
    company_name: "",
    full_name: "",
    phone: "",
    email: "",
    password: "",
    confirm: "",
    plan: "starter" as Plan,
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const selectedPlan = useMemo(() => PLANS.find((p) => p.id === form.plan)!, [form.plan]);

  if (loading) return null;
  if (user) return <Navigate to="/onboarding" replace />;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const iss of parsed.error.issues) {
        if (iss.path[0]) errs[String(iss.path[0])] = iss.message;
      }
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
          data: {
            full_name: parsed.data.full_name,
          },
        },
      });
      if (error) throw error;
      if (!data.session) {
        // Email confirmation required — user cannot bootstrap yet.
        toast.success("Check your email to confirm the account, then sign in.");
        navigate("/login");
        return;
      }
      // Bootstrap the company via authenticated server function
      // (SECURITY DEFINER RPC — atomically creates the tenant, reassigns the
      // caller's profile, and grants admin role on the new company).
      await bootstrap({
        data: {
          company_name: parsed.data.company_name,
          phone: parsed.data.phone,
          plan: parsed.data.plan,
        },
      });
      await refreshCompany();

      toast.success("Application submitted — a Super Admin will approve your workspace shortly.");
      navigate("/pending-approval");
    } catch (err: any) {
      toastError(err, "Could not create your account", { retry: () => void submit() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-[460px] flex flex-col items-center py-10">
        {/* Brand mark */}
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-primary-foreground shadow-lg mb-4">
            <Building2 className="w-7 h-7" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Precise Realtors &amp; Builders
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Internal Enterprise Resource Platform
          </p>
        </div>

        {/* Card */}
        <div className="w-full bg-card border border-border/60 rounded-[32px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 sm:p-10">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Create account
            </h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              One workspace per company — you&apos;ll be the admin.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field id="company_name" label="Company name" error={errors.company_name}>
              <Input
                id="company_name"
                autoComplete="organization"
                value={form.company_name}
                onChange={(e) => set("company_name", e.target.value)}
                placeholder="Precise Realtors"
                className="min-h-11 rounded-xl bg-muted/60 border-border/60"
              />
            </Field>
            <Field id="full_name" label="Your name" error={errors.full_name}>
              <Input
                id="full_name"
                autoComplete="name"
                value={form.full_name}
                onChange={(e) => set("full_name", e.target.value)}
                placeholder="Jane Doe"
                className="min-h-11 rounded-xl bg-muted/60 border-border/60"
              />
            </Field>
            <Field id="phone" label="Mobile" error={errors.phone}>
              <Input
                id="phone"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+92 300 1234567"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                className="min-h-11 rounded-xl bg-muted/60 border-border/60"
              />
            </Field>
            <Field id="email" label="Email address" error={errors.email}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="name@precise.com"
                className="min-h-11 rounded-xl bg-muted/60 border-border/60"
              />
            </Field>
            <Field id="password" label="Password" error={errors.password}>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder="••••••••"
                className="min-h-11 rounded-xl bg-muted/60 border-border/60"
              />
            </Field>
            <Field id="confirm" label="Confirm password" error={errors.confirm}>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={form.confirm}
                onChange={(e) => set("confirm", e.target.value)}
                placeholder="••••••••"
                className="min-h-11 rounded-xl bg-muted/60 border-border/60"
              />
            </Field>

            <div className="pt-2">
              <Label className="mb-2 block ml-1 text-[13px]">Choose a plan</Label>
              <div className="grid grid-cols-3 gap-2">
                {PLANS.map((p) => {
                  const active = form.plan === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => set("plan", p.id)}
                      aria-pressed={active}
                      className={
                        "text-left rounded-2xl border p-3.5 transition-all duration-300 min-h-11 " +
                        (active
                          ? "border-primary ring-4 ring-primary/20 bg-primary/10 shadow-sm"
                          : "border-border/60 bg-muted/40 hover:border-foreground/30 hover:bg-muted/70")
                      }
                    >
                      <div className="font-semibold text-sm">{PLAN_LABEL[p.id]}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                        {p.price}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">{selectedPlan.tagline}</p>
              {errors.plan && <p className="text-xs text-destructive mt-2">{errors.plan}</p>}
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
              {busy ? "Creating your workspace…" : `Create ${PLAN_LABEL[form.plan]} account`}
            </Button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <a
                href="/login"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/login");
                }}
                className="text-foreground font-medium hover:underline underline-offset-4"
              >
                Sign in
              </a>
            </p>
          </div>
        </div>

        <p className="mt-8 text-xs text-muted-foreground text-center max-w-sm">
          You can switch plans anytime by contacting us on WhatsApp — no data loss.
        </p>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { Navigate, useLocation } from "@/lib/router-compat";
import { resetCurrentCompanyCache } from "@/hooks/useCurrentCompany";
import type { Plan } from "@/lib/plans";
import { useForcedPlan } from "@/lib/devPlanOverride";

type AppRole = "owner" | "admin" | "manager" | "staff" | "viewer" | "super_admin";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  companyId: string | null;
  companyName: string | null;
  plan: Plan | null;
  onboardingCompleted: boolean;
  approvalStatus: "pending" | "approved" | "rejected";
  isCompanyActive: boolean;
  rejectionReason: string | null;
  loading: boolean;
  /** True while roles + company (incl. onboarding_completed_at) are being fetched. */
  companyLoading: boolean;
  signOut: () => Promise<void>;
  refreshCompany: () => Promise<void>;
  isOwner: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  canWrite: boolean;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  roles: [],
  companyId: null,
  companyName: null,
  plan: null,
  onboardingCompleted: true,
  approvalStatus: "approved",
  isCompanyActive: true,
  rejectionReason: null,
  loading: true,
  companyLoading: false,
  signOut: async () => {},
  refreshCompany: async () => {},
  isOwner: false,
  isAdmin: false,
  isSuperAdmin: false,
  canWrite: false,
});

const SEED_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean>(true);
  const [approvalStatus, setApprovalStatus] = useState<"pending" | "approved" | "rejected">(
    "approved",
  );
  const [isCompanyActive, setIsCompanyActive] = useState<boolean>(true);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyLoading, setCompanyLoading] = useState(false);

  /** Shape returned by the `user_roles` select. */
  type RoleRow = { role: AppRole };

  /** Shape returned by the `profiles` select. */
  type ProfileRow = { company_id: string | null };

  /** Shape returned by the `companies` select with the specific columns we request. */
  type CompanyRow = {
    name: string | null;
    plan: string | null;
    onboarding_completed_at: string | null;
    approval_status: string | null;
    is_active: boolean | null;
    rejection_reason: string | null;
  };

  const loadRolesAndCompany = async (uid: string) => {
    setCompanyLoading(true);
    try {
      const [rolesRes, profRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("profiles").select("company_id").eq("id", uid).maybeSingle(),
      ]);
      const roleRows = (rolesRes.data ?? []) as RoleRow[];
      setRoles(roleRows.map((r) => r.role));
      const profile = profRes.data as ProfileRow | null;
      const cid = profile?.company_id ?? null;
      setCompanyId(cid);
      if (cid) {
        const { data } = await supabase
          .from("companies")
          .select(
            "name, plan, onboarding_completed_at, approval_status, is_active, rejection_reason",
          )
          .eq("id", cid)
          .maybeSingle();
        const co = data as CompanyRow | null;
        setCompanyName(co?.name ?? null);
        setPlan((co?.plan ?? null) as Plan | null);
        // Treat the shared seed company as "already onboarded" — the wizard
        // only kicks in for freshly bootstrapped, single-tenant companies.
        const completed =
          cid === SEED_COMPANY_ID ? true : Boolean(co?.onboarding_completed_at);
        setOnboardingCompleted(completed);
        setApprovalStatus(
          (co?.approval_status ?? "approved") as "pending" | "approved" | "rejected",
        );
        setIsCompanyActive(Boolean(co?.is_active ?? true));
        setRejectionReason(co?.rejection_reason ?? null);
      } else {
        setCompanyName(null);
        setPlan(null);
        setOnboardingCompleted(true);
        setApprovalStatus("approved");
        setIsCompanyActive(true);
        setRejectionReason(null);
      }
    } finally {
      setCompanyLoading(false);
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) setTimeout(() => loadRolesAndCompany(s.user.id), 0);
      else {
        setRoles([]);
        setCompanyId(null);
        setCompanyName(null);
        setPlan(null);
        setOnboardingCompleted(true);
        resetCurrentCompanyCache();
      }
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) loadRolesAndCompany(s.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const isOwner = roles.includes("owner");
  // Dev-only preview override — resolves to null in production bundles.
  // When set (via ?forcePlan=starter|professional|builder), every
  // consumer of `useAuth().plan` sees the forced tier without touching
  // the database. See src/lib/devPlanOverride.ts.
  const forcedPlan = useForcedPlan();
  const effectivePlan = forcedPlan ?? plan;
  const value: AuthCtx = {
    user,
    session,
    roles,
    companyId,
    companyName,
    plan: effectivePlan,
    onboardingCompleted,
    approvalStatus,
    isCompanyActive,
    rejectionReason,
    loading,
    companyLoading,
    signOut: async () => {
      resetCurrentCompanyCache();
      await supabase.auth.signOut();
    },
    refreshCompany: async () => {
      if (user) await loadRolesAndCompany(user.id);
    },
    isOwner,
    // Owner is a superset of admin — they get every admin-gated capability.
    isAdmin: isOwner || roles.includes("admin") || roles.includes("super_admin"),
    isSuperAdmin: roles.includes("super_admin"),
    canWrite: roles.some((r) => ["owner", "admin", "manager", "staff", "super_admin"].includes(r)),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <div className="text-muted-foreground text-sm animate-pulse">Loading workspace…</div>
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

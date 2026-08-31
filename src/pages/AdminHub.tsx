import { Link } from "@/lib/router-compat";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { superAdminPendingCount } from "@/lib/superAdmin.functions";
import {
  Users,
  Activity,
  ClipboardEdit,
  GitBranch,
  Sparkles,
  Shield,
  Wrench,
  ShieldCheck,
  Crown,
  BarChart3,
  Timer,
  LayoutTemplate,
} from "lucide-react";

const CARDS = [
  {
    to: "/users",
    title: "Users & Roles",
    desc: "Invite teammates and manage Admin / Staff / Viewer access.",
    icon: Users,
  },
  {
    to: "/health",
    title: "Data Health Dashboard",
    desc: "Continuous accounting audits across every booking.",
    icon: Activity,
  },
  {
    to: "/admin/payment-edit-history",
    title: "Payment Edit History",
    desc: "Every admin edit — who, when, what changed, why.",
    icon: ClipboardEdit,
  },
  {
    to: "/admin/plan-restructure-history",
    title: "Plan Restructure History",
    desc: "Before / after snapshots for every plan change.",
    icon: GitBranch,
  },
  {
    to: "/admin/ssr-monitor",
    title: "SSR Error Monitor",
    desc: "Production error rates and recent stack traces.",
    icon: Shield,
  },
  {
    to: "/admin/tenant-audit",
    title: "Tenant Audit",
    desc: "Your company_id, roles, and live RLS enforcement probes.",
    icon: ShieldCheck,
  },
  {
    to: "/admin/isolation-check",
    title: "Isolation Check",
    desc: "Positive/negative controls across two tenants with pass/fail results.",
    icon: ShieldCheck,
  },
  {
    to: "/admin/ai-diagnostics",
    title: "AI Diagnostics",
    desc: "Last tool calls, arguments, and gateway responses from the assistant.",
    icon: Wrench,
  },
  {
    to: "/admin/super-admins",
    title: "Super Admins",
    desc: "Directory of accounts that hold the super_admin role (email + user id).",
    icon: Crown,
  },
  {
    to: "/admin/rpc-denials",
    title: "RPC Denial Metrics",
    desc: "Aggregated counts of revoked-RPC denials by function name and error code.",
    icon: BarChart3,
  },
  {
    to: "/admin/super-admin-auth-audit",
    title: "Super Admin Auth Audit",
    desc: "Recent Super Admin authorization denials, filterable by function, tenant, and actor.",
    icon: ShieldCheck,
  },
  {
    to: "/admin/super-admin-denial-alerts",
    title: "Super Admin Denial Alerts",
    desc: "Server-side alerts for repeated Super Admin authorization denials clustering on the same actor or tenant.",
    icon: Shield,
  },
  {
    to: "/admin/print-readiness-timeouts",
    title: "Print Readiness Timeouts",
    desc: "Configure per-stage timeout limits (Fonts / Images / Layout) for the print preview readiness engine.",
    icon: Timer,
  },
  {
    to: "/admin/marketing-controls",
    title: "Marketing Controls",
    desc: "Enable or disable marketing site sections like Leadership or Featured Listings without code changes.",
    icon: LayoutTemplate,
  },

  {
    to: "/settings",
    title: "AI Assistant Permissions",
    desc: "Coming soon — safety limits for the Precise Assistant.",
    icon: Sparkles,
  },
];

const SUPER_CARD = {
  to: "/superadmin",
  title: "Super Admin",
  desc: "Approve new tenants, change plans, and control every company on the platform.",
  icon: Crown,
};

export default function AdminHub() {
  const { isSuperAdmin } = useAuth();
  const pendingFn = useServerFn(superAdminPendingCount);
  const { data: pending } = useQuery({
    queryKey: ["superadmin", "pending-count"],
    queryFn: () => pendingFn(),
    enabled: isSuperAdmin,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const pendingCount = pending?.count ?? 0;
  const cards = isSuperAdmin ? [SUPER_CARD, ...CARDS] : CARDS;
  return (
    <div>
      <PageHeader
        title="Admin Controls"
        description="Everything that needs Admin access lives here."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => {
          const showBadge = c.to === "/superadmin" && pendingCount > 0;
          return (
            <Link
              key={c.to}
              to={c.to}
              className="card-elevated p-5 hover:shadow-md transition-shadow group relative"
            >
              {showBadge && (
                <span
                  aria-label={`${pendingCount} tenants awaiting approval`}
                  className="absolute top-3 right-3 min-w-6 h-6 px-2 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold grid place-items-center shadow-sm"
                >
                  {pendingCount}
                </span>
              )}
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 grid place-items-center text-primary">
                  <c.icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold group-hover:text-primary flex items-center gap-2">
                    {c.title}
                    {showBadge && (
                      <span className="text-xs font-medium text-destructive">
                        {pendingCount} pending
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{c.desc}</div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

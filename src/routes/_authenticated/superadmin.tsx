import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  XCircle,
  PowerOff,
  Power,
  UserPlus,
  Trash2,
  Building2,
  Crown,
  ClipboardList,
  Sparkles,
  Loader2,
  AlertTriangle,
  ScrollText,
  LogIn,
  Search,
  FilterX,
} from "lucide-react";
import {
  superAdminListCompanies,
  superAdminApproveCompany,
  superAdminRejectCompany,
  superAdminSetCompanyActive,
  superAdminChangePlan,
  superAdminGrantSuperAdmin,
  superAdminRevokeSuperAdmin,
  superAdminListSuperAdmins,
  superAdminAiReviewCompany,
  superAdminListAuditLog,
  superAdminImpersonateCompany,
  type CompanyRow,
  type AiCompanyReview,
  type SuperAdminAuditRow,
} from "@/lib/superAdmin.functions";

import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/superadmin")({
  ssr: false,
  component: SuperAdminPage,
  errorComponent: makeRouteErrorComponent("Super Admin"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Super Admin",
    backTo: "/",
  }),
});

type Tab = "pending" | "all" | "super-admins" | "audit";

function SuperAdminPage() {
  const { isSuperAdmin, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("pending");

  if (loading) return null;
  if (!isSuperAdmin) {
    return (
      <div className="space-y-4">
        <PageHeader title="Super Admin" description="Restricted area" />
        <Card>
          <CardContent className="p-6 flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <div className="font-semibold">Super Admin access required</div>
              <p className="text-sm text-muted-foreground mt-1">
                Only Super Admins can approve new tenants and manage companies across the platform.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Super Admin"
        description="Approve new tenants, manage every company, and grant Super Admin access."
      />

      <div className="flex flex-wrap gap-1 border-b">
        {(
          [
            { id: "pending", label: "Pending Approvals", Icon: ClipboardList },
            { id: "all", label: "All Companies", Icon: Building2 },
            { id: "super-admins", label: "Super Admins", Icon: Crown },
            { id: "audit", label: "Audit Log", Icon: ScrollText },
          ] as { id: Tab; label: string; Icon: typeof Building2 }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors min-h-11 ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            aria-current={tab === t.id ? "page" : undefined}
          >
            <t.Icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pending" && <AiReviewPanel />}
      {tab === "pending" && <CompaniesTable filter="pending" />}
      {tab === "all" && <CompaniesTable filter="all" />}
      {tab === "super-admins" && <SuperAdminsPanel />}
      {tab === "audit" && <AuditLogPanel />}
    </div>
  );
}

/* ─────────────────────────────── Companies table ─────────────────────────────── */

function CompaniesTable({ filter }: { filter: "pending" | "all" }) {
  const qc = useQueryClient();
  const listFn = useServerFn(superAdminListCompanies);
  const approveFn = useServerFn(superAdminApproveCompany);
  const rejectFn = useServerFn(superAdminRejectCompany);
  const setActiveFn = useServerFn(superAdminSetCompanyActive);
  const changePlanFn = useServerFn(superAdminChangePlan);
  const impersonateFn = useServerFn(superAdminImpersonateCompany);

  const q = useQuery({
    queryKey: ["superadmin-companies"],
    queryFn: () => listFn(),
    staleTime: 15_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["superadmin-companies"] });

  const approveM = useMutation({
    mutationFn: (id: string) => approveFn({ data: { company_id: id } }),
    onSuccess: invalidate,
  });
  const rejectM = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      rejectFn({ data: { company_id: v.id, reason: v.reason } }),
    onSuccess: invalidate,
  });
  const activeM = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      setActiveFn({ data: { company_id: v.id, active: v.active } }),
    onSuccess: invalidate,
  });
  const planM = useMutation({
    mutationFn: (v: { id: string; plan: "starter" | "professional" | "builder" }) =>
      changePlanFn({ data: { company_id: v.id, plan: v.plan } }),
    onSuccess: invalidate,
  });
  const impersonateM = useMutation({
    mutationFn: (id: string) =>
      impersonateFn({
        data: {
          company_id: id,
          redirect_to: `${window.location.origin}/`,
        },
      }),
    onSuccess: (res) => {
      // Open the magic-link in a new tab so the Super Admin's current
      // session stays intact in this tab.
      if (res?.url) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      }
    },
  });

  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<string>("any");
  const [regionFilter, setRegionFilter] = useState<string>("any");
  const [statusFilter, setStatusFilter] = useState<string>("any");
  const [activeFilter, setActiveFilter] = useState<string>("any");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const allRows = q.data ?? [];

  const regionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of allRows) {
      const v = (c.city ?? "").trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const rows: CompanyRow[] = useMemo(() => {
    const base =
      filter === "pending" ? allRows.filter((c) => c.approval_status === "pending") : allRows;
    const term = search.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    return base.filter((c) => {
      if (term) {
        const hay =
          `${c.name ?? ""} ${c.email ?? ""} ${c.phone ?? ""} ${c.city ?? ""} ${c.id}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (planFilter !== "any" && c.plan !== planFilter) return false;
      if (regionFilter !== "any" && (c.city ?? "") !== regionFilter) return false;
      if (filter === "all" && statusFilter !== "any" && c.approval_status !== statusFilter)
        return false;
      if (activeFilter === "active" && !c.is_active) return false;
      if (activeFilter === "inactive" && c.is_active) return false;
      const created = new Date(c.created_at).getTime();
      if (fromTs !== null && created < fromTs) return false;
      if (toTs !== null && created > toTs) return false;
      return true;
    });
  }, [
    allRows,
    filter,
    search,
    planFilter,
    regionFilter,
    statusFilter,
    activeFilter,
    dateFrom,
    dateTo,
  ]);

  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    (planFilter !== "any" ? 1 : 0) +
    (regionFilter !== "any" ? 1 : 0) +
    (filter === "all" && statusFilter !== "any" ? 1 : 0) +
    (activeFilter !== "any" ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setPlanFilter("any");
    setRegionFilter("any");
    setStatusFilter("any");
    setActiveFilter("any");
    setDateFrom("");
    setDateTo("");
  };

  const busyMsg =
    approveM.error?.message ||
    rejectM.error?.message ||
    activeM.error?.message ||
    planM.error?.message ||
    impersonateM.error?.message ||
    (q.error as Error | undefined)?.message ||
    null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">
            {filter === "pending" ? "Companies awaiting approval" : "All companies"}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {filter === "pending"
              ? "Newly signed-up tenants that need your approval before their users can access the platform."
              : "Every tenant in the platform. Change plan, deactivate, or revoke approval."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-4 space-y-3">
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, phone, city, or ID…"
                className="pl-9 min-h-11"
              />
            </div>
            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className="min-h-11">
                <SelectValue placeholder="Plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any plan</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="builder">Builder</SelectItem>
              </SelectContent>
            </Select>
            <Select value={regionFilter} onValueChange={setRegionFilter}>
              <SelectTrigger className="min-h-11">
                <SelectValue placeholder="Region" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any region</SelectItem>
                {regionOptions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            {filter === "all" && (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="min-h-11">
                  <SelectValue placeholder="Approval status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={activeFilter} onValueChange={setActiveFilter}>
              <SelectTrigger className="min-h-11">
                <SelectValue placeholder="Activation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Active + inactive</SelectItem>
                <SelectItem value="active">Active only</SelectItem>
                <SelectItem value="inactive">Inactive only</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="min-h-11"
                max={dateTo || undefined}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">To</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="min-h-11"
                min={dateFrom || undefined}
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing <span className="font-medium text-foreground">{rows.length}</span> of{" "}
              {allRows.length} companies
              {activeFilterCount > 0
                ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active`
                : ""}
            </span>
            {activeFilterCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11"
                onClick={clearFilters}
              >
                <FilterX className="mr-1.5 h-4 w-4" /> Clear filters
              </Button>
            )}
          </div>
        </div>
        {busyMsg && (
          <div className="mb-3 rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {busyMsg}
          </div>
        )}
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground p-6 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground p-6 text-center">
            {allRows.length === 0
              ? filter === "pending"
                ? "No pending approvals — you're all caught up."
                : "No companies yet."
              : "No companies match the current filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Contact</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2 text-right">Users</th>
                  <th className="px-3 py-2 text-right">Bookings</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <CompanyRowView
                    key={c.id}
                    row={c}
                    onApprove={() => approveM.mutate(c.id)}
                    onReject={(reason) => rejectM.mutate({ id: c.id, reason })}
                    onSetActive={(active) => activeM.mutate({ id: c.id, active })}
                    onChangePlan={(plan) => planM.mutate({ id: c.id, plan })}
                    onImpersonate={() => impersonateM.mutate(c.id)}
                    impersonateBusyId={
                      impersonateM.isPending ? (impersonateM.variables as string) : null
                    }
                    isBusy={
                      approveM.isPending ||
                      rejectM.isPending ||
                      activeM.isPending ||
                      planM.isPending
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CompanyRowView({
  row,
  onApprove,
  onReject,
  onSetActive,
  onChangePlan,
  onImpersonate,
  impersonateBusyId,
  isBusy,
}: {
  row: CompanyRow;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onSetActive: (active: boolean) => void;
  onChangePlan: (plan: "starter" | "professional" | "builder") => void;
  onImpersonate: () => void;
  impersonateBusyId: string | null;
  isBusy: boolean;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const status = row.approval_status;
  const statusBadge =
    status === "approved" ? (
      <Badge variant="secondary" className="gap-1">
        <ShieldCheck className="h-3 w-3" /> Approved
      </Badge>
    ) : status === "pending" ? (
      <Badge className="gap-1 bg-warning text-warning-foreground hover:bg-warning/90">
        <ClipboardList className="h-3 w-3" /> Pending
      </Badge>
    ) : (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> Rejected
      </Badge>
    );

  return (
    <>
      <tr className="border-t align-top">
        <td className="px-3 py-3">
          <div className="font-medium">{row.name}</div>
          <div className="text-xs text-muted-foreground font-mono break-all">{row.id}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Created {new Date(row.created_at).toLocaleDateString()}
          </div>
          {row.rejection_reason ? (
            <div className="text-xs text-destructive mt-1">Reason: {row.rejection_reason}</div>
          ) : null}
        </td>
        <td className="px-3 py-3 text-xs">
          <div>{row.email ?? "—"}</div>
          <div className="text-muted-foreground">{row.phone ?? "—"}</div>
          <div className="text-muted-foreground">{row.city ?? "—"}</div>
        </td>
        <td className="px-3 py-3">
          <Select
            value={row.plan}
            onValueChange={(v) => onChangePlan(v as "starter" | "professional" | "builder")}
            disabled={isBusy}
          >
            <SelectTrigger className="h-9 min-h-11 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="starter">Starter</SelectItem>
              <SelectItem value="professional">Professional</SelectItem>
              <SelectItem value="builder">Builder</SelectItem>
            </SelectContent>
          </Select>
        </td>
        <td className="px-3 py-3 text-right tabular-nums">{row.user_count}</td>
        <td className="px-3 py-3 text-right tabular-nums">{row.booking_count}</td>
        <td className="px-3 py-3">
          <div className="flex flex-col gap-1">
            {statusBadge}
            {row.is_active ? (
              <Badge variant="outline" className="gap-1">
                <Power className="h-3 w-3" /> Active
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <PowerOff className="h-3 w-3" /> Inactive
              </Badge>
            )}
          </div>
        </td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap justify-end gap-2">
            {status !== "approved" && (
              <Button size="sm" className="min-h-11" onClick={onApprove} disabled={isBusy}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
              </Button>
            )}
            {status !== "rejected" && (
              <Button
                size="sm"
                variant="outline"
                className="min-h-11"
                onClick={() => setRejectOpen((v) => !v)}
                disabled={isBusy}
              >
                <XCircle className="mr-1.5 h-4 w-4" /> Reject
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              onClick={() => onSetActive(!row.is_active)}
              disabled={isBusy}
            >
              {row.is_active ? (
                <>
                  <PowerOff className="mr-1.5 h-4 w-4" /> Deactivate
                </>
              ) : (
                <>
                  <Power className="mr-1.5 h-4 w-4" /> Activate
                </>
              )}
            </Button>
            {row.user_count > 0 && (
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11"
                title="Sign in as a member of this tenant in a new tab to verify their dashboard."
                onClick={() => {
                  const ok = window.confirm(
                    `Impersonate "${row.name}"?\n\n` +
                      `This opens a new tab signed in as one of their members ` +
                      `(owner if available). Every impersonation is written to the audit log.`,
                  );
                  if (ok) onImpersonate();
                }}
                disabled={isBusy || impersonateBusyId === row.id}
              >
                {impersonateBusyId === row.id ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Impersonating…
                  </>
                ) : (
                  <>
                    <LogIn className="mr-1.5 h-4 w-4" /> Impersonate
                  </>
                )}
              </Button>
            )}
          </div>
        </td>
      </tr>
      {rejectOpen && (
        <tr className="border-t bg-muted/30">
          <td colSpan={7} className="px-3 py-3">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <label className="text-sm font-medium sm:w-40">Rejection reason</label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Duplicate registration, invalid details…"
                className="flex-1 min-h-11"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="min-h-11"
                  onClick={() => {
                    if (reason.trim().length < 3) return;
                    onReject(reason.trim());
                    setRejectOpen(false);
                    setReason("");
                  }}
                  disabled={isBusy || reason.trim().length < 3}
                >
                  Confirm reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    setRejectOpen(false);
                    setReason("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─────────────────────────────── Super admins panel ─────────────────────────────── */

function SuperAdminsPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(superAdminListSuperAdmins);
  const grantFn = useServerFn(superAdminGrantSuperAdmin);
  const revokeFn = useServerFn(superAdminRevokeSuperAdmin);
  const [email, setEmail] = useState("");

  const q = useQuery({
    queryKey: ["superadmin-super-admins"],
    queryFn: () => listFn(),
    staleTime: 15_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["superadmin-super-admins"] });

  const grantM = useMutation({
    mutationFn: () => grantFn({ data: { email: email.trim() } }),
    onSuccess: () => {
      setEmail("");
      invalidate();
    },
  });
  const revokeM = useMutation({
    mutationFn: (userId: string) => revokeFn({ data: { user_id: userId } }),
    onSuccess: invalidate,
  });

  const err =
    grantM.error?.message || revokeM.error?.message || (q.error as Error | undefined)?.message;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Super Admins</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Users with cross-tenant Super Admin access. Grant sparingly — this role can view and
          control every company.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {err && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {err}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Grant Super Admin by email
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="mt-1 min-h-11"
            />
          </div>
          <Button
            className="min-h-11"
            onClick={() => grantM.mutate()}
            disabled={grantM.isPending || !/.+@.+\..+/.test(email.trim())}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            {grantM.isPending ? "Granting…" : "Grant"}
          </Button>
        </div>

        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (q.data ?? []).length === 0 ? (
          <div className="text-sm text-muted-foreground">No Super Admins found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Home company</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(q.data ?? []).map((r) => (
                  <tr key={r.user_id} className="border-t">
                    <td className="px-3 py-3">{r.full_name ?? "—"}</td>
                    <td className="px-3 py-3">{r.email ?? "—"}</td>
                    <td className="px-3 py-3">{r.company_name ?? "—"}</td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-11"
                        onClick={() => {
                          if (confirm(`Revoke Super Admin from ${r.email ?? r.user_id}?`)) {
                            revokeM.mutate(r.user_id);
                          }
                        }}
                        disabled={revokeM.isPending}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" /> Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────── AI Review panel ─────────────────────────────── */

function AiReviewPanel() {
  const listFn = useServerFn(superAdminListCompanies);
  const q = useQuery({
    queryKey: ["superadmin-companies"],
    queryFn: () => listFn(),
    staleTime: 15_000,
  });
  const pending = useMemo(
    () => (q.data ?? []).filter((c) => c.approval_status === "pending"),
    [q.data],
  );

  if (q.isLoading || pending.length === 0) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          AI review — pending tenants
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          A summary and recommendation for each company awaiting approval. The final decision is
          yours.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {pending.map((c) => (
          <AiReviewCard key={c.id} company={c} />
        ))}
      </CardContent>
    </Card>
  );
}

function AiReviewCard({ company }: { company: CompanyRow }) {
  const reviewFn = useServerFn(superAdminAiReviewCompany);
  const q = useQuery({
    queryKey: ["superadmin-ai-review", company.id],
    queryFn: () => reviewFn({ data: { company_id: company.id } }),
    enabled: false,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const r: AiCompanyReview | undefined = q.data;

  const verdictBadge = r ? verdictBadgeFor(r.verdict) : null;

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold truncate">{company.name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {company.email ?? "no email"} · {company.city ?? "no city"} · signed up{" "}
            {new Date(company.created_at).toLocaleDateString()}
          </div>
        </div>
        <Button
          size="sm"
          variant={r ? "outline" : "default"}
          className="min-h-11 shrink-0"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          {q.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {r ? "Re-run" : "Review with AI"}
        </Button>
      </div>

      {q.error && (
        <div className="mt-3 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
          {(q.error as Error).message}
        </div>
      )}

      {r && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {verdictBadge}
            <Badge variant="outline" className="capitalize">
              Confidence: {r.confidence}
            </Badge>
            {r.suggested_plan && (
              <Badge variant="outline" className="capitalize">
                Suggested plan: {r.suggested_plan}
              </Badge>
            )}
          </div>
          <p className="text-sm">{r.summary}</p>
          {r.reasons.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Reasons
              </div>
              <ul className="mt-1 list-disc pl-5 text-sm space-y-0.5">
                {r.reasons.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {r.risks.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Risks
              </div>
              <ul className="mt-1 list-disc pl-5 text-sm space-y-0.5">
                {r.risks.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function verdictBadgeFor(v: AiCompanyReview["verdict"]) {
  if (v === "approve")
    return (
      <Badge className="gap-1 bg-success text-success-foreground hover:bg-success/90">
        <CheckCircle2 className="h-3 w-3" /> Recommend approve
      </Badge>
    );
  if (v === "reject")
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> Recommend reject
      </Badge>
    );
  return (
    <Badge className="gap-1 bg-warning text-warning-foreground hover:bg-warning/90">
      <ClipboardList className="h-3 w-3" /> Hold for review
    </Badge>
  );
}

/* ─────────────────────────────── Audit Log ─────────────────────────────── */

const ACTION_META: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> =
  {
    "company.approve": {
      label: "Approved",
      className: "bg-success/15 text-success border-success/30",
      Icon: CheckCircle2,
    },
    "company.reject": {
      label: "Rejected",
      className: "bg-destructive/15 text-destructive border-destructive/30",
      Icon: XCircle,
    },
    "company.activate": {
      label: "Activated",
      className: "bg-success/15 text-success border-success/30",
      Icon: Power,
    },
    "company.deactivate": {
      label: "Deactivated",
      className: "bg-warning/15 text-warning border-warning/30",
      Icon: PowerOff,
    },
    "company.change_plan": {
      label: "Plan Changed",
      className: "bg-primary/10 text-primary border-primary/30",
      Icon: RefreshCw,
    },
    "company.impersonate": {
      label: "Impersonated",
      className: "bg-primary/10 text-primary border-primary/30",
      Icon: LogIn,
    },
    "super_admin.grant": {
      label: "Granted SA",
      className: "bg-primary/10 text-primary border-primary/30",
      Icon: Crown,
    },
    "super_admin.revoke": {
      label: "Revoked SA",
      className: "bg-destructive/15 text-destructive border-destructive/30",
      Icon: Trash2,
    },
  };

function AuditLogPanel() {
  const listFn = useServerFn(superAdminListAuditLog);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["superadmin-audit-log"],
    queryFn: () => listFn(),
    staleTime: 15_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-5 w-5" /> Audit Log
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ["superadmin-audit-log"] })}
          disabled={q.isFetching}
          className="gap-2"
        >
          {q.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading audit log…
          </div>
        ) : q.isError ? (
          <div className="flex items-start gap-2 text-sm text-destructive p-3 rounded-md bg-destructive/10">
            <AlertTriangle className="h-4 w-4 mt-0.5" /> {(q.error as Error).message}
          </div>
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No Super Admin actions recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">Actor</th>
                  <th className="py-2 pr-3">Company</th>
                  <th className="py-2 pr-3">Target</th>
                  <th className="py-2 pr-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {(q.data as SuperAdminAuditRow[]).map((row) => {
                  const meta = ACTION_META[row.action] ?? {
                    label: row.action,
                    className: "bg-muted text-muted-foreground border-border",
                    Icon: ClipboardList,
                  };
                  const detailKeys = Object.keys(row.details ?? {});
                  return (
                    <tr key={row.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                          <meta.Icon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{row.actor_email ?? "—"}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {row.actor_id.slice(0, 8)}…
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {row.company_name ? (
                          <>
                            <div className="font-medium">{row.company_name}</div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {row.company_id?.slice(0, 8)}…
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {row.target_user_email ? (
                          <>
                            <div className="font-medium">{row.target_user_email}</div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {row.target_user_id?.slice(0, 8)}…
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {detailKeys.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="space-y-0.5">
                            {detailKeys.map((k) => (
                              <div key={k} className="text-xs">
                                <span className="text-muted-foreground">{k}:</span>{" "}
                                <span className="font-mono">{String((row.details as any)[k])}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

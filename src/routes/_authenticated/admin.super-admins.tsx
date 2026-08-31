import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Crown, Copy, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TableRowsSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/EmptyState";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";
import { listSuperAdminsForAdmin } from "@/lib/adminSuperAdmins.functions";

export const Route = createFileRoute("/_authenticated/admin/super-admins")({
  ssr: false,
  component: SuperAdminsListPage,
  errorComponent: makeRouteErrorComponent("Super Admins"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Super Admins",
    backTo: "/admin",
  }),
  head: () => ({
    meta: [
      { title: "Super Admins · Admin Controls" },
      {
        name: "description",
        content: "Directory of accounts that hold the Super Admin role.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function SuperAdminsListPage() {
  const { isSuperAdmin, loading } = useAuth();
  const router = useRouter();
  const fetchSuperAdmins = useServerFn(listSuperAdminsForAdmin);

  const {
    data = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["admin", "super-admins"],
    queryFn: () => fetchSuperAdmins(),
    enabled: !loading && isSuperAdmin,
    retry: (failureCount, error: any) => {
      // Don't retry on Unauthorized — redirect instead
      if (error?.message === "Unauthorized") return false;
      return failureCount < 3;
    },
  });

  useEffect(() => {
    if (isError && (error as any)?.message === "Unauthorized") {
      void router.navigate({
        to: "/login" as any,
        search: { next: window.location.pathname } as any,
      });
    }
  }, [isError, error, router]);

  if (loading) return null;
  if (!isSuperAdmin) {
    return (
      <div className="space-y-4">
        <PageHeader title="Super Admins" description="Restricted area" />
        <AdminRequiredMessage action="Viewing the Super Admin directory (super_admin role required)" />
      </div>
    );
  }

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Super Admins"
        description="Every account that currently holds the Super Admin role. Passwords are never shown — Lovable stores them as one-way hashes and no client (admin or otherwise) can read them."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Crown className="h-4 w-4" aria-hidden />
            Accounts with role: super_admin
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isError ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              <AlertTitle>Couldn't load Super Admins</AlertTitle>
              <AlertDescription>
                {(error as Error | undefined)?.message ?? "Unknown error"}
              </AlertDescription>
            </Alert>
          ) : isLoading ? (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">User ID</th>
                  <th className="py-2 pr-3 w-1" />
                </tr>
              </thead>
              <tbody>
                <TableRowsSkeleton rows={3} columns={3} />
              </tbody>
            </table>
          ) : data.length === 0 ? (
            <EmptyState
              icon={Crown}
              compact
              title="No Super Admins found"
              description="Nobody currently holds the super_admin role."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">User ID</th>
                  <th className="py-2 pr-3 w-1" />
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.user_id} className="border-t">
                    <td className="py-2 pr-3">
                      {row.email ? (
                        <span className="font-medium">{row.email}</span>
                      ) : (
                        <span className="text-muted-foreground italic">no email on profile</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.user_id}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1 justify-end">
                        {row.email && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="min-h-11 min-w-11"
                            aria-label={`Copy email ${row.email}`}
                            onClick={() => copy(row.email!, "Email")}
                          >
                            <Copy className="h-4 w-4" aria-hidden />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="min-h-11 min-w-11"
                          aria-label={`Copy user id ${row.user_id}`}
                          onClick={() => copy(row.user_id, "User ID")}
                        >
                          <Copy className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

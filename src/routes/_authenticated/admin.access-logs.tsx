import { createFileRoute } from "@tanstack/react-router";
import { usePIIGuardedQuery } from "@/lib/access";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/format";
import { Shield, Clock, Globe } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/admin/access-logs")({
  component: AdminAccessLogsPage,
});

function AdminAccessLogsPage() {
  const { data: logs, isLoading } = usePIIGuardedQuery<any[]>({
    queryKey: ["admin-access-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_access_audit_log")
        .select(
          `
          *,
          profiles:user_id (
            full_name,
            email
          )
        `,
        )
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Access Audit Logs</h1>
          <p className="text-muted-foreground">
            Review security events, dashboard permission checks, and authorization failures.
          </p>
        </div>
        <Shield className="h-8 w-8 text-primary" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Recent Security Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Context</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!logs || logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No security events recorded.
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {fmtDate(new Date(log.created_at))}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {log.profiles?.full_name || "Unknown User"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {log.profiles?.email || log.user_id}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              log.event_type.includes("denied") ||
                              log.event_type.includes("failure")
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {log.event_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{log.resource}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 max-w-xs overflow-hidden">
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Globe className="h-3 w-3" />
                              {log.ip_address || "Local"}
                            </div>
                            <pre className="text-[10px] bg-muted p-1 rounded overflow-x-auto whitespace-pre-wrap">
                              {log.metadata ? JSON.stringify(log.metadata, null, 2) : "{}"}
                            </pre>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

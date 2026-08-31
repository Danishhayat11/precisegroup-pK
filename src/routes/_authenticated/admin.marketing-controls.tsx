import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMarketingControls,
  updateMarketingControl,
  getMarketingHistory,
  revertMarketingControl,
  createMarketingControl,
  deleteMarketingControl,
} from "@/lib/marketingControls.functions";
import { runHealthCheck } from "@/lib/healthCheck.functions";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardDescription, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Shield,
  Eye,
  EyeOff,
  Loader2,
  History,
  RotateCcw,
  User,
  Plus,
  Trash2,
  Activity,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const Route = createFileRoute("/_authenticated/admin/marketing-controls")({
  component: MarketingControlsPage,
});

function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h3 className={`font-semibold leading-none tracking-tight ${className}`}>{children}</h3>;
}

function MarketingControlsPage() {
  const queryClient = useQueryClient();
  const fetchControls = useServerFn(getMarketingControls);
  const updateControlFn = useServerFn(updateMarketingControl);
  const createControlFn = useServerFn(createMarketingControl);
  const deleteControlFn = useServerFn(deleteMarketingControl);
  const fetchHistory = useServerFn(getMarketingHistory);
  const revertControlFn = useServerFn(revertMarketingControl);
  const checkHealthFn = useServerFn(runHealthCheck);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newEnabled, setNewEnabled] = useState(true);

  const {
    data: health,
    refetch: refetchHealth,
    isFetching: isFetchingHealth,
  } = useQuery({
    queryKey: ["marketing-health"],
    queryFn: () => checkHealthFn({ data: { refresh: false } }),
  });

  const refreshHealthMutation = useMutation({
    mutationFn: () => checkHealthFn({ data: { refresh: true } }),
    onSuccess: (data) => {
      if (data.status === "ok") {
        toast.success("Schema cache refreshed successfully");
      } else {
        toast.error(`Refresh failed: ${data.phase}`);
      }
      queryClient.invalidateQueries({ queryKey: ["marketing-health"] });
      queryClient.invalidateQueries({ queryKey: ["marketing-controls"] });
    },
  });

  const { data: controls, isLoading } = useQuery({
    queryKey: ["marketing-controls"],
    queryFn: () => fetchControls(),
  });

  const { data: history, isLoading: isLoadingHistory } = useQuery({
    queryKey: ["marketing-history"],
    queryFn: () => fetchHistory(),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { section_key: string; is_enabled: boolean }) =>
      updateControlFn({ data: vars }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["marketing-controls"] });
      queryClient.invalidateQueries({ queryKey: ["marketing-history"] });
      toast.success(`${variables.section_key} updated`);
    },
  });

  const createMutation = useMutation({
    mutationFn: (vars: { section_key: string; is_enabled: boolean }) =>
      createControlFn({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketing-controls"] });
      queryClient.invalidateQueries({ queryKey: ["marketing-history"] });
      toast.success("Section created");
      setIsCreateOpen(false);
      setNewKey("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (section_key: string) => deleteControlFn({ data: { section_key } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketing-controls"] });
      queryClient.invalidateQueries({ queryKey: ["marketing-history"] });
      toast.success("Section deleted");
    },
  });

  const revertMutation = useMutation({
    mutationFn: (historyId: string) => revertControlFn({ data: { id: historyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketing-controls"] });
      queryClient.invalidateQueries({ queryKey: ["marketing-history"] });
      toast.success("Successfully reverted change");
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-5xl py-10 space-y-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary border border-primary/20 shadow-sm">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Marketing Controls</h1>
            <p className="text-muted-foreground">Manage dynamic sections of your marketing site.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => refetchHealth()}
            disabled={isFetchingHealth}
          >
            <Activity className={`h-4 w-4 ${isFetchingHealth ? "animate-pulse" : ""}`} />
            Health Check
          </Button>

          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> Add Section
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Section</DialogTitle>
                <DialogDescription>
                  Add a new controllable section for the marketing site.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="key">Section Key (snake_case)</Label>
                  <Input
                    id="key"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="e.g. hero_banner"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="enabled" checked={newEnabled} onCheckedChange={setNewEnabled} />
                  <Label htmlFor="enabled">Enable by default</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    createMutation.mutate({ section_key: newKey, is_enabled: newEnabled })
                  }
                  disabled={!newKey || createMutation.isPending}
                >
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {health && health.status === "error" && (
        <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="flex items-center justify-between">
            <span>
              System Health Alert:{" "}
              {health.phase?.replace("_", " ").toUpperCase() || "Runtime Error"}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 min-w-11 text-[10px] gap-1.5 border-destructive/30 hover:bg-destructive/10"
              onClick={() => refreshHealthMutation.mutate()}
              disabled={refreshHealthMutation.isPending}
            >
              {refreshHealthMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Force Schema Refresh
            </Button>
          </AlertTitle>
          <AlertDescription className="mt-2 space-y-2">
            <p className="font-semibold text-sm">{health.message}</p>
            {health.error && (
              <div className="bg-muted p-2 rounded text-[11px] font-mono break-all opacity-80">
                {health.error}
              </div>
            )}
            {health.hint && (
              <div className="flex items-start gap-2 text-xs opacity-90 italic">
                <span className="font-bold shrink-0">Hint:</span>
                <span>{health.hint}</span>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr,350px]">
        <div className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80">
              Active Sections
            </h2>
          </div>

          <div className="grid gap-4">
            {controls?.map((control: any) => (
              <Card
                key={control.section_key}
                className="relative overflow-hidden transition-all hover:shadow-md border-sidebar-border/50"
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6">
                  <div className="space-y-1.5">
                    <CardTitle className="text-lg capitalize">
                      {control.section_key.replace(/_/g, " ")}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">
                      Key: {control.section_key}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {control.is_enabled ? (
                        <>
                          <Eye className="h-3.5 w-3.5 text-success animate-pulse" />
                          <span className="text-success">Live</span>
                        </>
                      ) : (
                        <>
                          <EyeOff className="h-3.5 w-3.5 text-destructive" />
                          <span className="text-destructive">Hidden</span>
                        </>
                      )}
                    </div>
                    <Switch
                      checked={control.is_enabled}
                      disabled={
                        updateMutation.isPending &&
                        updateMutation.variables?.section_key === control.section_key
                      }
                      onCheckedChange={(checked) =>
                        updateMutation.mutate({
                          section_key: control.section_key,
                          is_enabled: checked,
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="min-h-11 min-w-11 text-destructive hover:bg-destructive/10"
                      aria-label="Delete section"
                      onClick={() => {
                        if (confirm(`Delete section "${control.section_key}"?`)) {
                          deleteMutation.mutate(control.section_key);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            ))}
            {controls?.length === 0 && (
              <div className="text-center py-12 border rounded-lg border-dashed">
                <p className="text-muted-foreground">No sections found. Add your first one!</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80">
              Audit History
            </h2>
          </div>

          <Card className="border-sidebar-border/50 bg-sidebar-accent/30 backdrop-blur-sm">
            <CardContent className="p-0">
              {isLoadingHistory ? (
                <div className="p-8 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : history && history.length > 0 ? (
                <div className="divide-y divide-sidebar-border/30">
                  {history.map((log: any) => (
                    <div
                      key={log.id}
                      className="p-4 space-y-3 hover:bg-sidebar-accent/50 transition-colors text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0">
                          <p className="font-medium truncate capitalize">
                            {log.section_key.replace("_", " ")}
                          </p>
                          <div className="flex items-center gap-2 text-[9px] text-muted-foreground font-medium uppercase tracking-tight">
                            {log.is_enabled ? (
                              <span className="flex items-center gap-1 text-success bg-success/10 px-1.5 py-0.5 rounded">
                                <Eye className="h-2.5 w-2.5" /> Enabled
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">
                                <EyeOff className="h-2.5 w-2.5" /> Disabled
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="min-h-11 min-w-11 rounded-full hover:bg-primary/10 hover:text-primary transition-all shrink-0"
                          aria-label="Revert to this state"
                          onClick={() => revertMutation.mutate(log.id)}
                          disabled={revertMutation.isPending}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-sidebar-border/10">
                        <div className="flex items-center gap-1.5">
                          <User className="h-2 w-2" />
                          <span>Admin</span>
                        </div>
                        <span className="tabular-nums">
                          {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center text-sm text-muted-foreground">
                  No changes recorded.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

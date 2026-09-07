import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { TableRowsSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  UserPlus,
  ShieldCheck,
  User as UserIcon,
  Copy,
  Crown,
  Ban,
  RotateCcw,
  ArrowRightLeft,
} from "lucide-react";
import { toast } from "sonner";
import {
  adminListUsers,
  adminSetRole,
  adminInviteUser,
  adminSetUserActive,
  adminTransferOwnership,
} from "@/lib/adminUsers.functions";

type Role = "admin" | "manager" | "staff" | "viewer";
type AnyRole = Role | "owner";
const DISPLAY_ROLES: { value: Role; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Full access — edits, deletes, role management." },
  {
    value: "manager",
    label: "Manager",
    description: "Approvals + full write access on operational data.",
  },
  {
    value: "staff",
    label: "Staff",
    description: "Log payments, comments, documents. Cannot edit or delete.",
  },
  { value: "viewer", label: "Viewer", description: "Read-only." },
];

export default function Users() {
  const { isAdmin, isOwner, isSuperAdmin, user: me } = useAuth();
  const qc = useQueryClient();

  const listFn = useServerFn(adminListUsers);
  const setRoleFn = useServerFn(adminSetRole);
  const inviteFn = useServerFn(adminInviteUser);
  const setActiveFn = useServerFn(adminSetUserActive);
  const transferFn = useServerFn(adminTransferOwnership);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    enabled: isAdmin,
    queryFn: () => listFn({}),
  });

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | AnyRole>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && (u.role ?? "viewer") !== roleFilter) return false;
      if (!q) return true;
      return (
        (u.email ?? "").toLowerCase().includes(q) || (u.full_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter]);

  const setRoleM = useMutation({
    mutationFn: (v: { user_id: string; role: Role }) => setRoleFn({ data: v }),
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update role"),
  });

  const setActiveM = useMutation({
    mutationFn: (v: { user_id: string; active: boolean }) => setActiveFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(v.active ? "User reactivated" : "User deactivated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const transferM = useMutation({
    mutationFn: (v: { new_owner_id: string }) => transferFn({ data: v }),
    onSuccess: () => {
      toast.success("Ownership transferred");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to transfer"),
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("staff");
  const [inviteResult, setInviteResult] = useState<{
    token: string;
    email_sent: boolean;
    email_error: string | null;
  } | null>(null);

  const inviteM = useMutation({
    mutationFn: () =>
      inviteFn({
        data: { email: inviteEmail, full_name: inviteName || undefined, role: inviteRole },
      }),
    onSuccess: (r) => {
      setInviteResult({ token: r.token!, email_sent: r.email_sent, email_error: r.email_error });
      if (r.email_sent) toast.success(`Invite emailed to ${inviteEmail}`);
      else
        toast.message("Invite created — copy the link below to share it", {
          description: r.email_error ?? "",
        });
      // Clear name/role so the form is ready for the next invite when the user
      // dismisses the success view. Email stays in state because the success
      // panel still references it; closeInvite() resets it on dismiss.
      setInviteName("");
      setInviteRole("staff");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Invite failed"),
  });

  const acceptUrl = inviteResult
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/accept-invite/${inviteResult.token}`
    : "";

  const closeInvite = () => {
    setInviteOpen(false);
    setInviteEmail("");
    setInviteName("");
    setInviteRole("staff");
    setInviteResult(null);
  };

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Users & Roles" description="Manage who can access this workspace" />
        <AdminRequiredMessage action="Managing user roles" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        description="Invite teammates and assign access. Permissions are enforced in the database."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1.5" /> Invite user
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <Input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          aria-label="Search users"
        />
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as any)}>
          <SelectTrigger className="w-[160px]" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
            {DISPLAY_ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          Showing {filtered.length} of {users.length}
        </span>
      </div>

      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="text-left font-medium px-4 py-2.5 border-b">Name</th>
              <th className="text-left font-medium px-4 py-2.5 border-b">Email</th>
              <th className="text-left font-medium px-4 py-2.5 border-b">Role</th>
              <th className="text-left font-medium px-4 py-2.5 border-b">Status</th>
              <th className="text-left font-medium px-4 py-2.5 border-b">Last active</th>
              <th className="text-right font-medium px-4 py-2.5 border-b">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableRowsSkeleton rows={5} columns={6} />
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-0">
                  <EmptyState
                    icon={UserIcon}
                    title="No teammates match"
                    description="Try adjusting your search or invite a new teammate."
                  />
                </td>
              </tr>
            ) : (
              filtered.map((u) => {
                const isTargetOwner = u.role === "owner";
                const isSelf = u.id === me?.id;
                const inactive = u.is_active === false;
                return (
                  <tr
                    key={u.id}
                    className={`border-t hover:bg-muted/30 ${inactive ? "opacity-60" : ""}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <UserIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{u.full_name || "—"}</span>
                        {isSelf && (
                          <Badge variant="outline" className="text-[10px]">
                            You
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.email ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {isTargetOwner ? (
                        <Badge className="bg-warning/10 text-warning border-warning/30 border">
                          <Crown className="h-3 w-3 mr-1" /> Owner
                        </Badge>
                      ) : u.role === "admin" ? (
                        <Badge className="bg-primary/10 text-primary border-primary/30 border">
                          <ShieldCheck className="h-3 w-3 mr-1" /> Admin
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="capitalize">
                          {u.role ?? "viewer"}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {inactive ? (
                        <Badge variant="destructive" className="text-[10px]">
                          Inactive
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          Active
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {u.last_sign_in_at
                        ? formatDistanceToNow(new Date(u.last_sign_in_at), { addSuffix: true })
                        : "Never"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        {!isTargetOwner && (
                          <Select
                            value={u.role ?? "viewer"}
                            onValueChange={(v) =>
                              setRoleM.mutate({ user_id: u.id, role: v as Role })
                            }
                            disabled={setRoleM.isPending || inactive}
                          >
                            <SelectTrigger
                              aria-label={`Change role for ${u.email}`}
                              className="h-8 w-[130px]"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(isSuperAdmin ? DISPLAY_ROLES : DISPLAY_ROLES.filter(r => r.value !== "admin")).map((r) => (
                                <SelectItem key={r.value} value={r.value}>
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}

                        {isOwner && !isTargetOwner && !isSelf && !inactive && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="outline" title="Transfer ownership">
                                <ArrowRightLeft className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Transfer ownership to {u.full_name || u.email}?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  They will become the company Owner. You will keep Admin access but
                                  lose owner-only actions (ownership transfer, company
                                  deactivation).
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => transferM.mutate({ new_owner_id: u.id })}
                                >
                                  Transfer ownership
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}

                        {!isTargetOwner &&
                          !isSelf &&
                          (inactive ? (
                            <Button
                              size="sm"
                              variant="outline"
                              title="Reactivate user"
                              onClick={() => setActiveM.mutate({ user_id: u.id, active: true })}
                              disabled={setActiveM.isPending}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="outline" title="Deactivate user">
                                  <Ban className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Deactivate {u.full_name || u.email}?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    They will keep their account but lose access to this workspace
                                    until you reactivate them.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() =>
                                      setActiveM.mutate({ user_id: u.id, active: false })
                                    }
                                  >
                                    Deactivate
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog
        open={inviteOpen}
        onOpenChange={(o) => {
          if (!o) closeInvite();
          else setInviteOpen(true);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>
              We'll email an invite and generate a copy-link you can share directly.
            </DialogDescription>
          </DialogHeader>

          {!inviteResult ? (
            <>
              <div className="space-y-3">
                <div>
                  <Label>Email</Label>
                  <Input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@example.com"
                    type="email"
                  />
                </div>
                <div>
                  <Label>Full name (optional)</Label>
                  <Input
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Adil Khan"
                  />
                </div>
                <div>
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                    <SelectTrigger aria-label="Invite role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(isSuperAdmin ? DISPLAY_ROLES : DISPLAY_ROLES.filter(r => r.value !== "admin")).map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          <div>
                            <div className="font-medium">{r.label}</div>
                            <div className="text-xs text-muted-foreground">{r.description}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={closeInvite}>
                  Cancel
                </Button>
                <Button
                  disabled={!inviteEmail || inviteM.isPending}
                  onClick={() => inviteM.mutate()}
                >
                  {inviteM.isPending ? "Creating…" : "Send invite"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <div
                  className={`rounded-md p-3 text-sm border ${inviteResult.email_sent ? "bg-success/5 border-success/30 text-success" : "bg-warning/5 border-warning/30 text-warning-foreground"}`}
                >
                  {inviteResult.email_sent
                    ? `Email invite sent to ${inviteEmail}.`
                    : `Email delivery not available (${inviteResult.email_error || "no mailer configured"}). Copy the link below and share it manually.`}
                </div>
                <div>
                  <Label>Invite link</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={acceptUrl} onFocus={(e) => e.currentTarget.select()} />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(acceptUrl);
                          toast.success("Link copied");
                        } catch {
                          toast.error("Copy failed — select the text manually");
                        }
                      }}
                    >
                      <Copy className="h-4 w-4 mr-1.5" /> Copy
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Link expires in 14 days.</p>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={closeInvite}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

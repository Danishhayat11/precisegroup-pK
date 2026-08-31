import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { MessageSquare, CheckCircle2, Trash2 } from "lucide-react";
import { BlockSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/EmptyState";
import { usePIIGuardedQuery } from "@/lib/access";
import { withCompany } from "@/lib/companyScope";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";

type Comment = {
  id: string;
  payment_receipt_no: string | null;
  booking_id: string | null;
  body: string;
  kind: "comment" | "edit_request";
  status: "open" | "resolved";
  created_by: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

type Target = { receipt_no?: string | null; booking_id?: string | null };

export function usePaymentCommentCount(receiptNo?: string | null) {
  return usePIIGuardedQuery({
    queryKey: ["payment-comments-count", receiptNo],
    enabled: !!receiptNo,
    queryFn: async () => {
      const { count } = await supabase
        .from("payment_comments" as any)
        .select("id", { count: "exact", head: true })
        .eq("payment_receipt_no", receiptNo!)
        .eq("status", "open");
      return count ?? 0;
    },
    staleTime: 30_000,
  });
}

export function PaymentCommentsPanel({
  open,
  onOpenChange,
  target,
  defaultKind = "comment",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: Target;
  defaultKind?: "comment" | "edit_request";
}) {
  const qc = useQueryClient();
  const { user, isAdmin, companyId } = useAuth();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"comment" | "edit_request">(defaultKind);

  const key = useMemo(
    () => ["payment-comments", target.receipt_no ?? "", target.booking_id ?? ""],
    [target.receipt_no, target.booking_id],
  );

  const { data: rows = [], isLoading } = usePIIGuardedQuery<Comment[]>({
    queryKey: key,
    enabled: open && (!!target.receipt_no || !!target.booking_id),
    queryFn: async () => {
      let q = supabase
        .from("payment_comments" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (target.receipt_no) q = q.eq("payment_receipt_no", target.receipt_no);
      else if (target.booking_id) q = q.eq("booking_id", target.booking_id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Comment[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["payment-comments-count"] });
  };

  const addM = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!companyId) throw new Error("No company context");
      const payload = {
        payment_receipt_no: target.receipt_no ?? null,
        booking_id: target.booking_id ?? null,
        body: body.trim(),
        kind,
        created_by: user.id,
      };
      const { error } = await supabase
        .from("payment_comments" as any)
        .insert(withCompany(payload, companyId) as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      toast.success(kind === "edit_request" ? "Edit request logged" : "Comment posted");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Could not save comment"),
  });

  const resolveM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("payment_comments" as any)
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id ?? null,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked resolved");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("payment_comments" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Comment deleted");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const label = target.receipt_no
    ? `Receipt ${target.receipt_no}`
    : target.booking_id
      ? `Booking ${target.booking_id}`
      : "Record";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        <SheetHeader className="p-5 border-b">
          <SheetTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Comments · {label}
          </SheetTitle>
          <SheetDescription>
            Leave a note or flag a correction. Staff can request edits; admins can act on them.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading ? (
            <BlockSkeleton lines={3} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              compact
              title="No comments yet"
              description="Leave a note or flag a correction — staff can request edits and admins can act on them."
            />
          ) : (
            rows.map((c) => (
              <div key={c.id} className="rounded-lg border p-3 space-y-2 bg-card">
                <div className="flex items-center gap-2 text-xs">
                  <Badge
                    variant={c.kind === "edit_request" ? "destructive" : "secondary"}
                    className="capitalize"
                  >
                    {c.kind === "edit_request" ? "Edit request" : "Comment"}
                  </Badge>
                  <Badge
                    variant={c.status === "open" ? "outline" : "default"}
                    className="capitalize"
                  >
                    {c.status}
                  </Badge>
                  <span className="text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                  </span>
                </div>
                <div className="text-sm whitespace-pre-wrap">{c.body}</div>
                <div className="flex items-center gap-2 pt-1">
                  {c.status === "open" && isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => resolveM.mutate(c.id)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Resolve
                    </Button>
                  )}
                  {isAdmin && (
                    <ConfirmDeleteDialog
                      trigger={
                        <Button
                          size="sm"
                          variant="ghost"
                          className="min-h-11 min-w-11 text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                        </Button>
                      }
                      title="Delete this comment?"
                      description="Are you sure? This cannot be undone."
                      confirmLabel="Delete comment"
                      onConfirm={() => deleteM.mutateAsync(c.id)}
                    />
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t p-4 space-y-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as any)}>
              <SelectTrigger className="h-8 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="comment">Comment</SelectItem>
                <SelectItem value="edit_request">Edit request</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {kind === "edit_request"
                ? "Admins will see this flagged for correction."
                : "General note visible to everyone."}
            </span>
          </div>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              kind === "edit_request"
                ? "Describe exactly what needs correcting — field, expected value, source doc."
                : "Add a comment…"
            }
            rows={3}
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!body.trim() || addM.isPending}
              onClick={() => addM.mutate()}
            >
              {addM.isPending
                ? "Posting…"
                : kind === "edit_request"
                  ? "Submit request"
                  : "Post comment"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

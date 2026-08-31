import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { fmtDate, fmtPKR } from "@/lib/format";
import { CheckCircle2, Clock, MessageSquare, Send, ShieldCheck } from "lucide-react";
import { callRpc } from "@/integrations/supabase/approvedRpc";

export const Route = createFileRoute("/client-note/$token")({
  head: () => ({
    meta: [
      { title: "Payment note · Precise Realtors" },
      {
        name: "description",
        content: "View your payment receipt summary and leave a note for our team.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ClientNotePage,
  notFoundComponent: () => (
    <div className="min-h-dvh grid place-items-center p-8 text-center">
      <div>
        <h1 className="font-semibold">Link not found</h1>
        <p className="text-muted-foreground mt-1">
          This note link is invalid or has been revoked. Please contact us for a new link.
        </p>
      </div>
    </div>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="min-h-dvh grid place-items-center p-8 text-center">
      <div>
        <h1 className="font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground mt-1">{error.message}</p>
        <Button className="mt-4" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  ),
});

function ClientNotePage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["client-note", token],
    queryFn: async () => {
      const { data, error } = await callRpc("client_get_payment_by_token" as any, {
        _token: token,
      });
      if (error) throw error;
      if (!data) throw notFound();
      return data as any;
    },
  });

  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await callRpc("client_add_note_by_token" as any, {
        _token: token,
        _client_name: name.trim(),
        _body: body.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Note submitted", { description: "Our team will review and get back to you." });
      setBody("");
      qc.invalidateQueries({ queryKey: ["client-note", token] });
    },
    onError: (e: any) => toast.error("Could not submit note", { description: e.message }),
  });

  const canSubmit =
    name.trim().length >= 2 &&
    name.trim().length <= 100 &&
    body.trim().length >= 3 &&
    body.trim().length <= 2000 &&
    !mutation.isPending;

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!data) return null;

  const notes: any[] = data.notes ?? [];
  const allocs: any[] = data.allocations ?? [];

  return (
    <div className="min-h-dvh bg-muted/30">
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-5">
        {/* Header */}
        <header className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Secure client link · Precise Realtors &amp; Builders
        </header>

        {/* Payment summary card */}
        <section className="rounded-lg border bg-background p-4 md:p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Payment receipt
              </div>
              <div className="text-lg font-semibold font-mono">{data.receipt_no}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Amount</div>
              <div className="text-2xl font-bold text-primary tabular-nums">
                PKR {fmtPKR(data.amount)}
              </div>
            </div>
          </div>
          <Separator className="my-3" />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Client" value={<span className="capitalize">{data.client_name}</span>} />
            <Field label="Unit" value={<span className="font-mono">{data.unit_no ?? "—"}</span>} />
            <Field label="Date" value={fmtDate(data.payment_date)} />
            <Field label="Mode" value={data.payment_mode ?? "—"} />
            <Field label="Head" value={data.payment_head ?? "—"} />
            <Field
              label="Reference"
              value={<span className="text-xs">{data.reference ?? "—"}</span>}
            />
          </div>

          {allocs.length > 0 && (
            <>
              <Separator className="my-3" />
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Breakdown
              </div>
              <ul className="space-y-1 text-sm">
                {allocs.map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      {a.head_label || a.particulars || "—"}
                      {a.due_date && (
                        <span className="text-muted-foreground text-xs">
                          {" "}
                          · Due {fmtDate(a.due_date)}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">PKR {fmtPKR(a.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Submit note */}
        <section className="rounded-lg border bg-background p-4 md:p-5 shadow-sm">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" /> Leave a note about this payment
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Report a discrepancy, request a correction, or add context. Our team reviews every note.
          </p>
          <div className="space-y-2 mt-3">
            <div>
              <Label htmlFor="cn-name" className="text-xs">
                Your name
              </Label>
              <Input
                id="cn-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                maxLength={100}
                autoComplete="name"
              />
            </div>
            <div>
              <Label htmlFor="cn-body" className="text-xs">
                Note
              </Label>
              <Textarea
                id="cn-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe your query…"
                rows={4}
                maxLength={2000}
              />
              <div className="text-[11px] text-muted-foreground text-right tabular-nums">
                {body.trim().length}/2000
              </div>
            </div>
            <Button className="w-full" disabled={!canSubmit} onClick={() => mutation.mutate()}>
              <Send className="h-4 w-4 mr-1.5" />
              {mutation.isPending ? "Submitting…" : "Submit note"}
            </Button>
          </div>
        </section>

        {/* Note history (client-visible only) */}
        <section className="rounded-lg border bg-background p-4 md:p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Your conversation</h2>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2">
              No notes yet. When you submit one above it will appear here, along with any resolution
              from our team.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={n.source === "client" ? "secondary" : "default"}
                        className="text-[10px]"
                      >
                        {n.source === "client" ? n.client_name || "You" : "Team reply"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          n.status === "resolved"
                            ? "border-emerald-300 text-emerald-700 text-[10px] gap-1"
                            : "border-amber-300 text-amber-700 text-[10px] gap-1"
                        }
                      >
                        {n.status === "resolved" ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <Clock className="h-3 w-3" />
                        )}
                        {n.status}
                      </Badge>
                    </div>
                    <span className="text-muted-foreground tabular-nums">
                      {fmtDate(n.created_at)}
                    </span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{n.body}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="text-center text-[11px] text-muted-foreground pt-2 pb-6">
          Do not share this link publicly. It grants view and note access to this payment only.
        </footer>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}

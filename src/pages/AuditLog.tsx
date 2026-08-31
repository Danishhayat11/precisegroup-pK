/* allow-raw-color-file: audit action tone map uses palette bg-amber/red/indigo pending status-token migration
 * Tracked debt: migrate to semantic status tokens (bg-success, bg-warning,
 * bg-destructive, bg-info) in follow-up. Guardrail (scripts/ci/no-hex-in-
 * marketing-shell.mjs) blocks NEW drift while this marker documents the
 * legacy status-color usage in-file. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fmtDate } from "@/lib/format";

type AuditRow = {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
};

const ACTION_TONE: Record<string, string> = {
  "payment.edit": "bg-amber-100 text-amber-900",
  "payment.edit+split": "bg-amber-100 text-amber-900",
  "payment.delete": "bg-red-100 text-red-900",
  "plan.restructure": "bg-indigo-100 text-indigo-900",
};

export default function AuditLog() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState<string>("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["audit"],
    queryFn: async (): Promise<AuditRow[]> => {
      const { data } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      return (data as AuditRow[]) ?? [];
    },
  });

  const actions = useMemo(() => Array.from(new Set(rows.map((r) => r.action))).sort(), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (action && r.action !== action) return false;
      if (!needle) return true;
      return (
        (r.actor_email ?? "").toLowerCase().includes(needle) ||
        (r.entity ?? "").toLowerCase().includes(needle) ||
        (r.entity_id ?? "").toLowerCase().includes(needle) ||
        r.action.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, action]);

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Every admin-resolved edit, split, restructure and delete — with who, when, and full before/after payload."
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Input
          placeholder="Search actor, entity, id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-72"
        />
        <select
          aria-label="Filter by action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {rows.length}
          {isFetching ? " · refreshing…" : ""}
        </span>
      </div>

      <div className="rounded-md border bg-card">
        <div className="grid grid-cols-[24px_180px_1fr_180px_1fr] px-3 py-2 text-xs font-medium text-muted-foreground border-b">
          <div />
          <div>When</div>
          <div>Actor</div>
          <div>Action</div>
          <div>Entity</div>
        </div>
        {filtered.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            No audit entries match the current filters.
          </div>
        ) : (
          filtered.map((r) => {
            const open = !!expanded[r.id];
            const tone = ACTION_TONE[r.action] ?? "bg-muted text-foreground";
            return (
              <div key={r.id} className="border-b last:border-b-0">
                <button
                  className="w-full text-left grid grid-cols-[24px_180px_1fr_180px_1fr] px-3 py-2 items-center hover:bg-muted/50"
                  onClick={() => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))}
                >
                  <div className="text-muted-foreground">
                    {open ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </div>
                  <div className="text-sm">{fmtDate(r.created_at)}</div>
                  <div className="text-sm truncate">{r.actor_email ?? "system"}</div>
                  <div>
                    <Badge variant="secondary" className={`font-mono text-[11px] ${tone}`}>
                      {r.action}
                    </Badge>
                  </div>
                  <div className="text-sm truncate">
                    {r.entity ?? ""}
                    {r.entity_id ? ` · ${r.entity_id}` : ""}
                  </div>
                </button>
                {open && (
                  <div className="px-3 pb-3 pt-1 grid gap-3 md:grid-cols-2 bg-muted/30">
                    <JsonBlock title="Before" data={r.before} />
                    <JsonBlock title="After" data={r.after} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function JsonBlock({ title, data }: { title: string; data: unknown }) {
  const text = data == null ? "—" : JSON.stringify(data, null, 2);
  const copy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  };
  return (
    <div className="rounded border bg-background">
      <div className="flex items-center justify-between px-2 py-1 border-b">
        <span className="text-xs font-medium">{title}</span>
        <Button size="sm" variant="ghost" onClick={copy} className="h-6 px-2 text-xs">
          Copy
        </Button>
      </div>
      <pre className="text-[11px] leading-snug p-2 max-h-72 overflow-auto whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}

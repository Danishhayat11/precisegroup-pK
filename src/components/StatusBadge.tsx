import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "muted" | "adjustment";

const tones: Record<Tone, string> = {
  success: "bg-success/12 text-success border border-success/25 backdrop-blur-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]",
  warning: "bg-warning/12 text-warning border border-warning/25 backdrop-blur-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]",
  danger: "bg-destructive/12 text-destructive border border-destructive/30 backdrop-blur-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]",
  info: "bg-primary/10 text-primary border border-primary/25 backdrop-blur-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]",
  muted: "bg-muted/80 text-muted-foreground border border-border/70 backdrop-blur-xs",
  adjustment: "bg-adjustment/12 text-adjustment border border-adjustment/25 backdrop-blur-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]",
};

export function StatusBadge({ label, tone = "muted" }: { label: string; tone?: Tone }) {
  return <span className={cn("badge-pill", tones[tone])}>{label}</span>;
}

export function statusTone(status?: string | null): Tone {
  const s = (status ?? "").toLowerCase();
  if (s.includes("paid") && !s.includes("partial")) return "success";
  if (s === "completed" || s === "booking done") return "success";
  if (s.includes("overdue") || s.includes("cancel") || s === "high" || s === "lost")
    return "danger";
  if (s.includes("partial") || s.includes("warning") || s === "medium" || s.includes("due soon"))
    return "warning";
  if (s === "active") return "info";
  if (s === "low" || s.includes("posted") || s === "available") return "success";
  if (s.includes("pending") || s.includes("new inquiry") || s === "upcoming") return "info";
  if (s.includes("site visit")) return "warning";
  if (s.includes("negotiation")) return "adjustment";
  if (s.includes("waived") || s.includes("adjust")) return "adjustment";
  if (s.includes("booked") || s.includes("sold")) return "info";
  return "muted";
}

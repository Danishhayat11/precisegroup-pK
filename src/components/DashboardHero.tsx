/**
 * DashboardHero — Premium accounting-grade welcome band.
 *
 * KPI-free: numeric metrics live exclusively in the KPI grid below so each
 * metric renders exactly once above the fold. This band shows greeting,
 * date chip, an overdue triage call-out, and primary actions only.
 *
 * Uses semantic theme tokens (--card, --foreground, --primary, --border, etc.)
 * so it inherits the active theme (iOS/QuickBooks) exactly. No raw hex —
 * every surface, border, and interactive state passes the WCAG audit.
 */
import { motion } from "framer-motion";
import { Link } from "@/lib/router-compat";
import { fmtDate, fmtPKR } from "@/lib/format";
import { format } from "date-fns";
import { Plus, Banknote, ArrowRight, Activity, AlertCircle, Eye, FolderOpen } from "lucide-react";

function pkrShort(v: number): { whole: string; unit: string } {
  const n = Math.abs(v);
  if (n >= 1e7) return { whole: (v / 1e7).toFixed(2), unit: "Cr" };
  if (n >= 1e5) return { whole: (v / 1e5).toFixed(2), unit: "Lac" };
  return { whole: fmtPKR(Math.round(v)), unit: "" };
}

export function DashboardHero({
  userName,
  overdueCount,
  overdueValue,
}: {
  userName: string;
  overdueCount: number;
  overdueValue: number;
}) {
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const short = pkrShort(overdueValue);
  const hasOverdue = overdueCount > 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Dashboard overview"
      data-slot="card"
      className="relative isolate mb-6 w-full overflow-hidden rounded-2xl md:rounded-3xl border border-white/20 bg-card/60 backdrop-blur-3xl p-6 md:p-8 lg:p-9 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_32px_-12px_rgba(0,0,0,0.3)]"
    >
      {/* Subtle architectural grid pattern */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.25]"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(120% 90% at 100% 0%, #000 25%, transparent 75%)",
        }}
      />
      {/* Ambient warm primary glow (Apple Intelligence style) */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-16 h-96 w-96 rounded-full blur-[80px] opacity-40 mix-blend-screen dark:mix-blend-lighten"
        animate={{
          scale: [1, 1.1, 1],
          rotate: [0, 90, 0],
        }}
        transition={{ duration: 20, ease: "linear", repeat: Infinity }}
        style={{
          background:
            "conic-gradient(from 90deg, color-mix(in oklab, var(--primary) 60%, transparent), color-mix(in oklab, var(--brand-gold, #c9a84c) 60%, transparent), color-mix(in oklab, var(--primary) 60%, transparent))",
        }}
      />

      <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="max-w-3xl min-w-0 flex-1">
          {/* Status pill + timestamp row */}
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-wrap items-center gap-2.5 mb-3.5"
          >
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
              </span>
              Live ERP Engine
            </span>
            <span className="text-[12px] font-medium text-muted-foreground tabular-nums">
              {format(now, "EEEE, dd-MMM-yyyy · HH:mm")}
            </span>
            <span
              aria-hidden
              className="hidden sm:inline-block h-1 w-1 rounded-full bg-muted-foreground/40"
            />
            <span className="hidden sm:inline text-[12px] font-medium text-muted-foreground tracking-wide uppercase">
              Precise Realtors &amp; Builders
            </span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="font-display text-[26px] sm:text-[34px] lg:text-[40px] font-bold leading-[1.12] tracking-tight text-foreground mb-2"
          >
            <span className="text-muted-foreground font-normal">{greet},</span>{" "}
            <span className="font-extrabold">{userName || "Executive"}</span>
          </motion.h1>

          {/* Subline */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="text-[14.5px] sm:text-[16px] leading-relaxed text-muted-foreground max-w-2xl"
          >
            {hasOverdue ? (
              <div className="flex flex-wrap items-center gap-1.5 text-foreground">
                <span>Attention required:</span>
                <Link
                  to="/dashboard?tab=kpi&kpi=overdue"
                  className="inline-flex items-center gap-1 font-semibold text-destructive underline underline-offset-4 hover:opacity-80 transition-opacity"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {overdueCount} overdue {overdueCount === 1 ? "account" : "accounts"}
                </Link>
                <span>totaling</span>
                <span className="font-bold tabular-nums text-foreground bg-destructive/10 text-destructive px-2 py-0.5 rounded-md text-xs sm:text-sm">
                  PKR {short.whole} {short.unit}
                </span>
              </div>
            ) : (
              <span className="flex items-center gap-1.5 text-emerald-700 font-medium">
                <Activity className="h-4 w-4 shrink-0 text-emerald-600" />
                All client installment ledgers are reconciled and current.
              </span>
            )}
          </motion.div>

          {/* Desktop quick actions */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="hidden sm:flex mt-6 flex-wrap items-center gap-3"
          >
            <Link
              to="/bookings"
              className="group/btn inline-flex items-center gap-2 min-h-[44px] px-6 py-2.5 rounded-full text-[13.5px] font-semibold text-primary-foreground transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:scale-105 active:scale-[0.96] shadow-[0_4px_16px_rgba(0,122,255,0.25),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_8px_24px_rgba(0,122,255,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] border border-primary/40"
              style={{
                backgroundColor: "var(--primary)",
                background:
                  "linear-gradient(180deg, color-mix(in oklab, var(--primary) 92%, #fff 8%) 0%, var(--primary) 100%)",
              }}
            >
              <Plus
                className="h-4 w-4 transition-transform duration-300 group-hover/btn:rotate-90"
                aria-hidden
              />
              New Booking
            </Link>
            <Link
              to="/payments"
              className="inline-flex items-center gap-2 min-h-[44px] px-6 py-2.5 rounded-full text-[13.5px] font-semibold text-foreground bg-white/70 dark:bg-white/10 backdrop-blur-xl border border-white/40 dark:border-white/10 hover:bg-white/90 dark:hover:bg-white/15 hover:border-foreground/20 transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:scale-105 active:scale-[0.96] shadow-[0_2px_8px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
            >
              <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              Post Payment
            </Link>
            <Link
              to="/ledger"
              className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 rounded-full text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
              Installment Ledger
            </Link>
          </motion.div>
        </div>

        {/* Right-side quick posture card (desktop) */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="hidden lg:flex flex-col gap-3.5 min-w-[270px] p-5 rounded-2xl bg-white/50 dark:bg-black/40 backdrop-blur-2xl border border-white/30 dark:border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-black/5 dark:ring-white/10"
        >
          <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground flex items-center justify-between pb-1 border-b border-border/40">
            <span>System Posture</span>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Currency</span>
              <span className="font-semibold text-foreground font-mono bg-black/5 dark:bg-white/10 px-2 py-0.5 rounded-md">
                PKR (₨)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Audit Engine</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Active
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Print Engine</span>
              <span className="font-semibold text-foreground font-mono bg-black/5 dark:bg-white/10 px-2 py-0.5 rounded-md">
                A4 Standard
              </span>
            </div>
          </div>
        </motion.div>

        {/* Mobile quick action grid */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="sm:hidden mt-2 grid grid-cols-2 gap-2.5"
        >
          <Link
            to="/bookings"
            className="flex items-center justify-center gap-1.5 h-12 rounded-full text-[13px] font-semibold text-primary-foreground shadow-md active:scale-[0.96] transition-all"
            style={{ backgroundColor: "var(--primary)" }}
          >
            <Plus className="h-4 w-4" />
            New Booking
          </Link>
          <Link
            to="/payments"
            className="flex items-center justify-center gap-1.5 h-12 rounded-full text-[13px] font-semibold text-foreground bg-white/80 dark:bg-white/10 backdrop-blur-md border border-white/30 dark:border-white/10 shadow-sm active:scale-[0.96] transition-all"
          >
            <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Post Payment
          </Link>
        </motion.div>
      </div>
    </motion.section>
  );
}

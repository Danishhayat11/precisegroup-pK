import { motion } from "framer-motion";
import {
  Building2,
  HardHat,
  Pickaxe,
  CheckCircle2,
  ShieldCheck,
  Cog,
  ArrowRight,
} from "lucide-react";
import { Link } from "@/lib/router-compat";

export function BuilderMetricsFeed() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative mb-6 rounded-2xl md:rounded-3xl border border-white/20 bg-black/5 dark:bg-white/5 backdrop-blur-2xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden"
    >
      {/* Luxury Gradient Wash */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(circle at 100% 0%, color-mix(in oklab, var(--primary) 30%, transparent), transparent 50%), radial-gradient(circle at 0% 100%, color-mix(in oklab, var(--brand-gold, #c9a84c) 20%, transparent), transparent 40%)",
        }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-primary/10 text-primary border border-primary/20">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
              Live Construction Feed
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-display font-extrabold tracking-tight text-foreground">
            Featured: Manal Heights
          </h2>
          <p className="text-[14px] text-muted-foreground font-medium mt-1">
            Luxury Apartments & Mall • CDA Sector B-17, Islamabad
          </p>
        </div>
        <Link
          to="/projects"
          className="group inline-flex items-center gap-2 text-[13px] font-semibold text-primary hover:text-primary/80 transition-colors"
        >
          View All Projects
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>

      <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="flex flex-col p-5 rounded-2xl bg-white/70 dark:bg-black/40 border border-white/40 dark:border-white/10 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 text-muted-foreground mb-3">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="text-[11px] font-bold uppercase tracking-wider">Tower A Progress</span>
          </div>
          <div className="text-3xl font-display font-extrabold text-foreground tracking-tight mb-1">
            85%
          </div>
          <p className="text-xs text-muted-foreground font-medium">Floor 12 framework complete</p>
          <div className="w-full bg-black/5 dark:bg-white/10 h-1.5 rounded-full mt-4 overflow-hidden">
            <div className="bg-primary h-full rounded-full" style={{ width: "85%" }} />
          </div>
        </div>

        {/* KPI 2 */}
        <div className="flex flex-col p-5 rounded-2xl bg-white/70 dark:bg-black/40 border border-white/40 dark:border-white/10 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 text-muted-foreground mb-3">
            <HardHat className="h-4 w-4 text-emerald-600" />
            <span className="text-[11px] font-bold uppercase tracking-wider">
              On-site Workforce
            </span>
          </div>
          <div className="text-3xl font-display font-extrabold text-foreground tracking-tight mb-1">
            145
          </div>
          <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Active across 3 shifts
          </p>
        </div>

        {/* KPI 3 */}
        <div className="flex flex-col p-5 rounded-2xl bg-white/70 dark:bg-black/40 border border-white/40 dark:border-white/10 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 text-muted-foreground mb-3">
            <Cog className="h-4 w-4 text-amber-500" />
            <span className="text-[11px] font-bold uppercase tracking-wider">Active Machinery</span>
          </div>
          <div className="text-3xl font-display font-extrabold text-foreground tracking-tight mb-1">
            12
          </div>
          <p className="text-xs text-muted-foreground font-medium">Heavy equipment deployed</p>
        </div>

        {/* KPI 4 */}
        <div className="flex flex-col p-5 rounded-2xl bg-white/70 dark:bg-black/40 border border-white/40 dark:border-white/10 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 text-muted-foreground mb-3">
            <ShieldCheck className="h-4 w-4 text-blue-500" />
            <span className="text-[11px] font-bold uppercase tracking-wider">Safety Incidents</span>
          </div>
          <div className="text-3xl font-display font-extrabold text-foreground tracking-tight mb-1">
            0
          </div>
          <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-blue-500" /> 180 days incident-free
          </p>
        </div>
      </div>
    </motion.section>
  );
}

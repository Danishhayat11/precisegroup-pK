/**
 * DashboardActiveProjectCard — prominent card shown on the Dashboard that
 * displays the currently active project and lets the user switch it. New
 * bookings, payments, and letters are attached to whichever project is
 * selected here. Mirrors the top-bar ActiveProjectSwitcher but is more
 * discoverable for users who work from the dashboard.
 */
import { FolderKanban, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "@/lib/router-compat";
import { useActiveProject } from "@/lib/activeProject";

export function DashboardActiveProjectCard() {
  const { projects, activeProject, activeCode, setActiveCode, loading } = useActiveProject();

  return (
    <div className="relative mb-6 rounded-2xl md:rounded-3xl border border-white/30 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-2xl p-4 md:p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-wrap items-center justify-between gap-4 transition-all duration-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-3.5 min-w-0">
        <div
          aria-hidden="true"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 shadow-sm"
        >
          <FolderKanban className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
              Scope / Active Project
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
              Primary Scope
            </span>
          </div>
          <div className="text-[16px] font-bold text-foreground truncate max-w-[240px] md:max-w-[440px]">
            {activeProject?.project_name ?? (loading ? "Loading project scope…" : "All Projects")}
          </div>
          <div className="text-[12px] text-muted-foreground truncate">
            New bookings, payments, and schedules map to{" "}
            <span className="font-semibold text-foreground">
              {activeProject?.project_code ?? "All Projects"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5 w-full sm:w-auto sm:ml-auto">
        <Select
          value={activeCode ?? undefined}
          onValueChange={(v) => setActiveCode(v)}
          disabled={loading || projects.length === 0}
        >
          <SelectTrigger
            className="h-11 min-w-[200px] flex-1 sm:flex-initial rounded-full bg-white/70 dark:bg-black/30 hover:bg-white dark:hover:bg-black/50 border-white/40 dark:border-white/10 font-medium text-[13.5px] transition-all shadow-sm focus:ring-4 focus:ring-primary/20"
            aria-label="Switch active project"
          >
            <SelectValue placeholder={loading ? "Loading…" : "Switch project"} />
          </SelectTrigger>
          <SelectContent className="rounded-2xl border-white/30 dark:border-white/10 bg-white/80 dark:bg-black/80 backdrop-blur-2xl shadow-2xl p-1.5">
            {projects.map((p) => (
              <SelectItem key={p.project_code} value={p.project_code} className="rounded-xl">
                <span className="flex items-center gap-2">
                  {p.project_code === activeCode && (
                    <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  )}
                  <span className="font-medium">{p.project_name}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    ({p.project_code})
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-11 px-5 rounded-full font-semibold text-[13px] border-white/40 dark:border-white/10 bg-white/50 dark:bg-white/5 backdrop-blur-md hover:bg-white/80 dark:hover:bg-white/15"
        >
          <Link to="/projects">Projects</Link>
        </Button>
      </div>
    </div>
  );
}

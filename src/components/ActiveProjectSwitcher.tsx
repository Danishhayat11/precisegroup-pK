/**
 * ActiveProjectSwitcher — top-bar dropdown that sets the app-wide active
 * project. New bookings/payments/letters default to this project's code +
 * name. Existing records are untouched.
 */
import { useMemo, useState } from "react";
import { Check, FolderKanban, Plus, Home, Trash2, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useActiveProject, type ProjectRow } from "@/lib/activeProject";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { NewUnitDialog } from "@/components/NewUnitDialog";
import { EditProjectDialog } from "@/components/EditProjectDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function ActiveProjectSwitcher() {
  const { projects, activeProject, activeCode, setActiveCode, loading } = useActiveProject();
  const [newOpen, setNewOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { companyId } = useAuth();

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.project_name.toLowerCase().includes(q) || p.project_code.toLowerCase().includes(q),
    );
  }, [projects, query]);

  const label = activeProject?.project_name ?? (loading ? "Loading…" : "No project");
  const code = activeProject?.project_code ?? "—";

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("project_code", toDelete.project_code)
      .eq("company_id", companyId!);
    setDeleting(false);
    if (error) {
      toast({
        title: "Couldn't delete project",
        description:
          error.message.includes("foreign key") || error.code === "23503"
            ? "This project still has bookings, units, or payments attached. Remove or reassign them first."
            : error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Project deleted",
      description: `${toDelete.project_name} (${toDelete.project_code}) was removed.`,
    });
    setToDelete(null);
    await qc.invalidateQueries({ queryKey: ["active-project", "projects"] });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="rounded-full pl-2.5 pr-3 min-h-[46px] min-w-[46px] lg:h-10 lg:min-h-10 lg:min-w-10 gap-2 max-w-[220px] shrink-0"
          aria-label={`Active project: ${label}. Change active project.`}
          title={`Active project: ${label}`}
        >
          <span
            aria-hidden="true"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/40 text-[10px] font-semibold tracking-wide text-muted-foreground"
          >
            {code.slice(0, 2)}
          </span>
          <span className="hidden lg:flex min-w-0 flex-col leading-tight text-left">
            <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              Project
            </span>
            <span className="truncate text-sm font-medium">{label}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span>Active project</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div
          className="px-2 pb-1.5 pt-1"
          onKeyDown={(e) => {
            // Prevent dropdown's typeahead/close behaviors while typing.
            e.stopPropagation();
          }}
        >
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            {/* allow-small-tap: compact search input inside dropdown menu; menu opens via 46px trigger */}
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or code…"
              aria-label="Search projects by name or code"
              autoFocus
              className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        {projects.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-muted-foreground">
            {loading ? "Loading projects…" : "No projects yet."}
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-muted-foreground">
            No projects match “{query}”.
          </div>
        ) : (
          filteredProjects.map((p) => {
            const selected = p.project_code === activeCode;
            return (
              <DropdownMenuItem
                key={p.project_code}
                onSelect={() => setActiveCode(p.project_code)}
                className="gap-2 pr-1"
                aria-label={`${p.project_name}${selected ? ". Selected." : ""}`}
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/30 text-[10px] font-semibold text-muted-foreground"
                  aria-hidden="true"
                >
                  {p.project_code.slice(0, 2)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-sm font-medium">{p.project_name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    Code {p.project_code}
                  </span>
                </span>
                {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setToDelete(p);
                  }}
                  className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                  aria-label={`Delete project ${p.project_name}`}
                  title={`Delete ${p.project_name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            // Prevent the menu from closing before the dialog trigger mounts,
            // then open the New Project dialog on the next tick.
            e.preventDefault();
            setTimeout(() => setNewOpen(true), 0);
          }}
          className="gap-2 text-primary focus:text-primary"
          aria-label="Add a new project"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm font-medium">Add new project</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setTimeout(() => setUnitOpen(true), 0);
          }}
          className="gap-2"
          aria-label="Add a new unit to the active project"
          disabled={!activeProject}
        >
          <Home className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm font-medium">
            Add unit{activeProject ? ` to ${activeProject.project_code}` : ""}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            // Keep the dropdown from closing before the dialog mounts.
            e.preventDefault();
            if (!activeCode) return;
            setTimeout(() => setEditCode(activeCode), 0);
          }}
          className="gap-2"
          aria-label={
            activeProject ? `Edit project ${activeProject.project_name}` : "Edit active project"
          }
          disabled={!activeProject}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm font-medium">
            Edit{activeProject ? ` ${activeProject.project_code}` : " project"}
          </span>
        </DropdownMenuItem>
        <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
          The selected project scopes every page — bookings, payments, units, ledger, clients.
        </div>
      </DropdownMenuContent>
      {/* Controlled dialogs — triggered from the menu items above. */}
      <NewProjectDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        trigger={<span className="hidden" aria-hidden="true" />}
      />
      <NewUnitDialog
        open={unitOpen}
        onOpenChange={setUnitOpen}
        trigger={<span className="hidden" aria-hidden="true" />}
      />
      <EditProjectDialog
        projectCode={editCode}
        open={editCode !== null}
        onOpenChange={(open) => {
          if (!open) setEditCode(null);
        }}
      />

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete ? (
                <>
                  <span className="font-medium text-foreground">{toDelete.project_name}</span> (code{" "}
                  <span className="font-mono">{toDelete.project_code}</span>) will be removed from
                  the project list. Bookings, payments, units, and ledger entries that still
                  reference it will block the delete — reassign or remove them first. This action
                  can't be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DropdownMenu>
  );
}

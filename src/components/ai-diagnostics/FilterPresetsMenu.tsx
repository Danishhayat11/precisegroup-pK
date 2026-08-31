import { useEffect, useState } from "react";
import { Bookmark, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  loadPresets,
  savePresets,
  normaliseState,
  statesEqual,
  type FilterPreset,
  type PresetFilterState,
} from "@/pages/aiDiagnosticsPresets";

interface Props {
  currentState: PresetFilterState;
  onApply: (state: PresetFilterState) => void;
}

/**
 * Toolbar dropdown that lets the user save the current filter state under a
 * name and instantly re-apply saved presets. Presets are stored in
 * localStorage (see `aiDiagnosticsPresets.ts`); this component owns only
 * transient UI state — the apply/reset semantics live in the parent so the
 * URL remains the single source of truth.
 */
export function FilterPresetsMenu({ currentState, onApply }: Props) {
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  const persist = (next: FilterPreset[]) => {
    setPresets(next);
    savePresets(next);
  };

  const normalisedCurrent = normaliseState(currentState);
  const hasCurrent = Object.keys(normalisedCurrent).length > 0;

  const handleSave = () => {
    const suggested = presets.find((p) => statesEqual(p.state, currentState))?.name ?? "";
    const name = window.prompt(
      "Name this preset (current search, filters, sort, and page size will be saved):",
      suggested,
    );
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const state = normalisedCurrent;
    const existing = presets.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      const ok = window.confirm(`Overwrite existing preset "${existing.name}"?`);
      if (!ok) return;
      persist(presets.map((p) => (p.id === existing.id ? { ...p, state } : p)));
      toast.success(`Preset "${trimmed}" updated.`);
    } else {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      persist([...presets, { id, name: trimmed, state }]);
      toast.success(`Preset "${trimmed}" saved.`);
    }
    setOpen(false);
  };

  const handleApply = (preset: FilterPreset) => {
    onApply(preset.state);
    toast.success(`Preset "${preset.name}" applied.`);
    setOpen(false);
  };

  const handleDelete = (preset: FilterPreset) => {
    const ok = window.confirm(`Delete preset "${preset.name}"?`);
    if (!ok) return;
    persist(presets.filter((p) => p.id !== preset.id));
    toast.success(`Preset "${preset.name}" deleted.`);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-9"
          aria-label={`Filter presets (${presets.length} saved)`}
          title="Save & switch filter presets"
        >
          <Bookmark className="h-4 w-4" aria-hidden />
          <span className="ml-1">Presets</span>
          {presets.length > 0 && (
            <span className="ml-1 rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
              {presets.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Filter presets</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            handleSave();
          }}
          disabled={!hasCurrent}
        >
          {hasCurrent ? "Save current filters…" : "No filters to save"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {presets.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            No saved presets yet. Configure filters, then choose “Save current filters…”.
          </div>
        ) : (
          presets.map((preset) => {
            const isActive = statesEqual(preset.state, currentState);
            return (
              <div key={preset.id} className="flex items-center gap-1 px-1">
                <button
                  type="button"
                  onClick={() => handleApply(preset)}
                  className="flex flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:outline-none min-h-9"
                  aria-label={`Apply preset ${preset.name}${isActive ? " (currently active)" : ""}`}
                >
                  <Check
                    className={`h-4 w-4 ${isActive ? "opacity-100" : "opacity-0"}`}
                    aria-hidden
                  />
                  <span className="truncate">{preset.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(preset)}
                  className="rounded-sm p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-9 min-w-9"
                  aria-label={`Delete preset ${preset.name}`}
                  title={`Delete "${preset.name}"`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useState } from "react";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ALL_EXPORT_COLUMNS,
  ALL_EXPORT_COLUMN_KEYS,
  REQUIRED_EXPORT_COLUMN_KEYS,
  saveSelectedColumnKeys,
  type ExportColumnKey,
} from "@/pages/aiDiagnosticsExportColumns";

interface Props {
  selected: readonly ExportColumnKey[];
  onChange: (next: ExportColumnKey[]) => void;
}

/**
 * Popover that lets the user pick which columns appear in the CSV & JSON
 * exports. Required columns (Timestamp, Request ID) render as disabled
 * checkboxes so a stray click can't ship an export with no way to
 * correlate rows back to the live view.
 */
export function ExportColumnsMenu({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(selected);
  const requiredSet = new Set(REQUIRED_EXPORT_COLUMN_KEYS);
  const optionalCount = ALL_EXPORT_COLUMNS.filter((c) => !c.alwaysInclude).length;
  const optionalSelectedCount = ALL_EXPORT_COLUMNS.filter(
    (c) => !c.alwaysInclude && selectedSet.has(c.key),
  ).length;

  const commit = (next: ExportColumnKey[]) => {
    // Always canonical order — makes the toggle idempotent and the CSV column
    // order predictable regardless of click sequence.
    const ordered = ALL_EXPORT_COLUMN_KEYS.filter((k) =>
      new Set([...next, ...REQUIRED_EXPORT_COLUMN_KEYS]).has(k),
    );
    onChange(ordered);
    saveSelectedColumnKeys(ordered);
  };

  const toggle = (key: ExportColumnKey) => {
    if (requiredSet.has(key)) return;
    const next = selectedSet.has(key) ? selected.filter((k) => k !== key) : [...selected, key];
    commit(next);
  };

  const selectAll = () => {
    commit([...ALL_EXPORT_COLUMN_KEYS]);
    toast.success("All export columns selected.");
  };
  const clearAll = () => {
    commit([...REQUIRED_EXPORT_COLUMN_KEYS]);
    toast.success("Cleared optional export columns.");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 min-w-11"
          aria-label={`Export columns (${optionalSelectedCount + REQUIRED_EXPORT_COLUMN_KEYS.length} of ${ALL_EXPORT_COLUMN_KEYS.length} selected)`}
          title="Choose which columns to include in CSV & JSON exports"
        >
          <Columns3 className="h-4 w-4" />
          <span className="ml-2 hidden sm:inline">Columns</span>
          <span className="ml-1 rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
            {optionalSelectedCount + REQUIRED_EXPORT_COLUMN_KEYS.length}/
            {ALL_EXPORT_COLUMN_KEYS.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Export columns</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={selectAll}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              disabled={optionalSelectedCount === optionalCount}
            >
              All
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              disabled={optionalSelectedCount === 0}
            >
              None
            </button>
          </div>
        </div>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Applied to every CSV and JSON export. Timestamp and Request ID are always included so rows
          can be correlated back to the live view.
        </p>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {ALL_EXPORT_COLUMNS.map((c) => {
            const required = !!c.alwaysInclude;
            const checked = selectedSet.has(c.key) || required;
            const id = `export-col-${c.key}`;
            return (
              <div
                key={c.key}
                className="flex items-center gap-2 rounded px-1 py-1 hover:bg-accent/50"
              >
                {/* allow-small-tap: checkbox sits inside a full-row 44px hit target (label + row padding); native checkbox glyph must stay 16px to match the surrounding text */}
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  disabled={required}
                  onChange={() => toggle(c.key)}
                  className="h-4 w-4 accent-primary"
                  aria-describedby={required ? `${id}-req` : undefined}
                />
                <Label
                  htmlFor={id}
                  className={`flex-1 text-sm ${required ? "text-muted-foreground" : "cursor-pointer"}`}
                >
                  {c.label}
                </Label>
                {required && (
                  <span
                    id={`${id}-req`}
                    className="text-[10px] uppercase tracking-wide text-muted-foreground"
                  >
                    required
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * CsvExportMetadataPreview
 *
 * Small info-icon popover meant to sit next to a "Download CSV" button.
 * It renders the EXACT metadata header (`# key: value` lines) that
 * `buildCsvMetadataHeader` will write into the top of the downloaded file,
 * so users can inspect the reproducible filters / sort / pagination /
 * columns / counts before they click download.
 *
 * The `input` prop can be either:
 *  - a `CsvMetadataInput` value (evaluated once when the popover opens), or
 *  - a `() => CsvMetadataInput` factory (re-evaluated each time the popover
 *    opens, so live filter state is always current).
 */
import { useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buildCsvMetadataHeader, type CsvMetadataInput } from "@/lib/csvExportMetadata";

type Input = CsvMetadataInput | (() => CsvMetadataInput);

interface Props {
  /** The metadata that WILL be written into the CSV header. */
  input: Input;
  /** Optional short label to describe what "this export" refers to. */
  label?: string;
  /** Optional aria-label / tooltip override for the trigger. */
  triggerTitle?: string;
  className?: string;
}

export function CsvExportMetadataPreview({
  input,
  label,
  triggerTitle = "Preview the metadata that will be written into the CSV file",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  // Resolve the input lazily so filter/sort state is always fresh when opened.
  const resolved: CsvMetadataInput | null = open
    ? typeof input === "function"
      ? (input as () => CsvMetadataInput)()
      : input
    : null;
  const lines = resolved ? buildCsvMetadataHeader(resolved) : [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8 min-h-11 min-w-11 text-muted-foreground hover:text-foreground",
            className,
          )}
          title={triggerTitle}
          aria-label={triggerTitle}
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-0">
        <div className="border-b px-3 py-2">
          <div className="text-sm font-medium">CSV metadata preview</div>
          <div className="text-xs text-muted-foreground">
            {label
              ? `These lines will be written at the top of ${label}.`
              : "These lines will be written at the top of the downloaded file."}
          </div>
        </div>
        <div className="max-h-72 overflow-auto p-3">
          {lines.length === 0 ? (
            <div className="text-xs text-muted-foreground">No metadata to preview.</div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {lines.join("\n")}
            </pre>
          )}
        </div>
        {resolved && (
          <div className="border-t px-3 py-2 text-[11px] text-muted-foreground space-y-0.5">
            <div>
              <span className="font-medium text-foreground">Filters:</span>{" "}
              {countMeaningful(resolved.filters)} active
            </div>
            <div>
              <span className="font-medium text-foreground">Sort:</span>{" "}
              {resolved.sort?.key ? `${resolved.sort.key} ${resolved.sort.dir}` : "unsorted"}
            </div>
            {resolved.columns && resolved.columns.length > 0 && (
              <div>
                <span className="font-medium text-foreground">Columns:</span>{" "}
                {resolved.columns.length} in order
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function countMeaningful(filters: CsvMetadataInput["filters"] | undefined): number {
  if (!filters) return 0;
  let n = 0;
  for (const v of Object.values(filters)) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim().toLowerCase();
    if (s === "" || s === "all" || s === "any" || s === "null" || s === "undefined") continue;
    n++;
  }
  return n;
}

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";

/**
 * Accessible, keyboard-operable sortable column header.
 *
 * - Rendered as a `role="columnheader"` div carrying the current
 *   `aria-sort` value ("ascending" / "descending" / "none") so screen
 *   readers announce sort state as focus enters the header.
 * - The inner `<button>` is a native HTML button, so it is in the tab
 *   order and Enter / Space toggle the sort via the browser's default
 *   activation behavior — no custom keyDown handler needed.
 * - `aria-label` includes the current direction and what activation
 *   will do next, so AT users know both state AND the next step.
 * - Sighted users see a directional arrow when the column is active
 *   and a two-way chevron when idle, so every column is obviously
 *   sortable.
 */
export function SortableColumnHeader({
  columnKey,
  label,
  active,
  sortDir,
  defaultDir,
  onToggle,
  className = "",
}: {
  columnKey: string;
  label: string;
  active: boolean;
  sortDir: SortDir;
  defaultDir: SortDir;
  onToggle: (nextDir: SortDir) => void;
  className?: string;
}) {
  const nextDir: SortDir = active ? (sortDir === "asc" ? "desc" : "asc") : defaultDir;
  const ariaSort: "ascending" | "descending" | "none" = active
    ? sortDir === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <div role="columnheader" aria-sort={ariaSort} data-column-key={columnKey} className={className}>
      <button
        type="button"
        onClick={() => onToggle(nextDir)}
        className={`inline-flex w-full items-center gap-1 min-h-9 px-1 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded ${
          active ? "text-foreground" : ""
        }`}
        aria-label={`Sort by ${label}${
          active
            ? `, currently sorted ${sortDir === "asc" ? "ascending" : "descending"}; activate to sort ${sortDir === "asc" ? "descending" : "ascending"}`
            : `, not sorted; activate to sort ${defaultDir === "asc" ? "ascending" : "descending"}`
        }`}
      >
        <span>{label}</span>
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3 text-foreground" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3 text-foreground" aria-hidden />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />
        )}
        <span className="sr-only">
          {active ? `, sorted ${sortDir === "asc" ? "ascending" : "descending"}` : ", not sorted"}
        </span>
      </button>
    </div>
  );
}

import { ReactNode, useState, useMemo, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, type Variants } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Inbox,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { TableRowsSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/EmptyState";
import { durations, easeSignature } from "@/lib/motion";

const rowParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } },
};
const rowChild: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: durations.slow, ease: easeSignature },
  },
};

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  /** Provide to make the column sortable when `sortable` is enabled. */
  sortValue?: (row: T) => string | number;
}

type SortState = { key: string; dir: "asc" | "desc" } | null;

/**
 * When `serverMode` is provided, the DataTable stops filtering, sorting, and
 * paginating locally and instead renders whatever `rows` the parent gives it.
 * The parent owns the network query and drives search / sort / page state so
 * the same UX works against very large tables via Supabase `range()` + count.
 */
export type ServerModeProps = {
  totalCount: number;
  page: number;
  onPageChange: (page: number) => void;
  search: string;
  onSearchChange: (value: string) => void;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
};

export function DataTable<T extends { [k: string]: any }>({
  rows,
  columns,
  searchKeys,
  empty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  rowKey,
  rowHref,
  loading,
  animateRows,
  toolbar,
  sortable,
  initialSort,
  pageSize,
  onVisibleRowsChange,
  serverMode,
  searchPlaceholder,
}: {
  rows: T[];
  columns: Column<T>[];
  searchKeys?: (keyof T)[];
  empty?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Primary CTA rendered inside the empty state (only when no filter is active). */
  emptyAction?: ReactNode;
  rowKey: (r: T) => string;
  rowHref?: (r: T) => string;
  loading?: boolean;
  /** Opt-in: fade+slide rows into view with a small stagger. */
  animateRows?: boolean;
  /** Extra filter controls rendered next to the search box. */
  toolbar?: ReactNode;
  /** Enable clickable header sort for columns that expose `sortValue`. */
  sortable?: boolean;
  /** Initial sort applied when `sortable` is true. */
  initialSort?: SortState;
  /** Enable pagination; hides pager when rows fit on one page. */
  pageSize?: number;
  /**
   * Fires with the current search+filter+sort result set (all pages) and
   * the visible page slice. Used for exports or external counters. In
   * server mode, `all` mirrors the current page since the client only holds
   * that page in memory.
   */
  onVisibleRowsChange?: (info: { all: T[]; page: T[] }) => void;
  /** Enable server-driven search/sort/pagination. */
  serverMode?: ServerModeProps;
  /** Placeholder shown in the search input; describe searchable fields. */
  searchPlaceholder?: string;
}) {
  const isServer = !!serverMode;
  const navigate = useNavigate();
  const [qLocal, setQLocal] = useState("");
  const [sortLocal, setSortLocal] = useState<SortState>(initialSort ?? null);
  const [pageLocal, setPageLocal] = useState(1);

  const q = isServer ? serverMode!.search : qLocal;
  const setQ = isServer ? serverMode!.onSearchChange : setQLocal;
  const sort = isServer ? serverMode!.sort : sortLocal;
  const setSort = isServer ? serverMode!.onSortChange : setSortLocal;
  const page = isServer ? serverMode!.page : pageLocal;
  const setPage = isServer ? serverMode!.onPageChange : setPageLocal;

  const filtered = useMemo(() => {
    if (!q) return rows;
    const lq = q.toLowerCase();
    return rows.filter((r) =>
      (searchKeys ?? Object.keys(r)).some((k) =>
        String(r[k as string] ?? "")
          .toLowerCase()
          .includes(lq),
      ),
    );
  }, [rows, q, searchKeys]);

  const sorted = useMemo(() => {
    if (!sortable || !sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [filtered, sort, sortable, columns]);

  // Reset to first page when filters/sort/rows shrink (client-mode only —
  // the parent owns page state in server mode).
  useEffect(() => {
    if (!isServer) setPageLocal(1);
  }, [isServer, qLocal, sortLocal, rows]);

  // In server mode the parent already sliced/sorted/filtered — trust the
  // rows it handed us and derive page counts from the reported total.
  const totalCount = isServer ? serverMode!.totalCount : sorted.length;
  const totalPages = pageSize ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;
  const currentPage = Math.min(page, totalPages);
  const paged = isServer
    ? rows
    : pageSize
      ? sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)
      : sorted;

  useEffect(() => {
    onVisibleRowsChange?.({ all: isServer ? rows : sorted, page: paged });
  }, [isServer, rows, sorted, paged, onVisibleRowsChange]);

  const toggleSort = (key: string) => {
    const next: SortState =
      !sort || sort.key !== key
        ? { key, dir: "asc" }
        : sort.dir === "asc"
          ? { key, dir: "desc" }
          : null;
    setSort(next);
  };

  return (
    <div className="card-elevated overflow-hidden">
      <div className="p-3 border-b flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder ?? "Search…"}
            aria-label={searchPlaceholder ?? "Search"}
            className="pl-9 h-9 bg-muted/50 border-transparent"
          />
        </div>
        {toolbar}
        <div className="text-xs text-muted-foreground ml-auto">
          {pageSize && sorted.length > 0
            ? `${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, sorted.length)} of ${sorted.length}`
            : `${sorted.length} of ${rows.length}`}
        </div>
      </div>
      <div className="overflow-x-auto max-h-[68vh]">
        <table className="w-full text-sm table-sticky">
          <thead className="text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => {
                const canSort = sortable && !!c.sortValue;
                const active = sort?.key === c.key;
                const Icon = !active ? ChevronsUpDown : sort!.dir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={c.key}
                    className={`px-4 py-2.5 font-medium border-b text-${c.align ?? "left"} ${c.className ?? ""} ${canSort ? "cursor-pointer select-none" : ""}`}
                    onClick={canSort ? () => toggleSort(c.key) : undefined}
                    aria-sort={!active ? "none" : sort!.dir === "asc" ? "ascending" : "descending"}
                  >
                    <span
                      className={`inline-flex items-center gap-1 ${canSort ? "hover:text-foreground" : ""}`}
                    >
                      {c.header}
                      {canSort && (
                        <Icon
                          className={`h-3 w-3 ${active ? "text-foreground" : "opacity-50"}`}
                          aria-hidden="true"
                        />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          {(() => {
            const Tbody = animateRows ? motion.tbody : "tbody";
            const Tr = animateRows ? motion.tr : "tr";
            const tbodyProps = animateRows
              ? {
                  key: `rows-${q}-${currentPage}-${paged.length}`,
                  initial: "hidden" as const,
                  animate: "show" as const,
                  variants: rowParent,
                }
              : {};
            return (
              <Tbody {...(tbodyProps as any)}>
                {loading ? (
                  <TableRowsSkeleton rows={5} columns={columns.length} />
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="p-0">
                      {empty ?? (
                        <EmptyState
                          icon={Inbox}
                          title={emptyTitle ?? (q ? "No matches" : "No records yet")}
                          description={
                            emptyDescription ??
                            (q
                              ? "Try a different search term or clear the filter."
                              : "Records will appear here once they are added.")
                          }
                          action={!q ? emptyAction : undefined}
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  paged.map((r) => (
                    <Tr
                      key={rowKey(r)}
                      {...(animateRows ? { variants: rowChild } : {})}
                      className={`border-t hover:bg-muted/30 transition-colors ${rowHref ? "cursor-pointer" : ""}`}
                      onClick={
                        rowHref
                          ? () => {
                              navigate({ to: rowHref(r) });
                            }
                          : undefined
                      }
                    >
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={`px-4 py-2.5 text-${c.align ?? "left"} ${c.className ?? ""}`}
                        >
                          {c.cell(r)}
                        </td>
                      ))}
                    </Tr>
                  ))
                )}
              </Tbody>
            );
          })()}
        </table>
      </div>

      {pageSize && sorted.length > pageSize && (
        <div className="flex items-center justify-between gap-2 p-3 border-t text-xs">
          <span className="text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 min-h-11 min-w-11"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 min-h-11 min-w-11"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

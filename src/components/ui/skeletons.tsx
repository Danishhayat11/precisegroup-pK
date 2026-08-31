import { Fragment } from "react";
import { Skeleton } from "./skeleton";
import { cn } from "@/lib/utils";

/**
 * Skeleton rows meant to be dropped inside an existing <tbody>.
 * Renders `rows` <tr>s with `columns` shimmering cells.
 */
export function TableRowsSkeleton({
  rows = 5,
  columns,
  className,
}: {
  rows?: number;
  columns: number;
  className?: string;
}) {
  return (
    <Fragment>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={`sk-${r}`} className={cn("border-t", className)} aria-hidden="true">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton
                className={cn(
                  "h-3.5",
                  c === 0 ? "w-24" : c === columns - 1 ? "w-16" : "w-full max-w-[220px]",
                )}
              />
            </td>
          ))}
        </tr>
      ))}
      <tr className="sr-only">
        <td colSpan={columns}>Loading rows…</td>
      </tr>
    </Fragment>
  );
}

/** Vertical stack of card skeletons — used for feed / request lists. */
export function ListSkeleton({ items = 4, className }: { items?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading list"
      className={cn("space-y-2", className)}
    >
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-24 rounded-full" />
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="ml-auto h-3 w-20" />
          </div>
          <Skeleton className="mt-3 h-3.5 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Compact block skeleton for sheets / side panels. */
export function BlockSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={cn("space-y-3", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border/60 bg-card/60 p-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-1.5 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** KPI tile skeleton — matches the Bento card footprint on the dashboard. */
export function KpiCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm",
        "flex flex-col gap-3",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-xl" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

/** Chart / large panel skeleton. */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <div className="mt-6 flex h-56 items-end gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1 rounded-md"
            style={{ height: `${30 + ((i * 37) % 60)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Table skeleton — sticky header row + N shimmering rows. */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card/60 overflow-hidden backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-3 px-4 py-3.5">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className={cn("h-3.5 flex-1", c === 0 && "max-w-[28%]")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Mobile-shaped dashboard skeleton (hidden on md+). Matches the real
 *  mobile layout: hero band, 2×2 quick actions, 2-col KPI grid, stacked
 *  overdue cards. Keeps shimmering blocks aligned with real content so
 *  the layout doesn't shift when data arrives. */
function DashboardMobileSkeleton() {
  return (
    <div className="md:hidden space-y-4">
      {/* Hero band */}
      <div className="rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur-sm space-y-3">
        <Skeleton className="h-3 w-32 rounded-full" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-11/12" />
        {/* 2×2 quick actions */}
        <div className="grid grid-cols-2 gap-2 pt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      </div>

      {/* 2-col KPI grid */}
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-border/60 bg-card/70 p-3 backdrop-blur-sm space-y-2"
          >
            <Skeleton className="h-2.5 w-16 rounded-full" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-1 w-full rounded-full" />
            <Skeleton className="h-2.5 w-3/4" />
          </div>
        ))}
      </div>

      {/* Overdue card stack */}
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border/60 bg-card/70 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-12 rounded-full" />
            </div>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-5 w-28" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-9 flex-1 rounded-md" />
              <Skeleton className="h-9 w-9 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Whole-dashboard skeleton composition. Mobile gets a bespoke shape,
 *  ≥ md renders the original desktop skeleton. */
export function DashboardSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading dashboard"
      className="p-4 md:p-6 animate-fade-in"
    >
      <DashboardMobileSkeleton />

      {/* Desktop skeleton (hidden on mobile) */}
      <div className="hidden md:block space-y-6">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-56 rounded-xl" />
          <Skeleton className="h-9 w-40 rounded-xl" />
          <Skeleton className="h-9 w-40 rounded-xl" />
          <div className="ml-auto flex gap-2">
            <Skeleton className="h-9 w-24 rounded-xl" />
            <Skeleton className="h-9 w-24 rounded-xl" />
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <KpiCardSkeleton key={i} />
          ))}
        </div>

        {/* Chart + side panel */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ChartSkeleton className="lg:col-span-2" />
          <div className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm">
            <Skeleton className="h-4 w-32" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Overdue table */}
        <TableSkeleton rows={6} columns={6} />
      </div>

      <span className="sr-only">Loading dashboard content…</span>
    </div>
  );
}

/** Dialog body skeleton — header block, detail grid, table. */
export function DialogSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-4 animate-fade-in">
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
      <TableSkeleton rows={4} columns={4} />
    </div>
  );
}

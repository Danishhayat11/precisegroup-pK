import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Accounting-style table (QuickBooks / Xero inspired).
 * - Condensed vertical padding, precise 1px gridlines
 * - Monochrome body text, uppercase semi-bold header
 * - Horizontal scroll on overflow, sticky header opt-in via `stickyHeader`
 */

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { stickyHeader?: boolean }
>(({ className, stickyHeader, ...props }, ref) => (
  <div
    className={cn(
      "relative w-full overflow-x-auto rounded-2xl border border-border/50 bg-white/40 dark:bg-black/40 backdrop-blur-3xl shadow-sm",
      stickyHeader && "max-h-[70vh] overflow-y-auto",
    )}
  >
    <table
      ref={ref}
      data-sticky-header={stickyHeader ? "true" : undefined}
      className={cn(
        "w-full caption-bottom border-collapse text-[13px] leading-5 text-foreground",
        className,
      )}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      "bg-background/80 backdrop-blur-xl [&_tr]:border-b [&_tr]:border-border",
      "[table[data-sticky-header=true]_&]:sticky [table[data-sticky-header=true]_&]:top-0 [table[data-sticky-header=true]_&]:z-10",
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t border-border bg-muted/60 font-semibold text-foreground [&>tr]:last:border-b-0",
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border/30 transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/10 data-[state=selected]:bg-primary/10 data-[state=selected]:font-medium",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-9 px-4 text-left align-middle whitespace-nowrap",
      "text-[12px] font-semibold tracking-wider text-muted-foreground",
      "border-r border-border/30 last:border-r-0",
      "[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-4 py-2.5 align-middle text-[13.5px] text-foreground",
      "border-r border-border/30 last:border-r-0",
      "[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      "tabular-nums",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };

import { NavLink } from "@/lib/router-compat";
import { Home, FolderClosed, DollarSign, BarChart3, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Fixed bottom tab bar shown only on screens < md (768px).
 *
 * Five slots, icons only (no labels), matching the mobile responsiveness
 * spec: Home / Bookings / Payments / Reports / Menu. The Menu tab opens
 * the existing slide-in Sheet (owned by AppShell) so users can reach the
 * full nav tree without needing a duplicate drawer.
 *
 * Kept INSIDE the AppShell's `[data-theme="ios"]` wrapper so the shell's
 * global `:focus-visible` outline rule reaches each tab. The shell's
 * root `overflow-hidden` is scoped to `md:` and above (see AppShell)
 * so the 3px focus outline paints without ancestor clip on mobile.
 *
 * Chrome:
 *   - solid white background (`#ffffff`) with a 1px `#E5E5EA` top hairline
 *   - safe-area padding via `env(safe-area-inset-bottom)` for iPhone notch
 *   - each tap target is ≥ 44×44 (Apple HIG)
 *
 * z-index sits above route content (40) but below modals/dialogs (50).
 */
export function MobileBottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <nav
      aria-label="Primary mobile navigation"
      data-mobile-bottom-nav
      className="fixed inset-x-0 bottom-0 z-40 md:hidden flex items-stretch justify-around bg-card/85 backdrop-blur-2xl border-t border-border/50 shadow-[0_-4px_24px_-8px_rgba(0,0,0,0.15)]"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <TabLink to="/dashboard" label="Dashboard" icon={Home} />
      <TabLink to="/bookings" label="Bookings" icon={FolderClosed} />
      <TabLink to="/payments" label="Payments" icon={DollarSign} />
      <TabLink to="/reports" label="Reports" icon={BarChart3} />
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open navigation menu"
        data-mobile-menu-tab
        className={cn(
          "flex-1 min-h-[56px] min-w-[44px] flex items-center justify-center",
          "text-[color:var(--muted-foreground)] active:text-[color:var(--primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-inset",
        )}
      >
        <Menu className="h-6 w-6" aria-hidden="true" strokeWidth={1.75} />
      </button>
    </nav>
  );
}

/**
 * Router-compat NavLink here does NOT accept a function `className`
 * (source-tagger stringifies function-valued JSX props into the DOM),
 * but it DOES accept function `children` receiving `{ isActive }`. So
 * we split active/inactive styles into two string props and drive
 * icon weight from the render-prop children.
 */
const TAB_BASE =
  "flex-1 min-h-[56px] min-w-[44px] flex items-center justify-center " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-inset";

function TabLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      activeClassName={cn(TAB_BASE, "text-[color:var(--primary)]")}
      inactiveClassName={cn(
        TAB_BASE,
        "text-[color:var(--muted-foreground)] active:text-[color:var(--primary)]",
      )}
    >
      {({ isActive }: { isActive: boolean }) => (
        <Icon className="h-6 w-6" aria-hidden={true} strokeWidth={isActive ? 2.25 : 1.75} />
      )}
    </NavLink>
  );
}

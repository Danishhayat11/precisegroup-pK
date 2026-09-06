/* allow-raw-color-file: overlays white text/borders on dark hero photography; theme-agnostic by design */
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NavLink, Outlet, useNavigate, useLocation } from "@/lib/router-compat";
import {
  LayoutDashboard,
  Briefcase,
  Receipt,
  BookOpen,
  Repeat2,
  FilePlus2,
  BarChart3,
  Settings,
  LogOut,
  Bell,
  Menu,
  Sparkles,
  HeartPulse,
  ShieldCheck,
  GitCompare,
  MessageSquare,
  Bug,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  FileText,
  Wallet,
  Search,
  HardHat,
  Wrench,
  Users as UsersIcon,
  CalendarCheck,
  Banknote,
  DoorOpen,
  KanbanSquare,
  ClipboardCheck,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { canAccessPath, featureForPath, planAtLeast } from "@/lib/plans";
import { PlanBadge, UpgradeScreen } from "@/components/UpgradeGate";
import { logRedirectReason } from "@/lib/redirectLog";

import { Button } from "@/components/ui/button";
import {
  GlobalSearch,
  GlobalSearchTrigger,
  useGlobalSearchHotkey,
} from "@/components/GlobalSearch";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useSwipeToClose } from "@/lib/useSwipeToClose";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { OverdueAlertBar } from "@/components/OverdueAlertBar";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ActiveProjectSwitcher } from "@/components/ActiveProjectSwitcher";
import { ActiveProjectProvider, useActiveProject } from "@/lib/activeProject";
import { SsrSpikeWatcher } from "@/components/SsrSpikeWatcher";
import { ShieldAlert, Loader2 } from "lucide-react";
import { PageTransition, RouteProgress } from "@/components/motion";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { MobileFab } from "@/components/MobileFab";

import { motion } from "framer-motion";
import { easeExpressive, durations } from "@/lib/motion";

const navStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } },
};
const navItemVariants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { duration: durations.base, ease: easeExpressive } },
};

/**
 * Sidebar nav — original flat ordering, ERP-native labels.
 */
type NavItem = { to: string; label: string; icon: any; desc: string };
type NavGroup = { id: string; title?: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    id: "main",
    items: [
      {
        to: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        desc: "KPIs and today's activity at a glance",
      },
      {
        to: "/bookings",
        label: "Bookings",
        icon: Briefcase,
        desc: "Manage unit bookings and buyers",
      },
      {
        to: "/payments",
        label: "Payments",
        icon: Receipt,
        desc: "Record and review payment receipts",
      },
      {
        to: "/ledger",
        label: "Installment Ledger",
        icon: BookOpen,
        desc: "Per-booking installment schedules & balances",
      },
      {
        to: "/print-ledger",
        label: "Print Ledger",
        icon: Printer,
        desc: "Print-ready Debit / Credit / Balance statements per client",
      },
      {
        to: "/adjustments",
        label: "Adjustments",
        icon: Repeat2,
        desc: "Transfers, discounts and corrections",
      },
      {
        to: "/office-expenses",
        label: "Office Expenses",
        icon: Wallet,
        desc: "Rent, utilities, supplies and operating costs",
      },
      {
        to: "/maintenance",
        label: "Maintenance",
        icon: Wrench,
        desc: "Recurring maintenance charges, receipts and building expenses",
      },
      {
        to: "/construction",
        label: "Construction",
        icon: HardHat,
        desc: "Per-project construction budgets, costs and payments",
      },
      {
        to: "/inspections",
        label: "Inspections",
        icon: ClipboardCheck,
        desc: "Site inspections and quality control",
      },
      {
        to: "/crm",
        label: "Leads & CRM",
        icon: KanbanSquare,
        desc: "Sales pipeline, follow-ups and lead conversions",
      },

      {
        to: "/documents",
        label: "Documents",
        icon: FilePlus2,
        desc: "Contracts, receipts and attachments",
      },
      {
        to: "/reports",
        label: "Reports",
        icon: BarChart3,
        desc: "Financial and operational reports",
      },
      {
        to: "/health",
        label: "Data Health",
        icon: HeartPulse,
        desc: "Detect and resolve data integrity issues",
      },
      {
        to: "/reconciliation-diff",
        label: "Reconciliation Diff",
        icon: GitCompare,
        desc: "Compare ledger vs. bank reconciliation",
      },
      {
        to: "/debugger",
        label: "Code Debugger",
        icon: Bug,
        desc: "Inspect runtime errors and traces",
      },
      {
        to: "/pricing",
        label: "Pricing",
        icon: Sparkles,
        desc: "Plans and billing for your workspace",
      },
      {
        to: "/settings",
        label: "Settings",
        icon: Settings,
        desc: "Workspace preferences and account",
      },
    ],
  },
  {
    id: "hr",
    title: "HR & Payroll",
    items: [
      {
        to: "/hr/employees",
        label: "Employees",
        icon: UsersIcon,
        desc: "Employee master list and profiles",
      },
      {
        to: "/hr/attendance",
        label: "Attendance",
        icon: CalendarCheck,
        desc: "Daily attendance and leave records",
      },
      {
        to: "/hr/payroll",
        label: "Payroll",
        icon: Banknote,
        desc: "Monthly salary runs and payslips",
      },
      {
        to: "/hr/final-settlement",
        label: "Final Settlement",
        icon: DoorOpen,
        desc: "Full & final settlements for leavers",
      },
    ],
  },
];

// Flat list retained for any legacy code that filtered `nav` by route.
const nav: NavItem[] = navGroups.flatMap((g) => g.items);
void nav;

const navIconClass = "h-[18px] w-[18px] shrink-0 opacity-90 group-[.is-active]:opacity-100";
const collapseHiddenClass = "group-data-[collapsed=true]/sb:hidden";

function navItemClass(isActive: boolean) {
  return cn(
    // Apple macOS Finder sidebar style:
    // Rounded rect, completely translucent, no left-border.
    "group relative flex items-center gap-3 rounded-xl pl-3 pr-3 py-2 text-[13.5px] font-medium transition-all duration-200",
    "min-h-[40px]",
    "group-data-[collapsed=true]/sb:justify-center group-data-[collapsed=true]/sb:px-2 group-data-[collapsed=true]/sb:gap-0",
    isActive
      ? "is-active bg-primary/15 text-primary font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
      : "text-sidebar-foreground/80 hover:bg-black/5 dark:hover:bg-white/10 hover:text-sidebar-foreground",
  );
}

function SidebarBody({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const { isAdmin, plan, companyName } = useAuth();
  const { activeProject } = useActiveProject();
  const activeProjectLabel = activeProject?.project_name ?? "All projects";
  const { data: healthCount } = useQuery({
    queryKey: ["data-health-issue-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("data_health_issues" as any)
        .select("booking_id", { count: "exact", head: true })
        .not("issues", "eq", "{}");
      if (error) return 0;
      return count ?? 0;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: crmFollowUpCount } = useQuery({
    queryKey: ["crm-followup-count"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { count, error } = await supabase
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .lte("follow_up_date", today)
        .not("follow_up_date", "is", null)
        .not("stage", "in", '("Booking Done","Lost")');
      if (error) return 0;
      return count ?? 0;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      <div
        data-collapsed={collapsed ? "true" : "false"}
        className="group/sb relative flex h-full flex-col text-sidebar-foreground overflow-hidden"
        style={{
          // True iPadOS / macOS glassmorphism
          background: "var(--sidebar)",
          backdropFilter: "blur(20px)",
          borderRight: "1px solid color-mix(in oklab, var(--sidebar-border) 40%, transparent)",
        }}
      >
        {/* Ambient primary glow — top-left */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-24 -left-16 h-56 w-56 rounded-full blur-3xl opacity-20"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--sidebar-primary) 30%, transparent) 0%, transparent 70%)",
          }}
        />
        <div className="relative px-3 py-3 border-b border-sidebar-border group-data-[collapsed=false]/sb:px-5 group-data-[collapsed=false]/sb:py-4">
          <div
            className="flex items-center gap-1.5 mb-3 group-data-[collapsed=true]/sb:justify-center group-data-[collapsed=true]/sb:mb-2"
            aria-hidden="true"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.15)]" />
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full bg-[#febc2e] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.15)]",
                collapseHiddenClass,
              )}
            />
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full bg-[#28c840] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.15)]",
                collapseHiddenClass,
              )}
            />
          </div>
          <div className="flex items-center gap-3 group-data-[collapsed=true]/sb:justify-center">
            <div
              className="sidebar-logo-mark relative h-11 w-11 rounded-[13px] grid place-items-center shrink-0 overflow-hidden"
              style={{
                // Solid deep primary base with only a hint of gold at the tail so
                // the white "P" always sits on a dark, saturated field (WCAG AAA
                // for large text on both iOS light and dark sidebars).
                background:
                  "linear-gradient(145deg, color-mix(in oklab, var(--sidebar-primary) 78%, #000 22%) 0%, var(--sidebar-primary) 55%, color-mix(in oklab, var(--sidebar-primary) 70%, var(--brand-gold, #d4af37) 30%) 100%)",
                backgroundColor: "var(--sidebar-primary)",
                boxShadow: [
                  "0 0 0 1px color-mix(in oklab, #fff 22%, transparent) inset",
                  "0 1.5px 0 0 color-mix(in oklab, #fff 32%, transparent) inset",
                  "0 -1px 0 0 color-mix(in oklab, #000 40%, transparent) inset",
                  // Outer definition ring — dark on white sidebar so the tile
                  // reads as a distinct shape rather than blending into the chrome.
                  "0 0 0 1px color-mix(in oklab, var(--sidebar-primary) 60%, #000 40%)",
                  "0 0 0 3px color-mix(in oklab, var(--sidebar) 100%, transparent)",
                  "0 12px 28px -8px color-mix(in oklab, var(--sidebar-primary) 70%, transparent)",
                  "0 4px 10px -4px color-mix(in oklab, var(--brand-gold, #d4af37) 30%, transparent)",
                ].join(", "),
              }}
              aria-hidden
            >
              <span
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(120% 80% at 22% 0%, color-mix(in oklab, #fff 32%, transparent) 0%, transparent 55%)",
                }}
              />
              <span
                className="absolute inset-y-0 -left-1 w-2/3 pointer-events-none opacity-60"
                style={{
                  background:
                    "linear-gradient(108deg, transparent 42%, color-mix(in oklab, #fff 22%, transparent) 50%, transparent 58%)",
                }}
              />
              <span
                className="relative font-display font-black text-[20px] leading-none tracking-tight"
                style={{
                  color: "#fff",
                  textShadow:
                    "0 1px 2px color-mix(in oklab, #000 70%, transparent), 0 0 1px color-mix(in oklab, #000 80%, transparent)",
                }}
              >
                P
              </span>
            </div>

            <div className={cn("leading-tight min-w-0", collapseHiddenClass)}>
              <div
                className="text-[14px] font-semibold truncate font-display tracking-[-0.015em]"
                style={{
                  // Darken slightly toward ink in light theme (bg is near-white)
                  // and toward white in dark theme (bg is near-black). Using
                  // `--foreground` — which the theme already inverts per mode —
                  // guarantees max contrast against `--sidebar` in both themes.
                  color: "var(--foreground)",
                }}
              >
                Precise Realtors <span className="opacity-60 font-normal">&amp;</span> Builders
              </div>
              <div
                className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.16em] uppercase"
                title={activeProjectLabel}
                aria-live="polite"
                style={{
                  // Deepen the gold with a touch of ink so it stays readable on
                  // the near-white iOS sidebar (light) while still glowing on
                  // Deepen the gold with ~45% ink so it hits ≥4.5:1 on the
                  // near-white iOS sidebar while staying warm in dark shells.
                  color:
                    "color-mix(in oklab, var(--brand-gold, var(--sidebar-primary)) 55%, var(--foreground) 45%)",
                }}
              >
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: "currentColor", boxShadow: "0 0 6px currentColor" }}
                />
                <span className="truncate">{activeProjectLabel}</span>
              </div>
            </div>
          </div>
        </div>
        <motion.nav
          aria-label="Main navigation"
          className="flex-1 overflow-y-auto px-2 py-3 space-y-1"
          variants={navStagger}
          initial="hidden"
          animate="show"
        >
          {navGroups.map((group, groupIdx) => {
            const items = group.items.filter((it) => {
              if (!isAdmin && it.to === "/health") return false;
              // Plan-based gating: hide items the current plan can't reach.
              // While plan is still loading we default to visible so links
              // don't flicker in and out on first paint.
              if (plan && !canAccessPath(plan, it.to)) return false;
              return true;
            });
            if (items.length === 0) return null;
            return (
              <div key={group.id} className={cn(groupIdx > 0 && "mt-5")}>
                {group.title && (
                  <motion.div
                    variants={navItemVariants}
                    className={cn(
                      "mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/50",
                      collapseHiddenClass,
                    )}
                  >
                    {group.title}
                  </motion.div>
                )}
                <div className="space-y-1">
                  {items.map((it) => (
                    <motion.div key={it.to} variants={navItemVariants}>
                      <NavTip label={it.label} desc={it.desc} collapsed={collapsed}>
                        <NavLink
                          to={it.to}
                          end={it.to === "/"}
                          onClick={onNavigate}
                          activeClassName={navItemClass(true)}
                          inactiveClassName={navItemClass(false)}
                        >
                          {it.to === "/health" ? (
                            <>
                              {(healthCount ?? 0) > 0 ? (
                                <HeartPulse className={navIconClass} strokeWidth={1.5} />
                              ) : (
                                <ShieldCheck className={navIconClass} strokeWidth={1.5} />
                              )}
                              <span className={cn("truncate", collapseHiddenClass)}>
                                {it.label}
                              </span>
                              {(healthCount ?? 0) > 0 && (
                                <span
                                  className={cn(
                                    "ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold tabular-nums",
                                    collapseHiddenClass,
                                  )}
                                >
                                  {healthCount}
                                </span>
                              )}
                            </>
                          ) : it.to === "/crm" ? (
                            <>
                              <it.icon className={navIconClass} strokeWidth={1.5} />
                              <span className={cn("truncate", collapseHiddenClass)}>
                                {it.label}
                              </span>
                              {(crmFollowUpCount ?? 0) > 0 && (
                                <span
                                  className={cn(
                                    "ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold tabular-nums",
                                    collapseHiddenClass,
                                  )}
                                  aria-label={`${crmFollowUpCount} follow-ups due today or overdue`}
                                >
                                  {crmFollowUpCount}
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              <it.icon className={navIconClass} strokeWidth={1.5} />
                              <span className={cn("truncate", collapseHiddenClass)}>
                                {it.label}
                              </span>
                            </>
                          )}
                        </NavLink>
                      </NavTip>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="mt-5">
            <motion.div
              variants={navItemVariants}
              className={cn(
                "mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/50",
                collapseHiddenClass,
              )}
            >
              Workspace
            </motion.div>
            <motion.div variants={navItemVariants}>
              <NavTip
                label="My Requests"
                desc="Track your submitted change requests"
                collapsed={collapsed}
              >
                <NavLink
                  to="/my-requests"
                  onClick={onNavigate}
                  activeClassName={navItemClass(true)}
                  inactiveClassName={navItemClass(false)}
                >
                  <MessageSquare className={navIconClass} strokeWidth={1.5} />
                  <span className={cn("truncate", collapseHiddenClass)}>My Requests</span>
                </NavLink>
              </NavTip>
            </motion.div>
          </div>

          {isAdmin && planAtLeast(plan, "builder") && (
            <>
              <motion.div
                variants={navItemVariants}
                className={cn(
                  "mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50",
                  collapseHiddenClass,
                )}
              >
                Admin
              </motion.div>
              <motion.div variants={navItemVariants}>
                <NavTip
                  label="Admin Controls"
                  desc="Roles, users and system settings"
                  collapsed={collapsed}
                >
                  <NavLink
                    to="/admin"
                    end
                    onClick={onNavigate}
                    activeClassName={navItemClass(true)}
                    inactiveClassName={navItemClass(false)}
                  >
                    <ShieldCheck className={navIconClass} strokeWidth={1.5} />
                    <span className={cn("truncate", collapseHiddenClass)}>Admin Controls</span>
                  </NavLink>
                </NavTip>
              </motion.div>
              <motion.div variants={navItemVariants}>
                <NavTip
                  label="SSR Monitor"
                  desc="Server rendering health & alerts"
                  collapsed={collapsed}
                >
                  <NavLink
                    to="/admin/ssr-monitor"
                    onClick={onNavigate}
                    activeClassName={navItemClass(true)}
                    inactiveClassName={navItemClass(false)}
                  >
                    <ShieldAlert className={navIconClass} strokeWidth={1.5} />
                    <span className={cn("truncate", collapseHiddenClass)}>SSR Monitor</span>
                  </NavLink>
                </NavTip>
              </motion.div>
            </>
          )}
        </motion.nav>
        <div
          className={cn(
            "px-4 py-3 border-t border-sidebar-border text-[11px] text-sidebar-foreground/60 space-y-1.5",
            collapseHiddenClass,
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium text-sidebar-foreground/80">
              {companyName ?? "Workspace"}
            </span>
            <PlanBadge plan={plan} />
          </div>
          <div className="text-[10px] text-sidebar-foreground/50">v1.0 · Precise ERP</div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function NavTip({
  label,
  desc,
  collapsed,
  children,
}: {
  label: string;
  desc: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={12} className="max-w-[220px]">
        {collapsed && <div className="font-semibold text-[12px] mb-0.5">{label}</div>}
        <div className="text-[11px] leading-snug opacity-90">{desc}</div>
      </TooltipContent>
    </Tooltip>
  );
}

function AppShellInner() {
  const { user, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Sidebar collapse: persisted; defaults to collapsed on tablet (< lg).
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem("sidebar:collapsed");
    if (saved != null) return saved === "true";
    return window.matchMedia("(max-width: 1023.98px)").matches;
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("sidebar:collapsed", String(collapsed));
    }
  }, [collapsed]);
  useGlobalSearchHotkey(() => setSearchOpen(true));

  return (
    // data-theme="ios" scopes the iOS/Apple design-system token overrides
    // in src/styles.css (`[data-theme="ios"] { ... }` block) to the
    // authenticated dashboard/admin shell only. The public /site marketing
    // pages keep the existing Manrope/Sora + Navy/Gold luxury theme.
    <div
      data-theme="ios"
      className="flex h-dvh w-full bg-background md:overflow-hidden [background-image:var(--gradient-canvas)]"
    >
      {/* NOTE: `overflow-hidden` is applied from `md` upward only. On
          mobile (< md) we keep overflow visible so the iOS 3px focus
          outline (+2px offset, + halo in dark) on fixed chrome — the
          MobileBottomNav tabs and MobileFab — paints outside their
          border-box without being clipped by this root flex container. */}

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:inline-flex focus:min-h-[44px] focus:min-w-[44px] focus:items-center focus:justify-center focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Skip to main content
      </a>
      <RouteProgress />
      {/* Desktop / tablet sidebar — collapses to icon rail on tablet or on toggle */}
      <aside
        aria-label="Primary sidebar"
        className={cn(
          "hidden md:flex shrink-0 p-3 pr-0",
          "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className="w-full h-full rounded-2xl overflow-hidden ring-1 ring-black/[0.06] shadow-[0_20px_60px_-30px_hsl(222_40%_15%/0.25)] bg-card/70 backdrop-blur-3xl">
          <SidebarBody collapsed={collapsed} />
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <OverdueAlertBar />

        {/* Topbar — deep forest-ink chrome (see `[data-theme="ios"]
            header.sticky` in src/styles.css). We keep this element free of
            inline `background` so the shell-scoped CSS wins; here we only
            layer the top-highlight, ambient lift, and warm halos that make
            the chrome feel premium on top of the QB green + brand-gold
            palette. */}
        <motion.header
          data-appshell-topbar
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: durations.base, ease: easeExpressive }}
          className={cn(
            // Taller header on desktop for better vertical rhythm against
            // 44px controls and the search pill; mobile stays at 56px so
            // it doesn't eat scroll real-estate.
            "relative h-14 lg:h-16 px-3 md:px-5 lg:px-6",
            "flex items-center gap-1.5 md:gap-2 lg:gap-3",
            "sticky top-0 z-20 backdrop-blur-xl border-b border-border/70",
          )}
          style={{
            boxShadow:
              "0 1px 2px 0 color-mix(in oklab, var(--foreground) 3%, transparent), 0 4px 16px -4px color-mix(in oklab, var(--foreground) 5%, transparent)",
          }}
        >
          {/* Mobile drawer — slide-in from the left edge (the trigger lives
              in the fixed bottom tab bar's Menu slot). We keep the controlled
              Sheet here so its state (mobileOpen) stays owned by the shell. */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent
              side="left"
              className="p-0 w-[86vw] max-w-[320px] h-dvh bg-sidebar border-r border-sidebar-border rounded-r-2xl shadow-2xl md:hidden"
              style={{
                paddingTop: "env(safe-area-inset-top, 0px)",
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
              }}
              {...useSwipeToClose({ onClose: () => setMobileOpen(false), direction: "left" })}
            >
              <VisuallyHidden asChild>
                <SheetTitle>Main navigation</SheetTitle>
              </VisuallyHidden>
              <SidebarBody onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          {/* Desktop / tablet collapse toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex rounded-full min-h-[44px] min-w-[44px] transition-transform duration-200 hover:scale-105 motion-reduce:transform-none"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            )}
          </Button>

          {/* Breadcrumbs get a hard max-width so they can't starve the
              centered search pill on medium widths, and hide below md
              where the mobile bottom nav already conveys location. */}
          <Breadcrumbs className="hidden md:flex mr-1 min-w-0 flex-1 xl:flex-none xl:max-w-[320px] shrink" />
          {/* Full search pill is reserved for xl+ (≥1280px) where the
              breadcrumbs, kbd chips, and project switcher can all breathe.
              Below xl the icon-only trigger takes over — same target, same
              hotkey, no fighting for horizontal space. */}
          <GlobalSearchTrigger onClick={() => setSearchOpen(true)} className="hidden xl:flex" />
          <Button
            variant="ghost"
            size="icon"
            className="xl:hidden rounded-full min-h-[44px] min-w-[44px] shrink-0 transition-transform duration-200 hover:scale-105 active:scale-95 motion-reduce:transform-none ml-auto md:ml-0"
            aria-label="Open global search (⌘K)"
            title="Search (⌘K)"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </Button>
          <ActiveProjectSwitcher />

          <ThemeToggle />
          <NotificationsBell />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="rounded-full pl-1 pr-3 min-h-[44px] gap-2"
                aria-label="Open account menu"
              >
                <div
                  className="h-8 w-8 rounded-full grid place-items-center text-primary-foreground text-[11px] font-bold tracking-tight"
                  style={{
                    background:
                      "linear-gradient(140deg, color-mix(in oklab, var(--primary) 92%, #fff 8%) 0%, color-mix(in oklab, var(--primary) 70%, var(--brand-gold, var(--primary))) 100%)",
                    boxShadow: [
                      "0 0 0 1px color-mix(in oklab, #fff 20%, transparent) inset",
                      "0 1px 0 0 color-mix(in oklab, #fff 30%, transparent) inset",
                      "0 0 0 2px color-mix(in oklab, var(--background) 100%, transparent)",
                      "0 0 0 3px color-mix(in oklab, var(--primary) 25%, transparent)",
                      "0 4px 10px -4px color-mix(in oklab, var(--primary) 45%, transparent)",
                    ].join(", "),
                  }}
                  aria-hidden="true"
                >
                  {(user?.email ?? "U").slice(0, 1).toUpperCase()}
                </div>
                <span className="hidden lg:inline text-sm font-medium">
                  {user?.email?.split("@")[0]}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="text-sm font-medium">{user?.email}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {roles[0] ?? "viewer"} access
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/settings")}>Settings</DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  logRedirectReason("signed_out_redirect_to_login", {
                    from: typeof window !== "undefined" ? window.location.pathname : null,
                    to: "/login",
                  });
                  await signOut();
                  navigate("/login");
                }}
              >
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </motion.header>

        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto focus:outline-none">
          {/* Mobile bottom padding = tab bar (56px) + FAB clearance so the
              last row of content is never obscured by the fixed chrome. */}
          <div
            className="p-4 md:p-8 max-w-[1600px] mx-auto"
            style={{ paddingBottom: "max(1rem, calc(96px + env(safe-area-inset-bottom, 0px)))" }}
          >
            <PageTransition>
              <ApprovalGate>
                <OnboardingGate>
                  <PlanGate>
                    <Outlet />
                  </PlanGate>
                </OnboardingGate>
              </ApprovalGate>
            </PageTransition>
            <footer className="mt-12 pt-6 border-t border-border/40 text-center text-[11px] leading-relaxed tracking-wide text-muted-foreground/80">
              <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 opacity-90 transition-opacity hover:opacity-100">
                <span>Crafted by</span>
                <a
                  href="https://github.com/danishhayat"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-foreground decoration-primary/30 underline-offset-4 hover:text-primary hover:underline"
                >
                  Engr. Danish Hayat
                </a>
                <span className="opacity-40" aria-hidden>
                  •
                </span>
                <span>Precise Realtors &amp; Builders</span>
              </div>
              <div className="mt-1 opacity-50">Islamabad, Pakistan</div>
            </footer>
          </div>
        </main>
      </div>

      <SsrSpikeWatcher />
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <MobileBottomNav onOpenMenu={() => setMobileOpen(true)} />
      <MobileFab />
    </div>
  );
}

/**
 * Blocks route content when the current company's plan doesn't include the
 * feature that matches the current pathname. Renders the full-screen
 * <UpgradeScreen /> instead of the child route.
 */
function PlanGate({ children }: { children: ReactNode }) {
  const { plan, loading } = useAuth();
  const loc = useLocation();
  // While plan is still loading, render children — RLS on the queries
  // themselves is the real security boundary; this gate is UX.
  if (loading || !plan) return <>{children}</>;
  const feat = featureForPath(loc.pathname);
  if (!feat || planAtLeast(plan, feat.minPlan)) return <>{children}</>;
  // Not a route redirect (we render UpgradeScreen in place), but still a
  // "misroute" symptom the product team wants to see in production.
  logRedirectReason("plan_gate_blocked", {
    from: loc.pathname,
    to: loc.pathname,
    meta: { feature: feat.key, required_plan: feat.minPlan, current_plan: plan },
  });
  return <UpgradeScreen feature={feat} />;
}

/**
 * Redirects admins of a freshly bootstrapped company into the setup
 * wizard until they finish (or skip) it. Non-admins and users already
 * past onboarding pass through untouched.
 */
/**
 * Blocks any tenant user whose company is pending, rejected, or
 * deactivated from accessing the app. They get shunted to
 * /pending-approval until a Super Admin approves + activates them.
 * Super Admins bypass the gate so they can still moderate.
 */
function ApprovalGate({ children }: { children: ReactNode }) {
  const {
    loading,
    companyLoading,
    user,
    companyId,
    approvalStatus,
    isCompanyActive,
    isSuperAdmin,
  } = useAuth();
  const loc = useLocation();
  const navigate = useNavigate();

  const SEED = "00000000-0000-0000-0000-000000000001";
  const isResolving = loading || (!!user && companyLoading);
  const onPending = loc.pathname.startsWith("/pending-approval");
  const onSuperadmin = loc.pathname.startsWith("/superadmin");
  const blocked =
    !!companyId &&
    companyId !== SEED &&
    !isSuperAdmin &&
    (approvalStatus !== "approved" || !isCompanyActive);

  useEffect(() => {
    if (isResolving) return;
    if (!blocked) {
      // If they landed on the pending page but are now approved, send them home.
      if (onPending) navigate("/", { replace: true });
      return;
    }
    if (onPending) return;
    navigate("/pending-approval", { replace: true });
  }, [isResolving, blocked, onPending, navigate]);

  if (blocked && !onPending && !onSuperadmin) {
    return (
      <div className="grid min-h-[50dvh] place-items-center" role="status" aria-live="polite">
        <div className="text-sm text-muted-foreground">Checking workspace status…</div>
      </div>
    );
  }
  return <>{children}</>;
}

function OnboardingGate({ children }: { children: ReactNode }) {
  const { loading, companyLoading, user, isAdmin, onboardingCompleted, companyId } = useAuth();

  const loc = useLocation();
  const navigate = useNavigate();

  // While we're still resolving the session or the company row (which carries
  // onboarding_completed_at), we can't know whether to redirect. Show a
  // placeholder instead of rendering the child route — otherwise a fresh
  // signup would flash the dashboard for the split second between session
  // hydration and the companies fetch resolving.
  const isResolving = loading || (!!user && companyLoading);
  const onOnboardingRoute = loc.pathname.startsWith("/onboarding");

  useEffect(() => {
    if (isResolving) return;
    if (!companyId) return;
    if (onboardingCompleted) return;
    if (!isAdmin) return;
    if (onOnboardingRoute) return;
    logRedirectReason("onboarding_incomplete_redirect", {
      from: loc.pathname,
      to: "/onboarding",
      meta: { company_id: companyId, is_admin: isAdmin },
    });
    navigate("/onboarding", { replace: true });
  }, [
    isResolving,
    isAdmin,
    onboardingCompleted,
    companyId,
    onOnboardingRoute,
    navigate,
    loc.pathname,
  ]);

  // Suspend children only when we're about to redirect to /onboarding — i.e.
  // resolving with a signed-in user, and NOT already on the onboarding route.
  // Users past onboarding (or non-admins) render normally; the layout itself
  // has its own skeletons where appropriate.
  const willRedirect = isResolving && !!user && !onOnboardingRoute;

  if (willRedirect) {
    return (
      <div
        className="grid min-h-dvh place-items-center bg-background"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading your workspace…
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function AppShell() {
  return (
    <ActiveProjectProvider>
      <AppShellInner />
    </ActiveProjectProvider>
  );
}

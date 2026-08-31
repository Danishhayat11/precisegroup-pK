import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@/lib/router-compat";
import { useCanReadClientPII } from "@/lib/access";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Briefcase,
  Users,
  Home,
  Receipt,
  LayoutDashboard,
  BookOpen,
  Repeat2,
  FilePlus2,
  BarChart3,
  Settings,
  HeartPulse,
  GitCompare,
  Bug,
  ShieldCheck,
  MessageSquare,
  Loader2,
  SearchX,
  Pin,
  PinOff,
  Star,
} from "lucide-react";
import { Search } from "lucide-react";
import { cn, escapePostgrestFilter } from "@/lib/utils";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import { useTheme } from "@/lib/theme";

// Fade + slide-out for search result groups and filter regions. Honors
// user + OS reduced-motion by collapsing to an opacity-only micro-tween.
const REGION_TRANSITION: Transition = {
  duration: 0.18,
  ease: [0.32, 0.72, 0, 1], // iOS-style ease
};
const REGION_VARIANTS = {
  initial: { opacity: 0, y: -4, height: 0 },
  animate: { opacity: 1, y: 0, height: "auto" },
  exit: { opacity: 0, y: -4, height: 0 },
};
const ITEM_VARIANTS = {
  initial: { opacity: 0, y: -3 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: -8 },
};

function AnimRegion({
  children,
  reducedMotion,
  ...rest
}: {
  children: React.ReactNode;
  reducedMotion: boolean;
  [k: string]: unknown;
}) {
  return (
    <motion.div
      layout={!reducedMotion}
      initial="initial"
      animate="animate"
      exit="exit"
      variants={reducedMotion ? undefined : REGION_VARIANTS}
      transition={reducedMotion ? { duration: 0 } : REGION_TRANSITION}
      style={{ overflow: "hidden" }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

const PINNED_STORAGE_KEY = "global-search:pinned-queries";
const PINNED_LIMIT = 8;

function readPinned(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writePinned(list: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota errors */
  }
}

function usePinnedQueries() {
  const [pinned, setPinned] = useState<string[]>(() => readPinned());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PINNED_STORAGE_KEY) setPinned(readPinned());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const pin = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setPinned((prev) => {
      const next = [
        trimmed,
        ...prev.filter((p) => p.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, PINNED_LIMIT);
      writePinned(next);
      return next;
    });
  };

  const unpin = (q: string) => {
    setPinned((prev) => {
      const next = prev.filter((p) => p.toLowerCase() !== q.toLowerCase());
      writePinned(next);
      return next;
    });
  };

  const isPinned = (q: string) => pinned.some((p) => p.toLowerCase() === q.trim().toLowerCase());

  return { pinned, pin, unpin, isPinned };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({ text, query }: { text?: string | number | null; query: string }) {
  const value = text == null ? "" : String(text);
  if (!query || !value) return <>{value}</>;
  const parts = value.split(new RegExp(`(${escapeRegExp(query)})`, "ig"));
  const q = query.toLowerCase();
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q ? (
          <mark
            key={i}
            // Warm highlighter wash + ring for a "found it" feel that survives
            // both light and dark iOS themes. Uses semantic warning tokens so
            // it inherits high-contrast overrides automatically.
            className="bg-warning/25 text-foreground ring-1 ring-warning/45 rounded-[3px] px-0.5 py-[1px] font-semibold decoration-warning/60 underline-offset-2"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function matchedFields(
  q: string,
  fields: { label: string; value?: string | number | null }[],
): string[] {
  const needle = q.toLowerCase();
  return fields
    .filter((f) => f.value != null && String(f.value).toLowerCase().includes(needle))
    .map((f) => f.label);
}

function MatchBadge({ fields }: { fields: string[] }) {
  if (fields.length === 0) return null;
  return (
    <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/80 border border-border/60 rounded px-1.5 py-0.5">
      matched: {fields.join(", ")}
    </span>
  );
}

const ROUTES: { label: string; to: string; icon: any; keywords?: string }[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Bookings", to: "/bookings", icon: Briefcase },
  { label: "Payments", to: "/payments", icon: Receipt },
  { label: "Installment Ledger", to: "/ledger", icon: BookOpen, keywords: "installment ledger" },
  { label: "Adjustments", to: "/adjustments", icon: Repeat2 },
  { label: "Documents", to: "/documents", icon: FilePlus2 },
  { label: "Clients", to: "/clients", icon: Users },
  { label: "Units", to: "/units", icon: Home },
  { label: "Projects", to: "/projects", icon: Briefcase },
  { label: "Reports", to: "/reports", icon: BarChart3 },
  { label: "Data Health", to: "/health", icon: HeartPulse },
  { label: "Reconciliation Diff", to: "/reconciliation-diff", icon: GitCompare },
  { label: "Code Debugger", to: "/debugger", icon: Bug },
  { label: "My Requests", to: "/my-requests", icon: MessageSquare },
  { label: "Settings", to: "/settings", icon: Settings },
  { label: "Admin Controls", to: "/admin", icon: ShieldCheck },
];

/**
 * Trailing-edge debounce with an idle "settling" flag. `pending` flips true
 * the moment `value` changes and back to false once the debounced value is
 * committed — the CommandDialog uses it to show a subtle typing indicator
 * without flashing the empty state between keystrokes.
 */
function useDebounced<T>(value: T, ms = 220): { value: T; pending: boolean } {
  const [v, setV] = useState(value);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (value === v) {
      setPending(false);
      return;
    }
    setPending(true);
    const t = setTimeout(() => {
      setV(value);
      setPending(false);
    }, ms);
    return () => clearTimeout(t);
  }, [value, ms, v]);
  return { value: v, pending };
}

type SearchResults = {
  bookings: any[];
  clients: any[];
  units: any[];
  payments: any[];
};

async function runSearch(
  q: string,
  canReadPII: boolean,
  signal?: AbortSignal,
): Promise<SearchResults> {
  const escaped = escapePostgrestFilter(q);
  const like = `%${escaped}%`;
  // PII-bearing sources (bookings/clients/payments) are only queried when
  // the current session has writer role. Viewers still get unit search.
  const piiTasks = canReadPII
    ? [
        supabase
          .from("bookings")
          .select("booking_id,client_name,unit_id,project_name")
          .or(
            `client_name.ilike.${like},booking_id.ilike.${like},unit_id.ilike.${like},project_name.ilike.${like}`,
          )
          .limit(8)
          .abortSignal(signal!),
        supabase
          .from("clients")
          .select("client_ref,name,cnic,mobile")
          .or(`name.ilike.${like},cnic.ilike.${like},mobile.ilike.${like},client_ref.ilike.${like}`)
          .limit(8)
          .abortSignal(signal!),
        supabase
          .from("payments")
          .select("receipt_no,booking_id,amount,payment_date,payment_mode")
          .or(`receipt_no.ilike.${like},booking_id.ilike.${like},payment_mode.ilike.${like}`)
          .limit(8)
          .abortSignal(signal!),
      ]
    : [
        Promise.resolve({ data: [] as any[] }),
        Promise.resolve({ data: [] as any[] }),
        Promise.resolve({ data: [] as any[] }),
      ];
  const [b, c, u, p] = await Promise.all([
    piiTasks[0],
    piiTasks[1],
    supabase
      .from("units")
      .select("unit_id,project_name,unit_type,status")
      .or(`unit_id.ilike.${like},project_name.ilike.${like},unit_type.ilike.${like}`)
      .limit(8)
      .abortSignal(signal!),
    piiTasks[2],
  ]);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return {
    bookings: b.data ?? [],
    clients: c.data ?? [],
    units: u.data ?? [],
    payments: p.data ?? [],
  };
}

export interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const navigate = useNavigate();
  const { reducedMotion } = useTheme();
  const [query, setQuery] = useState("");
  const { value: debounced, pending: isDebouncing } = useDebounced(query.trim(), 220);

  const enabled = open && debounced.length >= 2;
  const { pinned, pin, unpin, isPinned } = usePinnedQueries();
  const currentIsPinned = debounced.length >= 2 && isPinned(debounced);
  const canReadPII = useCanReadClientPII();

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", debounced, canReadPII ? "pii" : "public"],
    // TanStack Query auto-aborts the previous run's `signal` whenever the
    // queryKey changes (i.e. on every debounced keystroke), and every
    // Supabase call below is wired with `.abortSignal(signal)` so the
    // in-flight PostgREST requests are cancelled on the wire.
    queryFn: ({ signal }) => runSearch(debounced, canReadPII, signal),
    enabled,
    staleTime: 15_000,
    gcTime: 60_000,
    // Keep the previous result on screen while the next query resolves —
    // prevents the empty state from flashing between keystrokes.
    placeholderData: keepPreviousData,
    // A cancelled keystroke should not trigger retry storms.
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Composite "still working" flag: true while the debounce timer is
  // settling OR the network request is in flight. Used to keep the
  // typing indicator continuous instead of flickering between the two
  // phases.
  const isSearching = enabled && (isDebouncing || isFetching);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  const filteredRoutes = useMemo(() => {
    const q = debounced.toLowerCase();
    if (!q) return ROUTES;
    return ROUTES.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.to.toLowerCase().includes(q) ||
        (r.keywords ?? "").toLowerCase().includes(q),
    );
  }, [debounced]);

  const results = data ?? { bookings: [], clients: [], units: [], payments: [] };
  const hasData =
    results.bookings.length +
      results.clients.length +
      results.units.length +
      results.payments.length >
    0;

  // Consolidated screen-reader announcer. Debounced so we don't spam SR users
  // between keystrokes — only speaks once the query settles into one of
  // "searching", "results found", or "no results".
  const totalResults =
    results.bookings.length +
    results.clients.length +
    results.units.length +
    results.payments.length;
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!open) {
      setAnnouncement("");
      return;
    }
    if (debounced.length < 2) {
      setAnnouncement("");
      return;
    }
    if (isSearching && !hasData) {
      setAnnouncement(`Searching for ${debounced}`);
      return;
    }
    const t = setTimeout(() => {
      if (totalResults === 0 && !isSearching) {
        setAnnouncement(`No results for ${debounced}`);
      } else if (totalResults > 0) {
        setAnnouncement(
          `${totalResults} ${totalResults === 1 ? "result" : "results"} found for ${debounced}`,
        );
      }
    }, 120);
    return () => clearTimeout(t);
  }, [open, debounced, isSearching, hasData, totalResults]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
      <CommandInput
        placeholder="Search bookings, clients, units, payments…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <AnimatePresence initial={false} mode="popLayout">
          {debounced.length < 2 && (
            <AnimRegion key="hint" reducedMotion={reducedMotion}>
              <div className="px-4 py-6 text-center">
                <Search className="mx-auto h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Type at least 2 characters to search records.
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Try a client name, booking id, unit, CNIC, or mobile number.
                </p>
              </div>
              {pinned.length > 0 && (
                <CommandGroup heading="Pinned searches">
                  <AnimatePresence initial={false}>
                    {pinned.map((p) => (
                      <motion.div
                        key={`pin-${p}`}
                        layout={!reducedMotion}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        variants={reducedMotion ? undefined : ITEM_VARIANTS}
                        transition={reducedMotion ? { duration: 0 } : REGION_TRANSITION}
                      >
                        <CommandItem value={`pinned ${p}`} onSelect={() => setQuery(p)}>
                          <Star
                            className="mr-2 h-4 w-4 text-amber-500 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="truncate">
                            <Highlight text={p} query={debounced} />
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              unpin(p);
                            }}
                            aria-label={`Unpin “${p}”`}
                            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </CommandItem>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </CommandGroup>
              )}
            </AnimRegion>
          )}

          {debounced.length >= 2 && isSearching && !hasData && (
            <AnimRegion key="loading" reducedMotion={reducedMotion}>
              <div role="status" aria-live="polite" aria-busy="true" className="px-3 pt-2 pb-3">
                <span className="sr-only">Searching for “{debounced}”…</span>
                {/* Header line — mirrors the "matched: …" chip on real rows */}
                <div className="mb-2 flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-wider">
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full"
                    style={{
                      background:
                        "linear-gradient(140deg, color-mix(in oklab, var(--primary) 22%, var(--card)) 0%, color-mix(in oklab, var(--brand-gold, var(--primary)) 14%, var(--card)) 100%)",
                      boxShadow:
                        "inset 0 0 0 1px color-mix(in oklab, var(--primary) 32%, transparent)",
                    }}
                    aria-hidden="true"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" style={{ color: "var(--primary)" }} />
                  </span>
                  <span
                    style={{ color: "color-mix(in oklab, var(--foreground) 70%, transparent)" }}
                  >
                    Searching for “{debounced}”…
                  </span>
                </div>
                {/* Skeleton rows — three tiers to hint at grouped results.
                    Uses the pearl-glass ramp (card → primary infusion) with a
                    shimmer sweep. Honors reduced motion by holding still. */}
                <ul className="space-y-1.5">
                  {[0, 1, 2].map((i) => (
                    <li
                      key={i}
                      className="relative overflow-hidden rounded-md px-2 py-2.5"
                      style={{
                        background:
                          "linear-gradient(180deg, color-mix(in oklab, var(--card) 96%, var(--primary) 4%) 0%, color-mix(in oklab, var(--card) 90%, var(--primary) 10%) 100%)",
                        border:
                          "1px solid color-mix(in oklab, var(--border) 55%, var(--primary) 25%)",
                      }}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-6 w-6 shrink-0 rounded-full"
                          style={{
                            background:
                              "linear-gradient(140deg, color-mix(in oklab, var(--primary) 18%, var(--card)) 0%, color-mix(in oklab, var(--brand-gold, var(--primary)) 12%, var(--card)) 100%)",
                            boxShadow:
                              "inset 0 0 0 1px color-mix(in oklab, var(--primary) 22%, transparent)",
                          }}
                        />
                        <div className="flex-1 space-y-1.5">
                          <div
                            className="h-2.5 rounded-full"
                            style={{
                              width: `${68 - i * 10}%`,
                              background: "color-mix(in oklab, var(--foreground) 14%, transparent)",
                            }}
                          />
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: `${44 - i * 6}%`,
                              background: "color-mix(in oklab, var(--foreground) 8%, transparent)",
                            }}
                          />
                        </div>
                      </div>
                      {!reducedMotion && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-0 -translate-x-full animate-[gs-shimmer_1.6s_ease-in-out_infinite]"
                          style={{
                            animationDelay: `${i * 140}ms`,
                            background:
                              "linear-gradient(90deg, transparent 0%, color-mix(in oklab, #fff 22%, transparent) 45%, color-mix(in oklab, var(--brand-gold, var(--primary)) 18%, transparent) 55%, transparent 100%)",
                          }}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </AnimRegion>
          )}

          {debounced.length >= 2 && !isSearching && !hasData && (
            <AnimRegion key="empty" reducedMotion={reducedMotion}>
              <CommandEmpty>
                <div className="px-4 py-8 text-center">
                  {/* Halo tile — pearl-glass ramp with primary→gold sheen,
                      matches the trigger's gs-icon so the empty state reads
                      as part of the same surface family. */}
                  <div
                    className="mx-auto grid h-14 w-14 place-items-center rounded-2xl"
                    style={{
                      background:
                        "linear-gradient(140deg, color-mix(in oklab, var(--primary) 18%, var(--card)) 0%, color-mix(in oklab, var(--brand-gold, var(--primary)) 14%, var(--card)) 100%)",
                      boxShadow: [
                        "inset 0 1px 0 color-mix(in oklab, #fff 55%, transparent)",
                        "inset 0 0 0 1px color-mix(in oklab, var(--primary) 30%, transparent)",
                        "0 12px 28px -14px color-mix(in oklab, var(--primary) 38%, transparent)",
                        "0 6px 16px -10px color-mix(in oklab, var(--brand-gold, var(--primary)) 28%, transparent)",
                      ].join(", "),
                    }}
                    aria-hidden="true"
                  >
                    <SearchX
                      className="h-7 w-7"
                      style={{
                        color:
                          "color-mix(in oklab, var(--primary) 70%, var(--brand-gold, var(--primary)))",
                      }}
                    />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-foreground">
                    No matches for “<Highlight text={debounced} query={debounced} />”
                  </p>
                  <p className="mx-auto mt-1.5 max-w-[42ch] text-xs leading-relaxed text-muted-foreground">
                    Check the spelling, shorten the query, or try a different field: client name,
                    booking id, CNIC, mobile, or unit id.
                  </p>
                  {/* Suggestion chips — quick pivots that reuse the pearl
                      palette (same ring + tint as gs-kbd). */}
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                    {["Bookings", "Clients", "Units", "Payments"].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setQuery(s.toLowerCase())}
                        className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                        style={{
                          background:
                            "linear-gradient(180deg, color-mix(in oklab, var(--card) 94%, var(--primary) 6%) 0%, color-mix(in oklab, var(--card) 86%, var(--primary) 14%) 100%)",
                          border:
                            "1px solid color-mix(in oklab, var(--border) 60%, var(--primary) 30%)",
                          color: "color-mix(in oklab, var(--foreground) 82%, var(--primary) 18%)",
                          boxShadow: "inset 0 1px 0 color-mix(in oklab, #fff 45%, transparent)",
                        }}
                      >
                        Try “{s}”
                      </button>
                    ))}
                  </div>
                </div>
              </CommandEmpty>
            </AnimRegion>
          )}

          {filteredRoutes.length > 0 && (
            <AnimRegion key="navigate" reducedMotion={reducedMotion}>
              <CommandGroup heading="Navigate">
                {filteredRoutes.slice(0, 8).map((r) => (
                  <CommandItem
                    key={r.to}
                    value={`route ${r.label} ${r.to}`}
                    onSelect={() => go(r.to)}
                  >
                    <r.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span>
                      <Highlight text={r.label} query={debounced} />
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      <Highlight text={r.to} query={debounced} />
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </AnimRegion>
          )}

          {debounced.length >= 2 && (
            <AnimRegion key="this-search" reducedMotion={reducedMotion}>
              <CommandGroup heading="This search">
                <CommandItem
                  value={`__pin-toggle ${debounced}`}
                  onSelect={() => (currentIsPinned ? unpin(debounced) : pin(debounced))}
                >
                  {currentIsPinned ? (
                    <PinOff className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <Pin className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span>
                    {currentIsPinned ? "Unpin" : "Pin"} “{debounced}”
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {currentIsPinned ? "Remove from Pinned" : "Save for quick access"}
                  </span>
                </CommandItem>
              </CommandGroup>
            </AnimRegion>
          )}

          {results.bookings.length > 0 && (
            <AnimRegion key="bookings" reducedMotion={reducedMotion}>
              <CommandGroup heading="Bookings">
                {results.bookings.map((b: any) => {
                  const matches = matchedFields(debounced, [
                    { label: "client", value: b.client_name },
                    { label: "booking id", value: b.booking_id },
                    { label: "unit", value: b.unit_id },
                    { label: "project", value: b.project_name },
                  ]);
                  return (
                    <CommandItem
                      key={`b-${b.booking_id}`}
                      value={`booking ${b.booking_id} ${b.client_name} ${b.unit_id} ${b.project_name ?? ""}`}
                      onSelect={() => go(`/bookings/${b.booking_id}`)}
                    >
                      <Briefcase className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate">
                          <Highlight text={b.client_name || "(no client)"} query={debounced} />
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          <Highlight text={b.booking_id} query={debounced} />
                          {" · Unit "}
                          <Highlight text={b.unit_id ?? "—"} query={debounced} />
                          {b.project_name ? (
                            <>
                              {" · "}
                              <Highlight text={b.project_name} query={debounced} />
                            </>
                          ) : null}
                        </span>
                      </div>
                      <MatchBadge fields={matches} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </AnimRegion>
          )}

          {results.clients.length > 0 && (
            <AnimRegion key="clients" reducedMotion={reducedMotion}>
              <CommandGroup heading="Clients">
                {results.clients.map((c: any) => {
                  const matches = matchedFields(debounced, [
                    { label: "name", value: c.name },
                    { label: "client ref", value: c.client_ref },
                    { label: "cnic", value: c.cnic },
                    { label: "mobile", value: c.mobile },
                  ]);
                  return (
                    <CommandItem
                      key={`c-${c.client_ref}`}
                      value={`client ${c.client_ref} ${c.name} ${c.mobile} ${c.cnic ?? ""}`}
                      onSelect={() => go(`/clients`)}
                    >
                      <Users className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium capitalize truncate">
                          <Highlight text={c.name} query={debounced} />
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          <Highlight text={c.client_ref} query={debounced} />
                          {c.mobile ? (
                            <>
                              {" · "}
                              <Highlight text={c.mobile} query={debounced} />
                            </>
                          ) : null}
                          {c.cnic ? (
                            <>
                              {" · "}
                              <Highlight text={c.cnic} query={debounced} />
                            </>
                          ) : null}
                        </span>
                      </div>
                      <MatchBadge fields={matches} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </AnimRegion>
          )}

          {results.units.length > 0 && (
            <AnimRegion key="units" reducedMotion={reducedMotion}>
              <CommandGroup heading="Units">
                {results.units.map((u: any) => {
                  const matches = matchedFields(debounced, [
                    { label: "unit", value: u.unit_id },
                    { label: "project", value: u.project_name },
                    { label: "type", value: u.unit_type },
                  ]);
                  return (
                    <CommandItem
                      key={`u-${u.unit_id}`}
                      value={`unit ${u.unit_id} ${u.project_name} ${u.unit_type ?? ""}`}
                      onSelect={() => go(`/units`)}
                    >
                      <Home className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate">
                          <Highlight text={u.unit_id} query={debounced} />
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          <Highlight text={u.project_name ?? ""} query={debounced} />
                          {u.unit_type ? (
                            <>
                              {" · "}
                              <Highlight text={u.unit_type} query={debounced} />
                            </>
                          ) : null}
                          {u.status ? ` · ${u.status}` : ""}
                        </span>
                      </div>
                      <MatchBadge fields={matches} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </AnimRegion>
          )}

          {results.payments.length > 0 && (
            <AnimRegion key="payments" reducedMotion={reducedMotion}>
              <CommandGroup heading="Payments">
                {results.payments.map((p: any) => {
                  const matches = matchedFields(debounced, [
                    { label: "receipt no", value: p.receipt_no },
                    { label: "booking id", value: p.booking_id },
                    { label: "mode", value: p.payment_mode },
                  ]);
                  return (
                    <CommandItem
                      key={`p-${p.receipt_no}`}
                      value={`payment ${p.receipt_no} ${p.booking_id} ${p.payment_mode ?? ""}`}
                      onSelect={() => go(`/payments`)}
                    >
                      <Receipt className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate">
                          <Highlight text={p.receipt_no} query={debounced} />
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          {"Booking "}
                          <Highlight text={p.booking_id} query={debounced} />
                          {p.payment_mode ? (
                            <>
                              {" · "}
                              <Highlight text={p.payment_mode} query={debounced} />
                            </>
                          ) : null}
                          {p.payment_date ? ` · ${p.payment_date}` : ""}
                        </span>
                      </div>
                      <MatchBadge fields={matches} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </AnimRegion>
          )}

          {isSearching && hasData && (
            <AnimRegion key="updating" reducedMotion={reducedMotion}>
              <div
                className="flex items-center gap-2 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                <span>Updating results…</span>
              </div>
            </AnimRegion>
          )}
        </AnimatePresence>
      </CommandList>
    </CommandDialog>
  );
}

export interface GlobalSearchTriggerProps {
  onClick: () => void;
  className?: string;
}

export function GlobalSearchTrigger({ onClick, className }: GlobalSearchTriggerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open global search (⌘K)"
      data-global-search-trigger=""
      className={cn(
        // Full-flex, but capped so the trigger stays legible next to the
        // breadcrumbs and right-cluster on wide screens. `mx-auto` centers
        // it in the leftover header space when both siblings are compact.
        "relative flex-1 min-w-0 max-w-[520px] xl:max-w-[560px] mx-auto group text-left",
        "focus-visible:outline-none",
        className,
      )}
    >
      <span
        className={cn(
          // Slightly taller pill on desktop for better rhythm against
          // 44px icon buttons; kbd chip padding reduced now that the
          // placeholder copy fits without truncation.
          "gs-surface block pl-11 pr-16 h-10 leading-10 lg:h-11 lg:leading-[44px] rounded-full",
          "backdrop-blur-md text-[13px] lg:text-[13.5px] font-medium",
          // Subtle press feedback that plays alongside the CSS hover/focus
          // shimmer defined in styles.css.
          "transition-transform duration-200 will-change-transform",
          "group-hover:scale-[1.005] group-active:scale-[0.995] motion-reduce:transform-none",
        )}
      >
        <span className="gs-icon pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full">
          <Search className="h-[14px] w-[14px]" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <span className="gs-placeholder truncate align-middle">
          {/* Short label keeps the pill readable at every breakpoint;
              the longer domain hint sits inside the dialog itself. */}
          Search anything
          <span className="gs-ellipsis">…</span>
        </span>
      </span>
      <span className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 items-center gap-1">
        <kbd className="gs-kbd inline-flex h-6 min-w-[22px] items-center justify-center rounded-md px-1.5 text-[10.5px] font-semibold tabular-nums">
          ⌘
        </kbd>
        <kbd className="gs-kbd inline-flex h-6 min-w-[22px] items-center justify-center rounded-md px-1.5 text-[10.5px] font-semibold tabular-nums">
          K
        </kbd>
      </span>
    </button>
  );
}

export function useGlobalSearchHotkey(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isK = e.key === "k" || e.key === "K";
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpen();
      } else if (e.key === "/") {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        const editable =
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          (t && (t as HTMLElement).isContentEditable);
        if (!editable) {
          e.preventDefault();
          onOpen();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}

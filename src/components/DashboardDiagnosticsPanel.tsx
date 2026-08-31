/**
 * Developer-only floating panel that displays the most recent dashboard
 * diagnostic events (hydration, fetch lifecycle, query errors, render errors).
 *
 * Visibility:
 *   - Auto-enabled in Vite dev (`import.meta.env.DEV`).
 *   - In production, enable by setting `localStorage["precise.dashboardDiag"] = "on"`
 *     or by appending `?diag=1` to the URL.
 *
 * Zero cost when hidden — the effect that subscribes to
 * `window.dashboard:diagnostic` never mounts.
 */
import { useEffect, useMemo, useRef, useState } from "react";

type DiagEvent = {
  id: number;
  receivedAt: string;
  event: string;
  level: "info" | "warning" | "error";
  message?: string;
  detail: Record<string, unknown>;
};

const MAX_EVENTS = 50;
const LS_VISIBLE_KEY = "precise.dashboardDiag";
const LS_COLLAPSED_KEY = "precise.dashboardDiag.collapsed";

function isEnabled(): boolean {
  try {
    if (import.meta.env?.DEV) return true;
  } catch {
    /* ignore */
  }
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(LS_VISIBLE_KEY);
    if (v === "on" || v === "1" || v === "true") return true;
  } catch {
    /* ignore */
  }
  try {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("diag");
    if (v === "1" || v === "on" || v === "true") return true;
  } catch {
    /* ignore */
  }
  return false;
}

function levelColor(level: DiagEvent["level"]): string {
  if (level === "error") return "text-destructive border-destructive/40 bg-destructive/10";
  if (level === "warning") return "text-warning border-warning/40 bg-warning/10";
  return "text-success border-success/30 bg-success/10";
}

export default function DashboardDiagnosticsPanel() {
  const [enabled, setEnabled] = useState<boolean>(() => isEnabled());
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(LS_COLLAPSED_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [events, setEvents] = useState<DiagEvent[]>([]);
  const [filter, setFilter] = useState<"" | "info" | "warning" | "error">("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<Record<string, unknown>>).detail ?? {};
      const level = (detail.level as DiagEvent["level"]) ?? "info";
      const eventName = String(detail.event ?? "event");
      const message = typeof detail.message === "string" ? (detail.message as string) : undefined;
      const next: DiagEvent = {
        id: ++idRef.current,
        receivedAt: new Date().toISOString(),
        event: eventName,
        level,
        message,
        detail,
      };
      setEvents((prev) => [next, ...prev].slice(0, MAX_EVENTS));
    };
    window.addEventListener("dashboard:diagnostic", handler as EventListener);
    return () => window.removeEventListener("dashboard:diagnostic", handler as EventListener);
  }, [enabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LS_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const filtered = useMemo(
    () => (filter ? events.filter((e) => e.level === filter) : events),
    [events, filter],
  );

  const counts = useMemo(() => {
    const c = { info: 0, warning: 0, error: 0 };
    for (const e of events) c[e.level]++;
    return c;
  }, [events]);

  if (!enabled) return null;

  return (
    <div
      data-testid="dashboard-diagnostics-panel"
      className="fixed bottom-4 right-4 z-[9999] font-mono text-[11px]"
      style={{ pointerEvents: "auto" }}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="inline-flex items-center min-h-[44px] rounded-full border border-border bg-popover/95 px-3 py-1.5 text-popover-foreground shadow-lg backdrop-blur hover:bg-muted lg:min-h-0 lg:py-1.5"
          title="Open dashboard diagnostics"
        >
          diag {events.length > 0 && <span className="ml-1 opacity-70">({events.length})</span>}
          {counts.error > 0 && (
            <span className="ml-1 rounded bg-destructive/80 px-1 text-destructive-foreground">
              {counts.error}
            </span>
          )}
        </button>
      ) : (
        <div className="w-[420px] max-h-[70vh] flex flex-col rounded-lg border border-border bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Dashboard Diagnostics</span>
              <span className="text-muted-foreground">
                {events.length}/{MAX_EVENTS}
              </span>
              <span className="text-success">i:{counts.info}</span>
              <span className="text-warning">w:{counts.warning}</span>
              <span className="text-destructive">e:{counts.error}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setEvents([]);
                  setExpandedId(null);
                }}
                className="rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted"
                title="Clear events"
              >
                clear
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(LS_VISIBLE_KEY);
                  } catch {
                    /* ignore */
                  }
                  setEnabled(false);
                }}
                className="rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted"
                title="Disable panel (dev remount will reappear)"
              >
                off
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted"
                title="Collapse"
              >
                –
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
            {(["", "info", "warning", "error"] as const).map((f) => (
              <button
                key={f || "all"}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded px-2 py-0.5 ${
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {f || "all"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-muted-foreground">Waiting for events…</div>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((e) => {
                  const isOpen = expandedId === e.id;
                  const time = e.receivedAt.slice(11, 23);
                  return (
                    <li key={e.id} className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isOpen ? null : e.id)}
                        className="flex w-full items-start gap-2 text-left"
                      >
                        <span className="w-[72px] shrink-0 text-muted-foreground">{time}</span>
                        <span className={`shrink-0 rounded border px-1 ${levelColor(e.level)}`}>
                          {e.level[0].toUpperCase()}
                        </span>
                        <span className="flex-1 truncate text-foreground">
                          {e.event}
                          {e.message ? (
                            <span className="ml-1 text-muted-foreground">— {e.message}</span>
                          ) : null}
                        </span>
                      </button>
                      {isOpen && (
                        <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted p-2 text-[10px] leading-snug text-foreground">
                          {safeStringify(e.detail)}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function safeStringify(obj: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      obj,
      (_k, v) => {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v as object)) return "[Circular]";
          seen.add(v as object);
        }
        return v;
      },
      2,
    );
  } catch {
    return String(obj);
  }
}

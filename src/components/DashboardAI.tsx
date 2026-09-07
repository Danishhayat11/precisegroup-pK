import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Send,
  X,
  MessageSquare,
  RefreshCw,
  Loader2,
  AlertTriangle,
  TrendingUp,
  Wand2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";

/** Snapshot pushed to the AI route. Keep it small + numeric. */
export type AISnapshot = {
  rangeLabel: string;
  filters: { project?: string; unit?: string; client?: string };
  kpis: Record<string, number | string>;
  trendTail: { bucket: string; sell: number; cash: number; pending: number }[];
  overdueTop: { name: string; unit: string; installments: number; amount: number; risk: string }[];
  totalsByProject?: { name: string; sold: number }[];
  modeBreakdown?: { name: string; value: number }[];
  target?: { name: string; unit: string; installments: number; amount: number };
};

async function postAI(body: any, signal?: AbortSignal): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch("/api/ai", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
}

async function readJSON(res: Response): Promise<string> {
  if (!res.ok) {
    try {
      const j = await res.json();
      throw new Error(j?.error ?? `Request failed (${res.status})`);
    } catch (e: any) {
      throw new Error(e?.message ?? `Request failed (${res.status})`);
    }
  }
  const j = await res.json();
  return j?.text ?? "";
}

/* ───────────────────── Insights ───────────────────── */

export function AIInsightsCard({ snapshot }: { snapshot: AISnapshot }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lastKey = useRef("");
  const mounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const run = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setErr(null);
    try {
      const res = await postAI({ mode: "insights", snapshot }, ctrl.signal);
      const out = await readJSON(res);
      if (!mounted.current || ctrl.signal.aborted) return;
      setText(out);
    } catch (e: any) {
      if (ctrl.signal.aborted || !mounted.current) return;
      setErr(e?.message ?? "Failed");
    } finally {
      if (mounted.current && abortRef.current === ctrl) setLoading(false);
    }
  };

  // Auto-run when the snapshot meaningfully changes.
  useEffect(() => {
    const key = JSON.stringify([snapshot.rangeLabel, snapshot.filters, snapshot.kpis]);
    if (key === lastKey.current) return;
    lastKey.current = key;
    const t = setTimeout(run, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  return (
    <div className="glass-card rounded-3xl p-6 text-foreground transition-all duration-200 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gold/20 ring-1 ring-gold/40">
            <Sparkles className="h-4 w-4 text-gold" />
          </span>
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium">
              AI Briefing
            </div>
            <h2 className="font-display text-base font-semibold m-0">Today's read on the book</h2>
          </div>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-muted/50 transition-colors"
          title="Regenerate"
          aria-label="Regenerate insights"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 text-foreground/85">
        {err ? (
          <div className="flex items-start gap-2 text-rust">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <span>{err}</span>
          </div>
        ) : text ? (
          <ReactMarkdown>{text}</ReactMarkdown>
        ) : (
          <div className="space-y-2 animate-pulse">
            <div className="h-3 w-11/12 bg-muted rounded" />
            <div className="h-3 w-9/12 bg-muted rounded" />
            <div className="h-3 w-10/12 bg-muted rounded" />
            <div className="h-3 w-8/12 bg-muted rounded" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────── Risk forecast ───────────────────── */

export function AIRiskForecast({ snapshot }: { snapshot: AISnapshot }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await postAI({ mode: "forecast", snapshot });
      setText(await readJSON(res));
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-elevated p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-adjustment" />
          <div>
            <div className="font-display text-base font-semibold">AI Risk Forecast</div>
            <div className="text-xs text-muted-foreground">
              30-day slip risk for the worst accounts.
            </div>
          </div>
        </div>
        <button
          onClick={run}
          disabled={loading || snapshot.overdueTop.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50 transition"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {text ? "Regenerate" : "Run forecast"}
        </button>
      </div>
      <div className="prose prose-sm max-w-none prose-table:text-xs prose-th:bg-muted/50 prose-td:py-1.5 prose-th:py-1.5 prose-td:px-2 prose-th:px-2">
        {err ? (
          <div className="text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {err}
          </div>
        ) : text ? (
          <ReactMarkdown>{text}</ReactMarkdown>
        ) : (
          <div className="text-sm text-muted-foreground">
            Click <em>Run forecast</em> to let the AI rank which clients are most likely to fall
            further behind next month.
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────── Draft reminder (single client) ───────────────────── */

export async function aiDraftMessage(
  snapshot: AISnapshot,
  target: AISnapshot["target"],
): Promise<string> {
  const res = await postAI({ mode: "draft", snapshot: { ...snapshot, target } });
  return readJSON(res);
}

/* ───────────────────── Floating chat ───────────────────── */

type ChatMsg = { role: "user" | "assistant"; content: string };

export function AIChatLauncher({ snapshot }: { snapshot: AISnapshot }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const mounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open]);

  const send = async () => {
    const q = input.trim();
    if (!q || sending) return;
    const next: ChatMsg[] = [
      ...msgs,
      { role: "user", content: q },
      { role: "assistant", content: "" },
    ];
    setMsgs(next);
    setInput("");
    setSending(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await postAI(
        { mode: "chat", snapshot, messages: next.slice(0, -1) },
        ctrl.signal,
      );
      if (!res.ok || !res.body) {
        let errMsg = `Request failed (${res.status})`;
        try {
          const j = await res.json();
          errMsg = j?.error ?? errMsg;
        } catch {}
        if (mounted.current && !ctrl.signal.aborted) {
          setMsgs((m) => {
            const c = [...m];
            c[c.length - 1] = { role: "assistant", content: `⚠️ ${errMsg}` };
            return c;
          });
        }
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      try {
        while (true) {
          if (ctrl.signal.aborted || !mounted.current) {
            try {
              await reader.cancel();
            } catch {}
            break;
          }
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          if (!mounted.current || ctrl.signal.aborted) break;
          setMsgs((m) => {
            const c = [...m];
            c[c.length - 1] = { role: "assistant", content: acc };
            return c;
          });
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {}
      }
    } catch (e: any) {
      if (ctrl.signal.aborted || !mounted.current) return;
      setMsgs((m) => {
        const c = [...m];
        c[c.length - 1] = { role: "assistant", content: `⚠️ ${e?.message ?? "Failed"}` };
        return c;
      });
    } finally {
      if (mounted.current && abortRef.current === ctrl) setSending(false);
    }
  };

  const suggestions = [
    "Who are the top 3 clients I should call today?",
    "Summarise this month's collection performance.",
    "Which project has the highest pending balance?",
    "Draft a short collections update for the directors.",
  ];

  return (
    <>
      <motion.button
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-2xl px-4 py-3 ring-2 ring-gold/40"
        aria-label="Open AI assistant"
      >
        <Wand2 className="h-4 w-4" />{" "}
        <span className="font-display text-sm font-semibold">Ask your data</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <motion.aside
              role="dialog"
              aria-label="AI assistant"
              initial={{ x: 480, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 480, opacity: 0 }}
              transition={{ type: "spring", stiffness: 240, damping: 28 }}
              className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[440px] bg-background border-l border-border shadow-2xl flex flex-col"
            >
              <div className="px-5 py-4 border-b flex items-center justify-between magazine-hero text-foreground">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded bg-gold/20 ring-1 ring-gold/40">
                    <Sparkles className="h-4 w-4 text-gold" />
                  </span>
                  <div>
                    <h2 className="font-display text-sm font-semibold m-0 leading-tight">Insight Generator</h2>
                    <div className="text-[11px] text-muted-foreground">Contextual intelligence</div>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-muted/50"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgs.length === 0 && (
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground">
                      Ask any question about the dashboard you're looking at — I only answer from
                      this live snapshot.
                    </div>
                    <div className="grid gap-2">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => setInput(s)}
                          className="text-left text-xs rounded-lg border border-border bg-muted/40 hover:bg-muted px-3 py-2 transition-colors"
                        >
                          <MessageSquare className="inline h-3 w-3 mr-1.5 text-accent" />
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {msgs.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted text-foreground rounded-bl-sm"
                      }`}
                    >
                      {m.role === "assistant" ? (
                        <div className="prose prose-sm max-w-none prose-p:my-1 prose-table:text-xs">
                          {m.content ? (
                            <ReactMarkdown>{m.content}</ReactMarkdown>
                          ) : (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
                className="border-t p-3 flex items-end gap-2"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder="Ask about collections, overdue, projects…"
                  className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring max-h-32"
                  aria-label="Message"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90"
                  aria-label="Send"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </form>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

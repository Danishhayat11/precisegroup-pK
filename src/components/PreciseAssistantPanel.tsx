import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import {
  Sparkles,
  Send,
  X,
  Trash2,
  Copy,
  MessageSquare,
  Loader2,
  AlertTriangle,
  Download,
  FileJson,
  FileText,
  Paperclip,
  Image as ImageIcon,
  ExternalLink,
  ShieldAlert,
  Undo2,
  ArrowRight,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { buildJsonExportMetadata } from "@/lib/csvExportMetadata";
import { useAssistant } from "@/lib/assistantContext";
import { buildSnapshot, PKR, type ERPSnapshot } from "@/lib/erpSnapshot";
import {
  loadHistory as loadStoredHistory,
  appendMessage as persistMessage,
  clearHistory as clearStoredHistory,
  type StoredMsg,
} from "@/lib/assistantHistory";
import {
  extractEntities,
  detectAmbiguity,
  renderMemoryForPrompt,
  EMPTY_MEMORY,
  type ConversationMemory,
} from "@/lib/assistantMemory";
import { loadMemory, saveMemory, clearMemory } from "@/lib/assistantMemoryStore";

type Msg = StoredMsg;

const QUICK_CHIPS = [
  "Who owes the most?",
  "Show overdue clients",
  "This month's collections",
  "Which clients need follow-up?",
  "Generate legal notice",
  "Draft WhatsApp message",
  "Summarize this booking",
  "Export report summary",
];

type Attachment = { name: string; dataUrl: string; mime: string; size: number };

async function postChat(
  messages: Msg[],
  snapshot: ERPSnapshot,
  attachments: Attachment[],
  memory: ConversationMemory,
  ambiguities: string[],
  signal: AbortSignal,
) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const memoryBlock = renderMemoryForPrompt(memory);
  const ambiguityBlock = ambiguities.length
    ? `\n\n## AMBIGUITY DETECTED — ASK BEFORE ACTING\n${ambiguities.map((a) => `- ${a}`).join("\n")}\nRespond with a single crisp follow-up question that names the concrete options above. Do NOT call any tool until the user answers.`
    : "";
  return fetch("/api/ai", {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      mode: "assistant",
      snapshot,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      attachments: attachments.map((a) => ({ dataUrl: a.dataUrl, name: a.name, mime: a.mime })),
      memoryContext: memoryBlock + ambiguityBlock,
    }),
  });
}

function welcome(snap: ERPSnapshot | null, label: string | null): string {
  if (!snap) return "Assalam o Alaikum. I am your **Precise Assistant**. Loading today's snapshot…";
  const top = [...snap.bookings].sort((a, b) => b.overdueAmount - a.overdueAmount)[0];
  const parts = [
    "**Assalam o Alaikum.** I am your *Precise Assistant*.",
    `Today's snapshot: **${PKR(snap.portfolio.totalOverdue)}** overdue across **${snap.portfolio.overdueClientCount}** clients.`,
  ];
  if (top && top.overdueAmount > 0) {
    parts.push(
      `Highest exposure: **${top.clientName}** — ${PKR(top.overdueAmount)} (${top.unitNo ?? "—"}).`,
    );
  }
  if (label)
    parts.push(`You're currently viewing **${label}**. I can draft a notice or WhatsApp for them.`);
  parts.push("What would you like to do?");
  return parts.join("\n\n");
}

/* ─────────────────── code/action helpers ─────────────────── */

function CopyableCodeBlock({ text }: { text: string }) {
  const isWhatsApp = /assalam\s*o\s*alaikum/i.test(text);
  const wa = isWhatsApp ? `https://wa.me/?text=${encodeURIComponent(text)}` : null;
  return (
    <div className="my-2 rounded-md border bg-muted/40">
      <pre className="text-[12px] leading-relaxed whitespace-pre-wrap font-mono p-3 overflow-x-auto">
        {text}
      </pre>
      <div className="flex gap-2 px-2 pb-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => {
            navigator.clipboard.writeText(text);
            toast.success("Copied");
          }}
        >
          <Copy className="h-3 w-3 mr-1" /> Copy
        </Button>
        {wa && (
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <a href={wa} target="_blank" rel="noreferrer noopener">
              <MessageSquare className="h-3 w-3 mr-1" /> Open in WhatsApp
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function ProposalCard({ raw }: { raw: string }) {
  let p: any = null;
  try {
    p = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  if (!p || typeof p !== "object" || !p.action) {
    return <CopyableCodeBlock text={raw} />;
  }
  const action = String(p.action);
  const adminOnly = !!p.admin_only;
  const payload = p.payload ?? {};
  const bookingId = payload.booking_id ?? payload.bookingId;

  // Map action → best-fit deep link + label
  const routing: Record<string, { to: string; label: string; search?: Record<string, any> }> = {
    log_payment: {
      to: "/payments",
      label: "Open in Payments",
      search: {
        new: 1,
        ...(bookingId ? { booking: bookingId } : {}),
        prefill: btoa(unescape(encodeURIComponent(JSON.stringify(payload)))),
      },
    },
    split_payment: {
      to: "/payments",
      label: "Open split builder",
      search: {
        new: 1,
        split: 1,
        ...(bookingId ? { booking: bookingId } : {}),
        prefill: btoa(unescape(encodeURIComponent(JSON.stringify(payload)))),
      },
    },
    bulk_reminders: { to: "/dashboard", label: "Review reminders", search: { reminders: 1 } },
    edit_payment: {
      to: "/payments",
      label: "Open edit dialog",
      search: { edit: payload.receipt_no ?? payload.payment_id ?? "" },
    },
    restructure_plan: {
      to: "/admin",
      label: "Open Restructure",
      search: { restructure: bookingId ?? "" },
    },
  };
  const link = routing[action];

  return (
    <div className="my-2 rounded-xl border-2 border-brand-gold/60 bg-gradient-to-br from-brand-gold/10 to-brand-gold/5 p-3 shadow-sm">
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles className="h-4 w-4 text-brand-gold" />
        <div className="text-[13px] font-semibold text-brand-navy">
          Proposed action · {action.replace(/_/g, " ")}
        </div>
        {adminOnly && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
            <ShieldAlert className="h-3 w-3" /> Admin only
          </span>
        )}
      </div>
      <pre className="text-[11px] leading-snug bg-muted/60 text-foreground/80 rounded-md border border-border/60 p-2 overflow-x-auto max-h-40 font-mono">
        {JSON.stringify(payload, null, 2)}
      </pre>
      <div className="mt-2 flex items-center gap-2">
        {link ? (
          <Link
            to={link.to as any}
            search={link.search as any}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition"
          >
            <ExternalLink className="h-3 w-3" /> {link.label}
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
            toast.success("Payload copied");
          }}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border/60 bg-background/60 hover:bg-muted transition"
        >
          <Copy className="h-3 w-3" /> Copy payload
        </button>
        <span className="text-[10px] text-muted-foreground ml-auto">
          Nothing has been written yet — confirm in the app.
        </span>
      </div>
    </div>
  );
}

/* ─────────────────── before/after diff + rollback card ─────────────────── */

// Custom-event bridge so a DiffCard's Undo button can enqueue a follow-up
// user turn through the panel's own send() pipeline (which knows about
// snapshot, memory, and streaming state). Keeps the card render-only.
const SUBMIT_EVENT = "precise-assistant:submit-prompt";

function primitive(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 57) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function DiffRows({ before, after }: { before: any; after: any }) {
  // Union of keys across both sides so newly-set fields are visible even
  // when they were absent in the before snapshot.
  const keys = Array.from(
    new Set([
      ...(before && typeof before === "object" ? Object.keys(before) : []),
      ...(after && typeof after === "object" ? Object.keys(after) : []),
    ]),
  );
  if (keys.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground italic px-1 py-2">
        No structured diff — see raw before/after in the card actions.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-2 gap-y-0.5 text-[11px] font-mono">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Field</div>
      <div className="text-[10px] uppercase tracking-wide text-rose-700/70">Before</div>
      <div />
      <div className="text-[10px] uppercase tracking-wide text-emerald-700/70">After</div>
      {keys.map((k) => {
        const b = before?.[k];
        const a = after?.[k];
        const changed = JSON.stringify(b) !== JSON.stringify(a);
        return (
          <div key={k} className="contents">
            <div
              className={cn(
                "truncate",
                changed ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {k}
            </div>
            <div
              className={cn(
                "truncate rounded px-1",
                changed ? "bg-rose-500/10 text-rose-800" : "text-muted-foreground",
              )}
            >
              {primitive(b)}
            </div>
            <ArrowRight
              className={cn(
                "h-3 w-3 self-center",
                changed ? "text-foreground" : "text-muted-foreground/40",
              )}
            />
            <div
              className={cn(
                "truncate rounded px-1",
                changed ? "bg-emerald-500/10 text-emerald-800" : "text-muted-foreground",
              )}
            >
              {primitive(a)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiffCard({ raw }: { raw: string }) {
  let d: any = null;
  try {
    d = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  if (!d || typeof d !== "object" || !d.action_id) {
    return <CopyableCodeBlock text={raw} />;
  }
  const actionId = String(d.action_id);
  const tool = String(d.tool ?? "erp_action");
  const target = String(d.target ?? "");
  const rolledBack = !!d.rolled_back;
  const rollbackHint = d.rollback_hint ? String(d.rollback_hint) : null;

  const requestUndo = () => {
    const text = `Please rollback action ${actionId} — this change was a mistake.`;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SUBMIT_EVENT, { detail: text }));
    }
  };

  return (
    <div
      className={cn(
        "my-2 rounded-xl border p-3 shadow-sm",
        rolledBack
          ? "border-muted bg-muted/30"
          : "border-primary/40 bg-gradient-to-br from-primary/5 to-transparent",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            rolledBack ? "bg-muted-foreground" : "bg-emerald-500",
          )}
        />
        <div className="text-[13px] font-semibold text-brand-navy">
          {rolledBack ? "Rolled back" : "Change applied"} · {tool.replace(/_/g, " ")}
        </div>
        {target && (
          <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-[45%]">
            {target}
          </span>
        )}
      </div>
      <DiffRows before={d.before} after={d.after} />
      <div className="mt-3 flex items-center gap-2">
        {rolledBack ? (
          <span className="text-[11px] text-muted-foreground italic">
            This action was already reverted.
          </span>
        ) : (
          <button
            type="button"
            onClick={requestUndo}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10 transition"
          >
            <Undo2 className="h-3 w-3" /> Undo this change
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(actionId);
            toast.success("Action ID copied");
          }}
          className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border border-border/60 bg-background/60 hover:bg-muted transition"
        >
          <Copy className="h-3 w-3" /> Copy action ID
        </button>
        {rollbackHint && !rolledBack && (
          <span className="text-[10px] text-muted-foreground ml-auto italic truncate">
            {rollbackHint}
          </span>
        )}
      </div>
    </div>
  );
}

function ValidationCard({ raw }: { raw: string }) {
  let d: any = null;
  try {
    d = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  if (!d || typeof d !== "object") {
    return <CopyableCodeBlock text={raw} />;
  }
  const tool = String(d.tool ?? "tool");
  const missing: string[] = Array.isArray(d.missing) ? d.missing.map(String) : [];
  const inconsistencies: string[] = Array.isArray(d.inconsistencies)
    ? d.inconsistencies.map(String)
    : [];
  const hint = d.hint ? String(d.hint) : null;

  const seedReply = () => {
    if (missing.length === 0) return;
    const stub = missing.map((f) => `- ${f}: `).join("\n");
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(SUBMIT_EVENT, {
          detail: `Here are the missing values for ${tool}:\n${stub}`,
        }),
      );
    }
  };

  return (
    <div className="my-2 rounded-xl border border-destructive/50 bg-destructive/5 p-3 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <div className="text-[13px] font-semibold text-destructive">
          Can't run {tool.replace(/_/g, " ")} yet — more info needed
        </div>
      </div>
      {missing.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Missing fields
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((f) => (
              <span
                key={f}
                className="inline-flex items-center rounded-md border border-destructive/40 bg-background/60 px-2 py-0.5 text-[11px] font-mono text-destructive"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
      {inconsistencies.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Inconsistencies
          </div>
          <ul className="list-disc pl-4 space-y-0.5 text-[12px] text-foreground">
            {inconsistencies.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {hint && (
        <div className="rounded-md bg-background/70 border border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground italic">
          {hint}
        </div>
      )}
      {missing.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={seedReply}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-destructive/40 bg-background text-destructive hover:bg-destructive/10 transition"
          >
            Reply with these fields
          </button>
        </div>
      )}
    </div>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-table:my-2 prose-pre:p-0 prose-pre:bg-transparent">
      <ReactMarkdown
        components={{
          pre: ({ children }) => {
            // Extract raw text + language from the inner <code> block
            const child: any = Array.isArray(children) ? children[0] : children;
            const cls: string = child?.props?.className ?? "";
            const txt =
              typeof child?.props?.children === "string"
                ? child.props.children
                : Array.isArray(child?.props?.children)
                  ? child.props.children.join("")
                  : "";
            const raw = String(txt).replace(/\n$/, "");
            if (/language-proposal/.test(cls)) return <ProposalCard raw={raw} />;
            if (/language-diff/.test(cls)) return <DiffCard raw={raw} />;
            if (/language-validation/.test(cls)) return <ValidationCard raw={raw} />;
            return <CopyableCodeBlock text={raw} />;
          },
          code: ({ inline, children, ...rest }: any) =>
            inline ? (
              <code className="px-1 py-0.5 rounded bg-muted text-[12px] font-mono" {...rest}>
                {children}
              </code>
            ) : (
              <code {...rest}>{children}</code>
            ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border px-2 py-1 bg-muted/60 text-left">{children}</th>
          ),
          td: ({ children }) => <td className="border px-2 py-1 align-top">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/* ─────────────────── main panel ─────────────────── */

export default function PreciseAssistantPanel() {
  const { open, setOpen, currentBookingId, currentBookingLabel, consumeSeedPrompt } =
    useAssistant();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [input, setInput] = useState("");
  const [snapshot, setSnapshot] = useState<ERPSnapshot | null>(null);
  const [snapErr, setSnapErr] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [memory, setMemory] = useState<ConversationMemory>(EMPTY_MEMORY);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Refresh snapshot when panel opens or current booking changes
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSnapErr(null);
    buildSnapshot(currentBookingId)
      .then((s) => {
        if (!cancelled) setSnapshot(s);
      })
      .catch((e) => {
        if (!cancelled) setSnapErr(e?.message ?? "Failed to load ERP snapshot");
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentBookingId]);

  // Load persisted history on mount and whenever the auth identity changes
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    loadStoredHistory()
      .then((msgs) => {
        if (!cancelled) setMessages(msgs);
      })
      .catch(() => {
        /* keep empty */
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        loadStoredHistory()
          .then((msgs) => {
            if (!cancelled) setMessages(msgs);
          })
          .catch(() => {});
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load persistent conversation memory on mount and after auth change.
  useEffect(() => {
    let cancelled = false;
    loadMemory()
      .then((m) => {
        if (!cancelled) setMemory(m);
      })
      .catch(() => {});
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        loadMemory()
          .then((m) => {
            if (!cancelled) setMemory(m);
          })
          .catch(() => {});
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  // Focus textarea on open & after sends
  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 60);
  }, [open]);

  // Apply incoming seed prompt (e.g. from Quick Actions outside the panel)
  useEffect(() => {
    if (!open) return;
    const seed = consumeSeedPrompt();
    if (seed) setInput(seed);
  }, [open, consumeSeedPrompt]);

  // Listen for Undo-button clicks inside DiffCard: enqueue a follow-up user
  // turn that asks the bot to rollback the specific action_id. We can't
  // reference send() here directly (forward decl), so we stash it on a ref.
  const sendRef = useRef<(text: string) => void>(() => {});
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (typeof detail !== "string" || !detail.trim()) return;
      sendRef.current(detail);
    };
    window.addEventListener(SUBMIT_EVENT, handler);
    return () => window.removeEventListener(SUBMIT_EVENT, handler);
  }, []);

  const greeting = useMemo(
    () => welcome(snapshot, currentBookingLabel),
    [snapshot, currentBookingLabel],
  );

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || streaming) return;
      if (!snapshot) {
        toast.error("Snapshot not ready yet");
        return;
      }
      setInput("");
      const ctxBookingId = currentBookingId ?? null;
      const ctxBookingLabel = currentBookingLabel ?? null;
      const userMsg: Msg = {
        role: "user",
        content: text,
        at: Date.now(),
        bookingId: ctxBookingId,
        bookingLabel: ctxBookingLabel,
      };
      const next = [...messages, userMsg];
      setMessages([
        ...next,
        {
          role: "assistant",
          content: "",
          at: Date.now(),
          bookingId: ctxBookingId,
          bookingLabel: ctxBookingLabel,
        },
      ]);
      setStreaming(true);
      // Persist the user turn immediately so it survives refresh mid-stream
      void persistMessage(userMsg, next);

      // Update conversation memory from the user's turn AND merge the current
      // booking context (opened via the app UI) as a first-class entity so
      // the model can reason across "the client I'm viewing" ↔ prior turns.
      let memAfterUser = extractEntities(memory, text);
      if (ctxBookingId)
        memAfterUser = extractEntities(
          memAfterUser,
          `**${ctxBookingLabel ?? ctxBookingId}** ${ctxBookingId}`,
        );
      const ambiguities = detectAmbiguity(memAfterUser, text);
      // Merge any auto-detected ambiguities into memory so the server prompt
      // gets a "PLEASE CLARIFY" hint alongside the entity list.
      const memToSend: ConversationMemory = ambiguities.length
        ? { ...memAfterUser, updatedAt: Date.now() }
        : memAfterUser;
      setMemory(memAfterUser);
      void saveMemory(memAfterUser);

      const ac = new AbortController();
      abortRef.current = ac;
      let finalText = "";
      let aborted = false;
      try {
        const sentAttachments = attachments;
        setAttachments([]);
        const memoryForRequest: ConversationMemory = ambiguities.length ? memToSend : memAfterUser;
        const res = await postChat(
          next,
          snapshot,
          sentAttachments,
          memoryForRequest,
          ambiguities,
          ac.signal,
        );
        if (!res.ok || !res.body) {
          let msg = `Request failed (${res.status})`;
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          setMessages((m) => {
            const copy = m.slice();
            copy[copy.length - 1] = {
              role: "assistant",
              content: acc,
              at: Date.now(),
              bookingId: ctxBookingId,
              bookingLabel: ctxBookingLabel,
            };
            return copy;
          });
        }
        finalText = acc;
      } catch (e: any) {
        aborted = e?.name === "AbortError";
        const errText = aborted
          ? "_Stopped._"
          : `I'm having trouble connecting. ${e?.message ?? "Please try again in a moment."}`;
        finalText = errText;
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = {
            role: "assistant",
            content: errText,
            at: Date.now(),
            bookingId: ctxBookingId,
            bookingLabel: ctxBookingLabel,
          };
          return copy;
        });
      } finally {
        setStreaming(false);
        abortRef.current = null;
        setTimeout(() => textareaRef.current?.focus(), 30);
        // Persist the final assistant message (skip empty)
        if (finalText && !aborted) {
          const assistantMsg: Msg = {
            role: "assistant",
            content: finalText,
            at: Date.now(),
            bookingId: ctxBookingId,
            bookingLabel: ctxBookingLabel,
          };
          void persistMessage(assistantMsg, [...next, assistantMsg]);
          // Extract entities the assistant surfaced (booking_id, receipt_no,
          // client names bound to bookings) so the next turn can reason from them.
          const memAfterAssistant = extractEntities(memAfterUser, finalText);
          setMemory(memAfterAssistant);
          void saveMemory(memAfterAssistant);
        }
      }
    },
    [
      input,
      messages,
      snapshot,
      streaming,
      currentBookingId,
      currentBookingLabel,
      attachments,
      memory,
    ],
  );

  // Keep the ref in sync so the SUBMIT_EVENT listener always calls the
  // latest send() (which closes over the current messages/memory/snapshot).
  useEffect(() => {
    sendRef.current = (t: string) => {
      void send(t);
    };
  }, [send]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 4);
    for (const f of list) {
      if (!/^image\//.test(f.type)) {
        toast.error(`${f.name}: only JPG/PNG images supported`);
        continue;
      }
      if (f.size > 6 * 1024 * 1024) {
        toast.error(`${f.name}: max 6MB`);
        continue;
      }
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(f);
      });
      setAttachments((prev) =>
        prev.length >= 4 ? prev : [...prev, { name: f.name, dataUrl, mime: f.type, size: f.size }],
      );
    }
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const stop = () => abortRef.current?.abort();

  const clearChat = async () => {
    setMessages([]);
    setMemory(EMPTY_MEMORY);
    void clearMemory();
    try {
      await clearStoredHistory();
      toast.success("Conversation cleared");
    } catch {
      toast.error("Could not clear server history");
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const scopedMessages = (scope: "all" | "booking"): Msg[] => {
    if (scope === "all") return messages;
    if (!currentBookingId) return [];
    return messages.filter((m) => m.bookingId === currentBookingId);
  };

  const scopeFilenameTag = (scope: "all" | "booking") =>
    scope === "booking" && currentBookingId
      ? `_${String(currentBookingId).replace(/[^A-Za-z0-9_-]+/g, "-")}`
      : "";

  const exportJSON = (scope: "all" | "booking" = "all") => {
    const msgs = scopedMessages(scope);
    if (msgs.length === 0) {
      toast.error(
        scope === "booking"
          ? "No messages tagged to this booking yet"
          : "No conversation to export",
      );
      return;
    }
    const payload = {
      _meta: buildJsonExportMetadata({
        source:
          scope === "booking"
            ? `Precise Assistant — Conversation (booking ${currentBookingId ?? ""})`
            : "Precise Assistant — Conversation",
        extra: {
          scope,
          bookingContext: currentBookingLabel ?? undefined,
          bookingId: scope === "booking" ? (currentBookingId ?? undefined) : undefined,
        },
        counts: { shown: msgs.length, total: msgs.length },
        // Ordered columns describing the per-message record shape, so
        // downstream tooling can render/parse messages in a stable layout.
        columns: [
          { key: "id", label: "Message ID" },
          { key: "role", label: "Role" },
          { key: "createdAt", label: "Created At" },
          { key: "bookingId", label: "Booking ID" },
          { key: "content", label: "Content" },
        ],
      }),
      exportedAt: new Date().toISOString(),
      scope,
      bookingContext: currentBookingLabel ?? null,
      bookingId: scope === "booking" ? currentBookingId : null,
      messageCount: msgs.length,
      messages: msgs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const ts = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `precise-assistant${scopeFilenameTag(scope)}_${ts}.json`);
    toast.success("Exported JSON");
  };

  const exportPDF = async (scope: "all" | "booking" = "all") => {
    const msgs = scopedMessages(scope);
    if (msgs.length === 0) {
      toast.error(
        scope === "booking"
          ? "No messages tagged to this booking yet"
          : "No conversation to export",
      );
      return;
    }
    try {
      const [{ default: jsPDF }] = await Promise.all([import("jspdf")]);
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const margin = 40;
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const maxW = pageW - margin * 2;
      let y = margin;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(27, 43, 75);
      const title =
        scope === "booking"
          ? `Precise Assistant — ${currentBookingLabel ?? currentBookingId ?? "Booking"}`
          : "Precise Assistant — Conversation";
      doc.text(title, margin, y);
      y += 18;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(`Exported ${new Date().toLocaleString()}`, margin, y);
      y += 12;
      if (scope === "booking") {
        doc.text(`Scope: Current booking only (${currentBookingId ?? "—"})`, margin, y);
        y += 12;
      } else if (currentBookingLabel) {
        doc.text(`Context: ${currentBookingLabel}`, margin, y);
        y += 12;
      }
      doc.setDrawColor(220);
      doc.line(margin, y, pageW - margin, y);
      y += 14;

      const writeBlock = (label: string, body: string, color: [number, number, number]) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(...color);
        if (y > pageH - margin - 20) {
          doc.addPage();
          y = margin;
        }
        doc.text(label, margin, y);
        y += 12;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(30);
        const lines = doc.splitTextToSize(body || "—", maxW);
        for (const ln of lines) {
          if (y > pageH - margin) {
            doc.addPage();
            y = margin;
          }
          doc.text(ln, margin, y);
          y += 13;
        }
        y += 6;
      };

      for (const m of msgs) {
        const ts = new Date(m.at).toLocaleString();
        const tag = scope === "all" && m.bookingLabel ? ` · ${m.bookingLabel}` : "";
        const label = m.role === "user" ? `You · ${ts}${tag}` : `Assistant · ${ts}${tag}`;
        const color: [number, number, number] = m.role === "user" ? [201, 168, 76] : [27, 43, 75];
        writeBlock(label, m.content, color);
      }

      const ts = new Date().toISOString().slice(0, 10);
      doc.save(`precise-assistant${scopeFilenameTag(scope)}_${ts}.pdf`);
      toast.success("Exported PDF");
    } catch (e: any) {
      toast.error(`PDF export failed: ${e?.message ?? "unknown error"}`);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="bd"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-foreground/60"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* Panel */}
          <motion.aside
            key="pn"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed top-0 right-0 z-50 h-dvh w-full sm:w-[420px] bg-card border-l shadow-2xl flex flex-col"
            role="dialog"
            aria-label="Precise Assistant"
          >
            {/* Header */}
            <header className="px-4 py-3 border-b flex items-start gap-3">
              <motion.div
                animate={{ rotate: [0, 12, -6, 0] }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
                className="h-9 w-9 rounded-lg grid place-items-center"
                style={{ background: "var(--accent, #C9A84C)", color: "#1B2B4B" }}
              >
                <Sparkles className="h-4 w-4" />
              </motion.div>
              <div className="flex-1 min-w-0">
                <div
                  className="text-[15px] font-semibold leading-tight"
                  style={{ color: "#1B2B4B" }}
                >
                  ✦ Precise Assistant
                </div>
                <div className="text-[11px] text-muted-foreground">Your ERP Intelligence Layer</div>
                {currentBookingLabel && (
                  <div className="text-[11px] mt-1">
                    <span className="text-muted-foreground">Viewing: </span>
                    <span className="font-medium">{currentBookingLabel}</span>
                  </div>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 min-h-11 min-w-11"
                    title="Export conversation"
                    aria-label="Export conversation"
                    disabled={messages.length === 0}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem onClick={() => exportJSON("all")}>
                    <FileJson className="h-4 w-4 mr-2" /> Export all as JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportPDF("all")}>
                    <FileText className="h-4 w-4 mr-2" /> Export all as PDF
                  </DropdownMenuItem>
                  {currentBookingId && (
                    <>
                      <DropdownMenuItem onClick={() => exportJSON("booking")}>
                        <FileJson className="h-4 w-4 mr-2" />
                        <span className="truncate">
                          Only {currentBookingLabel ?? currentBookingId} (JSON)
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportPDF("booking")}>
                        <FileText className="h-4 w-4 mr-2" />
                        <span className="truncate">
                          Only {currentBookingLabel ?? currentBookingId} (PDF)
                        </span>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 min-h-11 min-w-11"
                title="Clear chat"
                aria-label="Clear chat"
                onClick={clearChat}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 min-h-11 min-w-11"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
              >
                <X className="h-4 w-4" />
              </Button>
            </header>

            {snapErr && (
              <div className="mx-3 mt-2 rounded-md border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" /> {snapErr}
              </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {historyLoading && messages.length === 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-2 px-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Restoring conversation…
                </div>
              )}
              {!historyLoading && messages.length === 0 && (
                <div className="rounded-lg bg-muted/40 border px-3 py-2.5">
                  <MarkdownMessage content={greeting} />
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[88%] rounded-lg px-3 py-2 text-sm",
                      m.role === "user" ? "bg-brand-gold text-brand-navy" : "bg-muted/40 border",
                    )}
                  >
                    {m.role === "assistant" ? (
                      m.content ? (
                        <MarkdownMessage content={m.content} />
                      ) : (
                        <TypingDots />
                      )
                    ) : (
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    )}
                    <div
                      className={cn(
                        "text-[10px] mt-1",
                        m.role === "user"
                          ? "text-brand-navy/60 text-right"
                          : "text-muted-foreground",
                      )}
                    >
                      {new Date(m.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick chips */}
            <div className="px-3 pb-2 overflow-x-auto">
              <div className="flex gap-1.5 w-max">
                {QUICK_CHIPS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => send(c)}
                    disabled={streaming}
                    className="shrink-0 text-[11px] rounded-full border px-2.5 py-1 bg-card hover:bg-muted transition disabled:opacity-40"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Input */}
            <div className="border-t p-2.5">
              {attachments.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-2">
                  {attachments.map((a, i) => (
                    <div
                      key={i}
                      className="relative group border rounded-lg overflow-hidden w-16 h-16 bg-muted"
                    >
                      <img src={a.dataUrl} alt={a.name} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-foreground/70 text-background grid place-items-center opacity-0 group-hover:opacity-100"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="relative">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  onPaste={(e) => {
                    const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) =>
                      /^image\//.test(f.type),
                    );
                    if (imgs.length) {
                      e.preventDefault();
                      void addFiles(imgs);
                    }
                  }}
                  rows={1}
                  placeholder={
                    attachments.length
                      ? "Describe what to do with the attached slip…"
                      : "Ask anything, or attach a payment slip / cheque photo…"
                  }
                  className="min-h-[42px] max-h-[120px] resize-none pr-20 pl-10 text-sm"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) void addFiles(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute left-1 bottom-1.5 h-8 w-8 min-h-11 min-w-11"
                  title="Attach image (bank slip, cheque, screenshot)"
                  aria-label="Attach image"
                  disabled={streaming || attachments.length >= 4}
                >
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  size="icon"
                  onClick={() => (streaming ? stop() : send())}
                  className="absolute right-1.5 bottom-1.5 h-8 w-8 min-h-11 min-w-11"
                  style={{ background: "#C9A84C", color: "#1B2B4B" }}
                  title={streaming ? "Stop" : "Send (Enter)"}
                  aria-label={streaming ? "Stop response" : "Send message"}
                >
                  {streaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 px-1 flex items-center gap-2">
                <ImageIcon className="h-3 w-3" />
                <span>
                  Attach a slip / cheque photo — the assistant reads it and drafts a payment
                  proposal for you to confirm.
                </span>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1.5" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "#C9A84C" }}
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12 }}
        />
      ))}
    </div>
  );
}

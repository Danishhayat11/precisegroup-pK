/* allow-raw-color-file: dedicated slate/emerald IDE-style dark surface for the code debugger, intentionally independent of the ERP's semantic theme tokens */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Copy,
  Gauge,
  Loader2,
  Play,
  Sparkles,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  analyzeCode,
  SUPPORTED_LANGUAGES,
  type AnalysisReport,
  type Category,
  type Diagnostic,
  type Severity,
  type SupportedLanguage,
} from "@/lib/debugger.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { easeSignature } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/debugger")({
  head: () => ({
    meta: [
      { title: "Code Debugger — Precise ERP" },
      {
        name: "description",
        content:
          "AI-powered code analysis: syntax, logic, and performance diagnostics with side-by-side fixes.",
      },
    ],
  }),
  component: DebuggerPage,
});

// -----------------------------------------------------------------------------
// Sample seed so first-run isn't empty.
// -----------------------------------------------------------------------------
const SAMPLE_CODE = `function findUser(users, id) {
  for (let i = 0; i <= users.length; i++) {
    if (users[i].id == id) {
      return users[i]
    }
  }
}

async function loadAll(ids) {
  const results = []
  for (const id of ids) {
    const u = await findUser(await fetchUsers(), id)
    results.push(u)
  }
  return results
}`;

// -----------------------------------------------------------------------------
// Palette + presentational helpers.
// -----------------------------------------------------------------------------
const SEVERITY_STYLES: Record<Severity, { badge: string; ring: string; label: string }> = {
  critical: {
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    ring: "ring-rose-500/40",
    label: "Critical",
  },
  high: {
    badge: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    ring: "ring-orange-500/40",
    label: "High",
  },
  medium: {
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    ring: "ring-amber-500/40",
    label: "Medium",
  },
  low: {
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    ring: "ring-emerald-500/40",
    label: "Low",
  },
  info: {
    badge: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    ring: "ring-sky-500/40",
    label: "Info",
  },
};

const CATEGORY_META: Record<Category, { icon: typeof Bug; label: string; accent: string }> = {
  syntax: { icon: Terminal, label: "Syntax", accent: "text-rose-300" },
  logic: { icon: Bug, label: "Logic", accent: "text-amber-300" },
  performance: { icon: Gauge, label: "Performance", accent: "text-emerald-300" },
};

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------
function DebuggerPage() {
  const [language, setLanguage] = useState<SupportedLanguage>("javascript");
  const [code, setCode] = useState(SAMPLE_CODE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showFixAll, setShowFixAll] = useState(false);

  const analyzeFn = useServerFn(analyzeCode);
  const mutation = useMutation({
    mutationFn: (input: { code: string; language: SupportedLanguage }) =>
      analyzeFn({ data: input }),
    onSuccess: (r) => {
      setSelectedId(r.diagnostics[0]?.id ?? null);
      toast.success(
        r.diagnostics.length === 0
          ? "No issues found — clean code."
          : `Found ${r.diagnostics.length} issue${r.diagnostics.length === 1 ? "" : "s"}.`,
      );
    },
    onError: (e: Error) => toast.error(e.message || "Analysis failed."),
  });

  const report = mutation.data;
  const selected =
    report?.diagnostics.find((d) => d.id === selectedId) ?? report?.diagnostics[0] ?? null;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-100">
      {/* Ambient mesh gradient — pure decoration, no layout impact */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(60rem 40rem at 15% -10%, rgba(16,185,129,0.12), transparent 60%), radial-gradient(50rem 35rem at 90% 110%, rgba(56,189,248,0.08), transparent 60%)",
        }}
      />

      <div className="mx-auto flex max-w-[110rem] flex-col gap-6 px-4 py-6 md:px-8">
        <PageHeader
          language={language}
          onLanguageChange={setLanguage}
          onRun={() => mutation.mutate({ code, language })}
          onFixAll={() => setShowFixAll(true)}
          hasReport={!!report && report.diagnostics.length > 0}
          loading={mutation.isPending}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Editor code={code} onChange={setCode} loading={mutation.isPending} />
          <AnalysisPanel
            loading={mutation.isPending}
            report={report ?? null}
            selected={selected}
            onSelect={setSelectedId}
          />
        </div>
      </div>

      <FixAllDialog
        open={showFixAll}
        onOpenChange={setShowFixAll}
        language={language}
        fixedCode={report?.fixedCode ?? ""}
        onReplace={() => {
          if (report?.fixedCode) {
            setCode(report.fixedCode);
            setShowFixAll(false);
            toast.success("Editor updated with refactored code.");
          }
        }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------
function PageHeader({
  language,
  onLanguageChange,
  onRun,
  onFixAll,
  hasReport,
  loading,
}: {
  language: SupportedLanguage;
  onLanguageChange: (l: SupportedLanguage) => void;
  onRun: () => void;
  onFixAll: () => void;
  hasReport: boolean;
  loading: boolean;
}) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
          <Sparkles className="h-5 w-5 text-emerald-300" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">
            Code Debugger
          </h1>
          <p className="truncate text-sm text-slate-400">
            AI static analysis · syntax, logic &amp; performance
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Select value={language} onValueChange={(v) => onLanguageChange(v as SupportedLanguage)}>
          <SelectTrigger className="h-10 w-36 border-slate-700/70 bg-slate-900/70 text-slate-100 backdrop-blur">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-slate-700 bg-slate-900 text-slate-100">
            {SUPPORTED_LANGUAGES.map((l) => (
              <SelectItem key={l} value={l} className="capitalize focus:bg-slate-800">
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={!hasReport}
          onClick={onFixAll}
          className="h-10 border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800 hover:text-white"
        >
          <Zap className="mr-2 h-4 w-4" /> Fix All
        </Button>
        <Button
          onClick={onRun}
          disabled={loading}
          className="h-10 bg-emerald-500 text-slate-950 shadow-[0_10px_30px_-12px_rgba(16,185,129,0.7)] hover:bg-emerald-400"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Analyze
        </Button>
      </div>
    </header>
  );
}

// -----------------------------------------------------------------------------
// Editor (textarea + synced gutter). Deliberately dependency-free so the
// tool stays fast — full-fat editors add ~1MB.
// -----------------------------------------------------------------------------
function Editor({
  code,
  onChange,
  loading,
}: {
  code: string;
  onChange: (v: string) => void;
  loading: boolean;
}) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = useMemo(() => Math.max(code.split("\n").length, 1), [code]);
  const lines = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1), [lineCount]);

  return (
    <section
      aria-label="Code editor"
      className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl"
    >
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-950/60 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          <span className="ml-3 font-mono uppercase tracking-widest text-slate-500">
            source.input
          </span>
        </div>
        {loading ? (
          <span className="flex items-center gap-2 text-xs text-emerald-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> analyzing…
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-[3rem_1fr]">
        <div
          ref={gutterRef}
          aria-hidden
          className="max-h-[70vh] overflow-hidden bg-slate-950/40 py-4 text-right font-mono text-xs leading-6 text-slate-600"
        >
          {lines.map((n) => (
            <div key={n} className="px-2">
              {n}
            </div>
          ))}
        </div>
        <textarea
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          spellCheck={false}
          className="max-h-[70vh] min-h-[24rem] w-full resize-none bg-transparent px-4 py-4 font-mono text-sm leading-6 text-emerald-100/90 caret-emerald-400 outline-none placeholder:text-slate-600"
          placeholder="// Paste code here…"
        />
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Analysis panel
// -----------------------------------------------------------------------------
function AnalysisPanel({
  loading,
  report,
  selected,
  onSelect,
}: {
  loading: boolean;
  report: AnalysisReport | null;
  selected: Diagnostic | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section
      aria-label="Analysis"
      className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl md:p-5"
    >
      {loading && !report ? (
        <LoadingSkeleton />
      ) : !report ? (
        <EmptyState />
      ) : (
        <>
          <ReportSummary report={report} />
          <DiagnosticList
            diagnostics={report.diagnostics}
            selectedId={selected?.id ?? null}
            onSelect={onSelect}
          />
          {selected ? <ProblemSolution diag={selected} /> : null}
        </>
      )}
    </section>
  );
}

function ReportSummary({ report }: { report: AnalysisReport }) {
  const counts = useMemo(() => {
    const c: Record<Category, number> = { syntax: 0, logic: 0, performance: 0 };
    for (const d of report.diagnostics) c[d.category] += 1;
    return c;
  }, [report.diagnostics]);

  const clean = report.diagnostics.length === 0;

  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-4">
      <div className="flex items-start gap-3">
        {clean ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
        ) : (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        )}
        <p className="text-sm leading-relaxed text-slate-300">{report.summary}</p>
      </div>
      {!clean ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["syntax", "logic", "performance"] as const).map((cat) => {
            const M = CATEGORY_META[cat];
            const Icon = M.icon;
            return (
              <div
                key={cat}
                className="flex items-center gap-2 rounded-lg border border-slate-800/70 bg-slate-900/60 px-3 py-2"
              >
                <Icon className={cn("h-4 w-4", M.accent)} />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">
                    {M.label}
                  </div>
                  <div className="text-sm font-semibold text-slate-100">{counts[cat]}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DiagnosticList({
  diagnostics,
  selectedId,
  onSelect,
}: {
  diagnostics: Diagnostic[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (diagnostics.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {diagnostics.map((d) => {
        const M = CATEGORY_META[d.category];
        const S = SEVERITY_STYLES[d.severity];
        const active = d.id === selectedId;
        const Icon = M.icon;
        return (
          <li key={d.id}>
            <button
              onClick={() => onSelect(d.id)}
              className={cn(
                "group grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200",
                "hover:-translate-y-px hover:border-emerald-500/40 hover:bg-slate-900/80",
                active
                  ? "border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/30"
                  : "border-slate-800/70 bg-slate-950/40",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", M.accent)} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-100">{d.title}</div>
                <div className="truncate text-xs text-slate-500">
                  Line {d.line} · {M.label}
                </div>
              </div>
              <Badge
                variant="outline"
                className={cn("shrink-0 text-[10px] uppercase tracking-wider", S.badge)}
              >
                {S.label}
              </Badge>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ProblemSolution({ diag }: { diag: Diagnostic }) {
  return (
    <AnimatePresence mode="wait">
      <motion.article
        key={diag.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.25, ease: easeSignature }}
        className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-4"
      >
        <header className="mb-3 flex items-start gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">{diag.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{diag.explanation}</p>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <CodeBlock label="Problem" tone="bad" code={diag.faultySnippet} />
          <CodeBlock label="Solution" tone="good" code={diag.fixedSnippet} />
        </div>
      </motion.article>
    </AnimatePresence>
  );
}

function CodeBlock({ label, tone, code }: { label: string; tone: "good" | "bad"; code: string }) {
  const toneClass =
    tone === "good"
      ? "border-emerald-500/30 bg-emerald-500/[0.04]"
      : "border-rose-500/30 bg-rose-500/[0.04]";
  const dot = tone === "good" ? "bg-emerald-400" : "bg-rose-400";
  return (
    <div className={cn("overflow-hidden rounded-lg border", toneClass)}>
      <div className="flex items-center justify-between border-b border-slate-800/60 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
          <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
            {label}
          </span>
        </div>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => toast.success("Copied"));
          }}
          className="text-slate-500 transition-colors hover:text-slate-200"
          aria-label="Copy snippet"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-xs leading-6 text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid flex-1 place-items-center py-16 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-800/60 ring-1 ring-slate-700/60">
          <Bug className="h-5 w-5 text-emerald-300" />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-slate-100">Ready when you are</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Paste a snippet, pick a language, then hit{" "}
          <span className="font-medium text-emerald-300">Analyze</span>. Findings appear here with
          side-by-side fixes.
        </p>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-20 animate-pulse rounded-xl bg-slate-800/40" />
      <div className="h-14 animate-pulse rounded-xl bg-slate-800/40" />
      <div className="h-14 animate-pulse rounded-xl bg-slate-800/30" />
      <div className="h-40 animate-pulse rounded-xl bg-slate-800/30" />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Fix-all dialog
// -----------------------------------------------------------------------------
function FixAllDialog({
  open,
  onOpenChange,
  language,
  fixedCode,
  onReplace,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  language: SupportedLanguage;
  fixedCode: string;
  onReplace: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-slate-800 bg-slate-950 text-slate-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-50">
            <Zap className="h-4 w-4 text-emerald-300" /> Refactored code
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            A clean version of the entire snippet with every diagnostic addressed.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-lg border border-emerald-500/20 bg-slate-900/70">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500">
            <span>fixed · {language}</span>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(fixedCode).then(() => toast.success("Copied"));
              }}
              className="text-slate-500 transition-colors hover:text-slate-200"
              aria-label="Copy refactored code"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <pre className="max-h-[55vh] overflow-auto px-4 py-3 font-mono text-xs leading-6 text-emerald-100/90">
            <code>{fixedCode}</code>
          </pre>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <X className="mr-2 h-4 w-4" /> Close
          </Button>
          <Button
            onClick={onReplace}
            disabled={!fixedCode}
            className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"
          >
            Replace editor content
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

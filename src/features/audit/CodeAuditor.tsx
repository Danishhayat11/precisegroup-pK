import { useMemo, useState, useCallback, useEffect } from "react";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-sql";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  Sparkles,
  History as HistoryIcon,
  FileCode2,
  Undo2,
  Play,
  Copy,
  Check,
  GitCompare,
  Zap,
} from "lucide-react";
import { analyze, applyFix } from "./analyzer";
import { SAMPLES } from "./samples";
import type { Issue, Language, ResolvedIssue, Severity } from "./types";

/* -------------------------------------------------------------- tokens */

const SEV: Record<
  Severity,
  { label: string; ring: string; bg: string; text: string; dot: string; icon: typeof Info }
> = {
  error: {
    label: "Error",
    ring: "ring-1 ring-[#ff5a3c]/40",
    bg: "bg-[#ff5a3c]/10",
    text: "text-[#ff8a6a]",
    dot: "bg-[#ff5a3c] shadow-[0_0_12px_#ff5a3c]",
    icon: AlertOctagon,
  },
  warning: {
    label: "Warning",
    ring: "ring-1 ring-[#f5c451]/40",
    bg: "bg-[#f5c451]/10",
    text: "text-[#f5d27a]",
    dot: "bg-[#f5c451] shadow-[0_0_12px_#f5c451]",
    icon: AlertTriangle,
  },
  info: {
    label: "Info",
    ring: "ring-1 ring-[#5ad1ff]/40",
    bg: "bg-[#5ad1ff]/10",
    text: "text-[#8fdfff]",
    dot: "bg-[#5ad1ff] shadow-[0_0_12px_#5ad1ff]",
    icon: Info,
  },
};

const LANGS: {
  value: Language;
  label: string;
  hint: string;
  grammar: keyof typeof Prism.languages;
}[] = [
  { value: "javascript", label: "JavaScript", hint: "js", grammar: "javascript" },
  { value: "typescript", label: "TypeScript", hint: "ts", grammar: "typescript" },
  { value: "python", label: "Python", hint: "py", grammar: "python" },
  { value: "java", label: "Java", hint: "java", grammar: "java" },
  { value: "csharp", label: "C#", hint: "cs", grammar: "csharp" },
  { value: "go", label: "Go", hint: "go", grammar: "go" },
  { value: "rust", label: "Rust", hint: "rs", grammar: "rust" },
  { value: "ruby", label: "Ruby", hint: "rb", grammar: "ruby" },
  { value: "php", label: "PHP", hint: "php", grammar: "php" },
  { value: "sql", label: "SQL", hint: "sql", grammar: "sql" },
];

/* -------------------------------------------------------- main component */

type Tab = "issues" | "diff" | "history";

export function CodeAuditor() {
  // Editor + diff-viewer touch `document` at mount; defer render to client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [language, setLanguage] = useState<Language>("javascript");
  const [code, setCode] = useState<string>(SAMPLES.javascript);
  const [lastAppliedFrom, setLastAppliedFrom] = useState<string | null>(null);
  const [history, setHistory] = useState<ResolvedIssue[]>([]);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("issues");
  const [copied, setCopied] = useState(false);

  const issues = useMemo(() => analyze(code, language), [code, language]);
  const activeIssue = issues.find((i) => i.id === activeIssueId) ?? null;

  const counts = useMemo(
    () =>
      issues.reduce((acc, i) => ({ ...acc, [i.severity]: acc[i.severity] + 1 }), {
        error: 0,
        warning: 0,
        info: 0,
      } as Record<Severity, number>),
    [issues],
  );

  const onLanguageChange = useCallback((next: Language) => {
    setLanguage(next);
    setCode(SAMPLES[next]);
    setLastAppliedFrom(null);
    setActiveIssueId(null);
    setTab("issues");
  }, []);

  const onApplyFix = useCallback(
    (issue: Issue) => {
      const before = code;
      const after = applyFix(code, issue);
      if (after === before) return;
      setLastAppliedFrom(before);
      setCode(after);
      setHistory((h) =>
        [
          {
            issueId: issue.id,
            title: issue.title,
            severity: issue.severity,
            resolvedAt: Date.now(),
          },
          ...h,
        ].slice(0, 40),
      );
      setActiveIssueId(null);
      setTab("diff");
    },
    [code],
  );

  const onUndo = useCallback(() => {
    if (lastAppliedFrom == null) return;
    setCode(lastAppliedFrom);
    setLastAppliedFrom(null);
    setHistory((h) => h.slice(1));
    setTab("issues");
  }, [lastAppliedFrom]);

  const onFixAll = useCallback(() => {
    let next = code;
    const applied: ResolvedIssue[] = [];
    for (const iss of issues) {
      const attempt = applyFix(next, iss);
      if (attempt !== next) {
        next = attempt;
        applied.push({
          issueId: iss.id,
          title: iss.title,
          severity: iss.severity,
          resolvedAt: Date.now(),
        });
      }
    }
    if (applied.length === 0) return;
    setLastAppliedFrom(code);
    setCode(next);
    setHistory((h) => [...applied, ...h].slice(0, 40));
    setActiveIssueId(null);
    setTab("diff");
  }, [code, issues]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }, [code]);

  const highlight = useCallback(
    (input: string) => {
      const grammarKey = LANGS.find((l) => l.value === language)?.grammar ?? "javascript";
      const grammar = Prism.languages[grammarKey] ?? Prism.languages.javascript;
      const html = Prism.highlight(input, grammar, String(grammarKey));
      const activeLine = activeIssue?.line;
      if (!activeLine) return html;
      return html
        .split("\n")
        .map((row, i) =>
          i + 1 === activeLine ? `<span class="au-active-line">${row || " "}</span>` : row,
        )
        .join("\n");
    },
    [language, activeIssue],
  );

  const totalLines = code.split("\n").length;

  return (
    <div className="min-h-dvh bg-[#0a0a0d] text-zinc-200 font-sans antialiased">
      <style>{`
        .au-active-line {
          display: inline-block;
          width: 100%;
          background: linear-gradient(90deg, rgba(232,93,58,0.22), rgba(232,93,58,0.02));
          box-shadow: inset 3px 0 0 #e85d3a;
        }
        .au-editor textarea:focus { outline: none; }
        .au-editor pre, .au-editor textarea {
          font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace !important;
          font-size: 13.5px !important;
          line-height: 1.65 !important;
          tab-size: 2;
        }
        .au-editor textarea { caret-color: #ff8a6a; }
      `}</style>

      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0a0d]/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-[#e85d3a] to-[#ff8a6a] text-[#0a0a0d] shadow-[0_0_24px_-4px_#e85d3a]"
            >
              <Zap className="size-4" strokeWidth={2.4} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-mono text-[13px] font-semibold tracking-wide text-zinc-100">
                CODE&nbsp;AUDITOR
              </h1>
              <p className="truncate text-[10.5px] uppercase tracking-[0.22em] text-zinc-500">
                Static analysis · one-click fixes
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SeverityChip severity="error" count={counts.error} />
            <SeverityChip severity="warning" count={counts.warning} />
            <SeverityChip severity="info" count={counts.info} />
          </div>
        </div>

        <div className="mx-auto flex flex-wrap items-center gap-2 border-t border-white/5 px-4 py-2 sm:px-6">
          <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            <FileCode2 className="size-3.5" /> Language
          </span>
          <div className="flex flex-wrap gap-0.5 rounded-md ring-1 ring-white/10 p-0.5 bg-white/[0.02]">
            {LANGS.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => onLanguageChange(l.value)}
                className={`rounded px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  language === l.value
                    ? "bg-[#e85d3a] text-[#0a0a0d]"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-[12px] text-zinc-300 ring-1 ring-white/10 hover:bg-white/5"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={onUndo}
              disabled={lastAppliedFrom == null}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-[12px] text-zinc-300 ring-1 ring-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Undo2 className="size-3.5" /> Undo fix
            </button>
            <button
              type="button"
              onClick={onFixAll}
              disabled={issues.length === 0}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[#e85d3a] px-3 text-[12px] font-semibold text-[#0a0a0d] shadow-[0_0_18px_-4px_#e85d3a] hover:brightness-110 disabled:bg-white/5 disabled:text-zinc-500 disabled:shadow-none"
            >
              <Sparkles className="size-3.5" /> Fix all ({issues.length})
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section
          aria-label="Code editor"
          className="rounded-xl bg-[#0f0f14] ring-1 ring-white/10 shadow-[0_30px_80px_-40px_rgba(232,93,58,0.35)]"
        >
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              source.{LANGS.find((l) => l.value === language)!.hint}
            </span>
            <span className="font-mono text-[11px] text-zinc-600">
              {totalLines} lines · {code.length} chars
            </span>
          </div>
          <div className="au-editor relative overflow-auto max-h-[calc(100dvh-260px)]">
            {mounted ? (
              <>
                <Editor
                  value={code}
                  onValueChange={(v) => setCode(v)}
                  highlight={highlight}
                  padding={{ top: 16, right: 16, bottom: 24, left: 56 }}
                  textareaId="code-input"
                  textareaClassName="!bg-transparent"
                  className="min-h-[420px] text-zinc-100"
                  style={{ background: "transparent" }}
                  preClassName="!bg-transparent"
                />
                <Gutter lines={totalLines} activeLine={activeIssue?.line ?? null} />
              </>
            ) : (
              <pre className="min-h-[420px] whitespace-pre-wrap p-4 font-mono text-[13.5px] text-zinc-500">
                {code}
              </pre>
            )}
          </div>
        </section>

        <section
          aria-label="Analysis and fixes"
          className="rounded-xl bg-[#0f0f14] ring-1 ring-white/10"
        >
          <div className="flex items-center gap-1 border-b border-white/5 p-1.5">
            <TabButton
              active={tab === "issues"}
              onClick={() => setTab("issues")}
              icon={<Play className="size-3.5" />}
            >
              Issues ({issues.length})
            </TabButton>
            <TabButton
              active={tab === "diff"}
              onClick={() => setTab("diff")}
              icon={<GitCompare className="size-3.5" />}
            >
              Diff view
            </TabButton>
            <TabButton
              active={tab === "history"}
              onClick={() => setTab("history")}
              icon={<HistoryIcon className="size-3.5" />}
            >
              History ({history.length})
            </TabButton>
          </div>
          <div className="max-h-[calc(100dvh-260px)] overflow-auto p-3">
            {tab === "issues" && (
              <IssuesList
                issues={issues}
                activeId={activeIssueId}
                onSelect={setActiveIssueId}
                onApply={onApplyFix}
              />
            )}
            {tab === "diff" && mounted && (
              <DiffPane
                oldCode={lastAppliedFrom ?? code}
                newCode={code}
                unchanged={lastAppliedFrom == null}
              />
            )}
            {tab === "history" && <HistoryList history={history} />}
          </div>
        </section>
      </main>
    </div>
  );
}

/* ---------------------------------------------------- presentational bits */

function SeverityChip({ severity, count }: { severity: Severity; count: number }) {
  const s = SEV[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] ${s.bg} ${s.text} ${s.ring}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {count} {s.label.toLowerCase()}
      {count === 1 ? "" : "s"}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition-colors ${
        active
          ? "bg-white/[0.06] text-zinc-100 ring-1 ring-white/10"
          : "text-zinc-500 hover:text-zinc-200"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Gutter({ lines, activeLine }: { lines: number; activeLine: number | null }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0 w-10 select-none border-r border-white/5 text-right font-mono text-[12px] leading-[1.65] text-zinc-600"
      style={{ paddingTop: 16 }}
    >
      {Array.from({ length: lines }, (_, i) => {
        const n = i + 1;
        return (
          <div key={n} className={`px-2 ${n === activeLine ? "text-[#ff8a6a] font-semibold" : ""}`}>
            {n}
          </div>
        );
      })}
    </div>
  );
}

function IssuesList({
  issues,
  activeId,
  onSelect,
  onApply,
}: {
  issues: Issue[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onApply: (issue: Issue) => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="grid place-items-center py-16 text-center">
        <div className="grid size-14 place-items-center rounded-full bg-[#1b3f2b] text-[#73ffb8] ring-1 ring-[#73ffb8]/30 shadow-[0_0_28px_-4px_#73ffb8]">
          <Check className="size-6" />
        </div>
        <p className="mt-4 font-mono text-[13px] text-zinc-300">No issues detected.</p>
        <p className="mt-1 text-[12px] text-zinc-500">
          Edit the source or switch language to re-scan.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {issues.map((iss) => {
        const s = SEV[iss.severity];
        const Icon = s.icon;
        const isActive = iss.id === activeId;
        return (
          <li key={iss.id}>
            <button
              type="button"
              onClick={() => onSelect(iss.id)}
              className={`group block w-full rounded-lg bg-white/[0.02] p-3 text-left ring-1 transition-colors ${
                isActive
                  ? "ring-[#e85d3a]/60 bg-[#e85d3a]/[0.06]"
                  : "ring-white/10 hover:ring-white/20"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-md ${s.bg} ${s.text}`}
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`font-mono text-[10.5px] uppercase tracking-[0.16em] ${s.text}`}
                    >
                      {s.label} · {iss.category}
                    </span>
                    <span className="font-mono text-[10.5px] text-zinc-500">line {iss.line}</span>
                  </div>
                  <p className="mt-1 text-[13.5px] font-medium text-zinc-100">{iss.title}</p>
                  {isActive && (
                    <>
                      <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-400">
                        {iss.rootCause}
                      </p>
                      <div className="mt-3 grid gap-2 rounded-md bg-black/40 p-2 ring-1 ring-white/5">
                        <code className="whitespace-pre-wrap break-words font-mono text-[11.5px] text-[#ff8a6a] line-through decoration-[#ff5a3c]/60">
                          {iss.match.trim()}
                        </code>
                        <code className="whitespace-pre-wrap break-words font-mono text-[11.5px] text-[#73ffb8]">
                          {iss.replacement.trim()}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onApply(iss);
                        }}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[#e85d3a] px-3 py-1.5 text-[12px] font-semibold text-[#0a0a0d] shadow-[0_0_18px_-4px_#e85d3a] hover:brightness-110"
                      >
                        <Sparkles className="size-3.5" />
                        {iss.fixLabel ?? "One-click fix"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DiffPane({
  oldCode,
  newCode,
  unchanged,
}: {
  oldCode: string;
  newCode: string;
  unchanged: boolean;
}) {
  if (unchanged) {
    return (
      <div className="grid place-items-center py-16 text-center text-[12.5px] text-zinc-500">
        Apply a fix to see a before/after diff here.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md ring-1 ring-white/10 [&_*]:!font-mono">
      <ReactDiffViewer
        oldValue={oldCode}
        newValue={newCode}
        splitView={false}
        useDarkTheme
        compareMethod={DiffMethod.WORDS}
        styles={{
          variables: {
            dark: {
              diffViewerBackground: "#0f0f14",
              gutterBackground: "#0a0a0d",
              codeFoldBackground: "#0a0a0d",
              addedBackground: "#173a24",
              addedColor: "#a7f3b6",
              removedBackground: "#3a1717",
              removedColor: "#ff8a6a",
              wordAddedBackground: "#1f5c33",
              wordRemovedBackground: "#5c1f1f",
              emptyLineBackground: "#0f0f14",
            },
          },
        }}
      />
    </div>
  );
}

function HistoryList({ history }: { history: ResolvedIssue[] }) {
  if (history.length === 0) {
    return (
      <div className="grid place-items-center py-16 text-center text-[12.5px] text-zinc-500">
        Resolved fixes will appear here.
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-1.5">
      {history.map((h, i) => {
        const s = SEV[h.severity];
        return (
          <li
            key={`${h.issueId}-${i}`}
            className="flex items-start gap-3 rounded-md bg-white/[0.02] p-2.5 ring-1 ring-white/10"
          >
            <span className={`mt-1 size-1.5 shrink-0 rounded-full ${s.dot}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] text-zinc-200">{h.title}</p>
              <p className="mt-0.5 font-mono text-[10.5px] text-zinc-500">
                {new Date(h.resolvedAt).toLocaleTimeString()} · {s.label.toLowerCase()}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

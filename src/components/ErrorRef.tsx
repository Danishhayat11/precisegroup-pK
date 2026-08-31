import { useMemo, useState } from "react";
import { formatLogSearchQuery, normalizeErrorId } from "@/lib/error-page";

export function ErrorRef({ id: rawId, method = "GET" }: { id: string; method?: string }) {
  const id = useMemo(() => normalizeErrorId(rawId), [rawId]);
  const [copied, setCopied] = useState(false);
  const [queryCopied, setQueryCopied] = useState(false);
  const [showQuery, setShowQuery] = useState(false);

  const query = useMemo(() => {
    const path =
      typeof window !== "undefined" ? window.location.pathname + window.location.search : undefined;
    return formatLogSearchQuery({ id, method, path });
  }, [id, method]);

  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  };

  const onCopyQuery = async () => {
    setShowQuery(true);
    try {
      await navigator.clipboard?.writeText(query);
      setQueryCopied(true);
      setTimeout(() => setQueryCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  };

  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      <div
        className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 font-mono text-xs text-foreground"
        role="status"
        aria-live="polite"
      >
        <span className="text-muted-foreground">Ref</span>
        <code data-testid="error-ref-id">{id}</code>
        <button
          type="button"
          onClick={onCopy}
          className="text-primary hover:underline"
          aria-label="Copy error reference"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="text-xs">
        <button
          type="button"
          onClick={onCopyQuery}
          className="text-primary underline-offset-2 hover:underline"
          aria-label="Copy log search query for this error"
          data-testid="error-log-query-btn"
        >
          {queryCopied ? "Copied log search query" : "Copy log search query"}
        </button>
        {showQuery && (
          <code
            data-testid="error-log-query"
            className="mt-1 block break-all rounded border border-border bg-muted/50 px-2 py-1 font-mono text-[11px] text-foreground"
          >
            {query}
          </code>
        )}
      </div>
    </div>
  );
}

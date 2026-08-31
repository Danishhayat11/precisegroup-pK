/**
 * Lightweight background-job runner for client-side long-running tasks
 * (full audits, bulk recomputes). Keeps the UI responsive by yielding to
 * the event loop between chunks, surfaces progress + cancel, and is safe
 * to call from React via the `useBackgroundJob` hook.
 *
 * This is intentionally an in-tab worker: TanStack Start runs on a stateless
 * Worker runtime, so there is no durable server-side queue to lean on.
 * Cancellation is co-operative — handlers must honour `signal.aborted`.
 */
import { useCallback, useRef, useState } from "react";

export type JobState = {
  running: boolean;
  label: string;
  stage: string;
  current: number;
  total: number;
  startedAt: number | null;
  error: string | null;
};

export type JobApi = JobState & {
  start: <T>(
    label: string,
    fn: (ctx: {
      signal: AbortSignal;
      progress: (stage: string, current: number, total: number) => void;
    }) => Promise<T>,
  ) => Promise<T | undefined>;
  cancel: () => void;
  reset: () => void;
};

const INITIAL: JobState = {
  running: false,
  label: "",
  stage: "",
  current: 0,
  total: 0,
  startedAt: null,
  error: null,
};

export function useBackgroundJob(): JobApi {
  const [state, setState] = useState<JobState>(INITIAL);
  const ctlRef = useRef<AbortController | null>(null);
  const rafRef = useRef<number | null>(null);
  // Coalesce high-frequency progress events into one paint per frame.
  const pendingRef = useRef<{ stage: string; current: number; total: number } | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setState((s) => (s.running ? { ...s, ...p } : s));
  }, []);

  const progress = useCallback(
    (stage: string, current: number, total: number) => {
      pendingRef.current = { stage, current, total };
      if (rafRef.current == null) {
        rafRef.current =
          typeof requestAnimationFrame === "function"
            ? requestAnimationFrame(flush)
            : (setTimeout(flush, 16) as unknown as number);
      }
    },
    [flush],
  );

  const cancel = useCallback(() => {
    ctlRef.current?.abort();
  }, []);

  const reset = useCallback(() => setState(INITIAL), []);

  const start = useCallback(
    async <T>(
      label: string,
      fn: (ctx: {
        signal: AbortSignal;
        progress: (stage: string, current: number, total: number) => void;
      }) => Promise<T>,
    ) => {
      ctlRef.current?.abort();
      const ctl = new AbortController();
      ctlRef.current = ctl;
      setState({ ...INITIAL, running: true, label, stage: "Starting…", startedAt: Date.now() });
      try {
        const result = await fn({ signal: ctl.signal, progress });
        // Flush any pending progress before clearing state.
        if (pendingRef.current) {
          const p = pendingRef.current;
          pendingRef.current = null;
          setState((s) => ({ ...s, ...p }));
        }
        setState((s) => ({ ...s, running: false, stage: "Done" }));
        return result;
      } catch (e: any) {
        const aborted = e?.name === "AbortError" || ctl.signal.aborted;
        setState((s) => ({
          ...s,
          running: false,
          stage: aborted ? "Cancelled" : "Failed",
          error: aborted ? null : (e?.message ?? String(e)),
        }));
        if (!aborted) throw e;
        return undefined;
      } finally {
        if (ctlRef.current === ctl) ctlRef.current = null;
      }
    },
    [progress],
  );

  return { ...state, start, cancel, reset };
}

/**
 * Run an async task over `items` with bounded concurrency and progress.
 * Honours `signal.aborted` between items.
 */
export async function runChunked<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  opts: {
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number, lastItem: T) => void;
  } = {},
): Promise<void> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const total = items.length;
  let cursor = 0;
  let done = 0;
  const run = async () => {
    while (true) {
      if (opts.signal?.aborted) throw new DOMException("Job cancelled", "AbortError");
      const i = cursor++;
      if (i >= total) return;
      const item = items[i];
      await worker(item, i);
      done += 1;
      opts.onProgress?.(done, total, item);
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, total) }, () => run());
  await Promise.all(workers);
}

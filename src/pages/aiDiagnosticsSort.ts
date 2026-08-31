/**
 * Sort persistence for the AI Diagnostics page.
 *
 * URL is the source of truth (deep links and refreshes must be
 * faithful), with localStorage as a fallback so a user's last-picked
 * sort survives navigating away and returning to a bare
 * `/admin/ai-diagnostics` URL. On mount, if the URL omits sort/dir and
 * localStorage has a saved preference, we hydrate the URL from it
 * exactly once. Later user picks flow URL → storage via `setSort`.
 *
 * Extracted from AiDiagnosticsPage so the URL-⇄-storage contract can
 * be integration-tested end-to-end without mounting the full page.
 */
import { useEffect } from "react";

export type SortKey = "time" | "status" | "tool";
export type SortDir = "asc" | "desc";

export const SORT_STORAGE_KEY = "aiDiagnostics.sort.v1";

export function readStoredSort(): { sort?: SortKey; dir?: SortDir } {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { sort?: unknown; dir?: unknown };
    const sort =
      parsed.sort === "time" || parsed.sort === "status" || parsed.sort === "tool"
        ? (parsed.sort as SortKey)
        : undefined;
    const dir = parsed.dir === "asc" || parsed.dir === "desc" ? (parsed.dir as SortDir) : undefined;
    return { sort, dir };
  } catch {
    return {};
  }
}

export function writeStoredSort(sort: SortKey, dir: SortDir) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ sort, dir }));
  } catch {
    /* quota / disabled storage — silently ignore, URL still works */
  }
}

export interface UseAiDiagnosticsSortArgs {
  /** Raw sort value from the URL (undefined = default "time"). */
  urlSort: SortKey | undefined;
  /** Raw dir value from the URL (undefined = default "desc"). */
  urlDir: SortDir | undefined;
  /**
   * Merge-patch the URL search params. Values equal to their defaults
   * MUST be passed as `undefined` so they're stripped from the URL —
   * shared links stay short and the URL is canonical.
   */
  patchSearch: (patch: { sort?: SortKey | undefined; dir?: SortDir | undefined }) => void;
}

export interface AiDiagnosticsSort {
  sortKey: SortKey;
  sortDir: SortDir;
  /** Toggle / set the sort column, persisting to URL + localStorage. */
  setSort: (nextSort: SortKey, nextDir: SortDir) => void;
}

export function useAiDiagnosticsSort({
  urlSort,
  urlDir,
  patchSearch,
}: UseAiDiagnosticsSortArgs): AiDiagnosticsSort {
  // Mount-time hydration: URL is empty AND localStorage has a value.
  useEffect(() => {
    if (urlSort !== undefined || urlDir !== undefined) return;
    const stored = readStoredSort();
    if (stored.sort === undefined && stored.dir === undefined) return;
    patchSearch({
      sort: stored.sort && stored.sort !== "time" ? stored.sort : undefined,
      dir: stored.dir && stored.dir !== "desc" ? stored.dir : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortKey: SortKey = urlSort ?? "time";
  const sortDir: SortDir = urlDir ?? "desc";

  const setSort = (nextSort: SortKey, nextDir: SortDir) => {
    writeStoredSort(nextSort, nextDir);
    patchSearch({
      sort: nextSort === "time" ? undefined : nextSort,
      dir: nextDir === "desc" ? undefined : nextDir,
    });
  };

  return { sortKey, sortDir, setSort };
}

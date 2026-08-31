/* allow-raw-color-file: dev-only headshot health panel uses amber palette to signal QA warnings; never rendered to end users (gated to DEV + ?debug=headshots) */
import { useCallback, useEffect, useState } from "react";
import {
  runTeamHeadshotHealthCheck,
  resetTeamHeadshotHealthCheck,
  type HeadshotHealthFailure,
  type HeadshotSourceGroup,
} from "@/lib/site/teamHeadshotHealthCheck";

interface Props {
  groups: readonly HeadshotSourceGroup[];
}

/**
 * On-page warning panel for the /site route. Runs the team-headshot
 * health check on mount and renders a small warning card listing every
 * URL that failed validation. A "Re-check" button re-runs the probes
 * without a page reload. The panel is dismissible and only renders when
 * failures exist and either DEV is active or `?debug=headshots` is set,
 * so real visitors never see it during a healthy state.
 */
export function TeamHeadshotHealthPanel({ groups }: Props) {
  // Never render during SSR / first client render: the visibility gate below
  // depends on browser-only state (window.location), so rendering markup on
  // the server would produce a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  const [failures, setFailures] = useState<HeadshotHealthFailure[]>([]);
  const [checking, setChecking] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  const run = useCallback(async () => {
    setChecking(true);
    const results = await runTeamHeadshotHealthCheck(groups);
    setFailures(results);
    setLastCheckedAt(Date.now());
    setChecking(false);
  }, [groups]);

  const recheck = useCallback(async () => {
    resetTeamHeadshotHealthCheck();
    setDismissed(false);
    await run();
  }, [run]);

  useEffect(() => {
    setMounted(true);
    void run();
  }, [run]);

  if (!mounted) return null;
  const debugFlag = window.location.search.includes("debug=headshots");
  if (!import.meta.env.DEV && !debugFlag) return null;
  if (dismissed) return null;
  if (!checking && failures.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-lg text-amber-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Team headshot health check</p>
          <p className="mt-0.5 text-xs opacity-80">
            {checking ? "Probing headshot URLs…" : `${failures.length} asset(s) failed validation`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss headshot health panel"
          className="min-h-11 min-w-11 -m-2 rounded p-2 text-lg leading-none opacity-70 hover:opacity-100"
        >
          ×
        </button>
      </div>

      {failures.length > 0 && (
        <ul className="mt-3 max-h-48 overflow-auto space-y-2 text-xs">
          {failures.map((f) => (
            <li key={f.url} className="rounded border border-amber-200 bg-white/60 p-2">
              <div className="font-medium">
                {f.name}{" "}
                <span className="opacity-60">
                  ({f.variant} · {f.status})
                </span>
              </div>
              <div className="mt-0.5 break-all opacity-80">{f.url}</div>
              {f.message && <div className="mt-0.5 italic opacity-70">{f.message}</div>}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] opacity-60">
          {lastCheckedAt ? `Checked ${new Date(lastCheckedAt).toLocaleTimeString()}` : ""}
        </span>
        <button
          type="button"
          onClick={() => void recheck()}
          disabled={checking}
          className="min-h-11 rounded bg-amber-900 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-800 disabled:opacity-50"
        >
          {checking ? "Re-checking…" : "Re-check"}
        </button>
      </div>
    </div>
  );
}

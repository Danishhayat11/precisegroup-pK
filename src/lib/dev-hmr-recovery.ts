/**
 * Dev-only recovery for transient HMR module-load failures.
 *
 * The TanStack Router Vite plugin regenerates `src/routeTree.gen.ts` on
 * every route file change. Between the "old file deleted / new file
 * being written" window, a browser request for that module (or for a
 * dynamically-imported route chunk that pulls it in) can 500 with:
 *
 *   - "Failed to fetch dynamically imported module: …/routeTree.gen.ts"
 *   - "Internal Server Error" from the Vite middleware
 *   - a `vite:error` HMR event whose payload references the same URL
 *
 * The correct recovery is almost always "wait a tick and reload" — the
 * generator finishes within a few hundred milliseconds and the next
 * request succeeds. Without this helper the user has to hard-reload
 * (or worse, restart the dev server) to escape the boundary.
 *
 * This module wires three listeners on the client, ONLY in dev:
 *
 *   1. `unhandledrejection` — catches the promise rejection from a
 *      failed `import()` (route lazy chunks, `routeTree.gen.ts`).
 *   2. `window.error` — catches `<script>` tag load failures for the
 *      same modules when Vite serves a 500 for the initial fetch.
 *   3. Vite HMR `vite:error` — catches pre-transform / plugin errors
 *      the dev server surfaces via the HMR channel before the module
 *      is even requested from the browser.
 *
 * A per-URL cooldown (stored in `sessionStorage`) prevents reload
 * loops: if we've already reloaded to recover the same URL within the
 * last 10s, we surface the error instead of reloading again — that way
 * a genuine build break in the generated file (unlikely but possible)
 * still shows up in the console instead of pinning the tab in a loop.
 */

const COOLDOWN_MS = 10_000;
const RELOAD_KEY = "__lovable_hmr_recovery__";
const RECOVERABLE_PATTERNS = [
  /routeTree\.gen\.ts/,
  // Route chunks the router lazy-imports. Vite adds `?t=` cache-buster
  // suffixes during HMR, so match by folder rather than exact filename.
  /\/src\/routes\//,
];

type RecentEntry = { url: string; at: number };

function readRecent(): RecentEntry[] {
  try {
    const raw = sessionStorage.getItem(RELOAD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecent(entries: RecentEntry[]) {
  try {
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify(entries));
  } catch {
    // sessionStorage can throw in some contexts (private mode quota,
    // sandboxed iframe). Swallow — worst case we lose the cooldown and
    // may reload one extra time.
  }
}

/** True if we've already reloaded to recover `url` in the last COOLDOWN_MS. */
function isInCooldown(url: string): boolean {
  const now = Date.now();
  const recent = readRecent().filter((e) => now - e.at < COOLDOWN_MS);
  writeRecent(recent);
  return recent.some((e) => e.url === url);
}

function markReloaded(url: string) {
  const now = Date.now();
  const recent = readRecent()
    .filter((e) => now - e.at < COOLDOWN_MS)
    .concat({ url, at: now });
  writeRecent(recent);
}

function isRecoverable(message: string): string | null {
  for (const pattern of RECOVERABLE_PATTERNS) {
    const match = message.match(pattern);
    if (match) return match[0];
  }
  return null;
}

let reloadScheduled = false;

function scheduleReload(url: string, reason: string) {
  if (reloadScheduled) return;
  if (isInCooldown(url)) {
    console.warn(
      `[hmr-recovery] Already reloaded for ${url} within ${COOLDOWN_MS}ms — leaving error visible so the underlying build failure is fixable.`,
    );
    return;
  }
  reloadScheduled = true;
  markReloaded(url);
  console.info(
    `[hmr-recovery] Recovering from transient dev-server error (${reason}) → reloading in 250ms.`,
  );
  // Small delay lets the router plugin finish rewriting the file so
  // the reload request hits a fresh, valid module rather than
  // re-racing the same generation window.
  setTimeout(() => {
    window.location.reload();
  }, 250);
}

export function installHmrRecovery() {
  if (typeof window === "undefined") return;
  if (!import.meta.env.DEV) return;
  // Guard against double-install (router.tsx re-runs across HMR).
  const w = window as Window & { __lovableHmrRecoveryInstalled?: boolean };
  if (w.__lovableHmrRecoveryInstalled) return;
  w.__lovableHmrRecoveryInstalled = true;

  window.addEventListener("unhandledrejection", (event) => {
    const msg = String((event.reason && (event.reason.message ?? event.reason)) ?? "");
    const url = isRecoverable(msg);
    if (url) scheduleReload(url, `unhandledrejection: ${msg.slice(0, 120)}`);
  });

  window.addEventListener("error", (event) => {
    // Script/module load failures surface here with `filename` set to
    // the failing URL. Runtime `throw` errors also fire this event but
    // won't match the URL patterns above, so they pass through.
    const url =
      isRecoverable(String(event.filename ?? "")) ?? isRecoverable(String(event.message ?? ""));
    if (url) scheduleReload(url, `window.error: ${event.message?.slice(0, 120)}`);
  });

  // Vite's HMR client emits `vite:error` for pre-transform / plugin
  // errors before the module is ever fetched. Hook it so we recover
  // even when the failure surfaces via the HMR channel.
  if (import.meta.hot) {
    import.meta.hot.on(
      "vite:error",
      (payload: { err?: { message?: string; loc?: { file?: string } } }) => {
        const message = String(payload?.err?.message ?? "");
        const file = String(payload?.err?.loc?.file ?? "");
        const url = isRecoverable(file) ?? isRecoverable(message);
        if (url) scheduleReload(url, `vite:error: ${message.slice(0, 120)}`);
      },
    );
  }
}

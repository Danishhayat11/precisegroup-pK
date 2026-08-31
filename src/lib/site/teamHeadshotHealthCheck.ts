/**
 * Team headshot health check
 * --------------------------
 * Runs once at UI startup on the /site route and validates that every URL
 * referenced by a `<TeamHeadshot>` (AVIF srcSet, WebP srcSet, JPG fallback)
 * actually resolves. Missing assets are reported before the browser tries
 * to decode them, so QA sees the failure in the console and in the
 * `team-headshot:error` event stream even if the placeholder tile masks
 * the visual regression.
 *
 * Why not a build-time check? The AVIF/WebP variants are Vite-imported —
 * the bundler already fails the build if the local file is missing. This
 * catches the class of failures the bundler can't: CDN 404s from the
 * `/__l5e/assets-v1/*` asset host after a pointer is deleted, stale
 * service-worker caches serving a URL that no longer exists, and
 * misconfigured CDN cache rules returning 5xx on cold reads.
 *
 * The check is a single HEAD per URL, cached across component remounts,
 * and gated so it can't fire more than once per page session.
 */

export interface HeadshotSourceGroup {
  name: string;
  fallback?: string;
  avifSrcSet?: string;
  webpSrcSet?: string;
}

export interface HeadshotHealthFailure {
  name: string;
  url: string;
  variant: "avif" | "webp" | "fallback";
  status: number | "network-error";
  message: string;
}

/**
 * Extract every URL from a `srcset` attribute, dropping the width
 * descriptors ("… 800w"). Returns `[]` for `undefined` / empty strings so
 * callers don't need to guard.
 */
export function extractSrcSetUrls(srcSet: string | undefined): string[] {
  if (!srcSet) return [];
  return srcSet
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter((u): u is string => Boolean(u));
}

let healthCheckStarted = false;
const seenUrls = new Set<string>();

const PROBE_TIMEOUT_MS = 5_000;
const RETRY_BACKOFF_MS = 400;

/**
 * A single HEAD request with an `AbortController` timeout. Resolves to
 * `null` on success (2xx) or an outcome describing the failure. Callers
 * distinguish transient failures (network error / timeout / 5xx) from
 * definitive ones (4xx) by inspecting `.transient`.
 */
async function probeOnce(
  url: string,
  variant: HeadshotHealthFailure["variant"],
  name: string,
): Promise<(HeadshotHealthFailure & { transient: boolean }) | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    if (res.ok) return null;
    return {
      name,
      url,
      variant,
      status: res.status,
      message: `HTTP ${res.status} ${res.statusText || ""}`.trim(),
      // 5xx and 408/429 are worth retrying; 4xx is a real "asset missing".
      transient: res.status >= 500 || res.status === 408 || res.status === 429,
    };
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    return {
      name,
      url,
      variant,
      status: "network-error",
      message: aborted
        ? `timeout after ${PROBE_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : "unknown fetch failure",
      transient: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a URL with one automatic retry on transient failures (timeout,
 * network error, 5xx/408/429). A short backoff between attempts avoids
 * hammering a CDN that just cold-started. Definitive 4xx responses are
 * returned immediately without retry.
 */
async function probeUrl(
  url: string,
  variant: HeadshotHealthFailure["variant"],
  name: string,
): Promise<HeadshotHealthFailure | null> {
  const first = await probeOnce(url, variant, name);
  if (first === null) return null;
  if (!first.transient) {
    const { transient: _t, ...rest } = first;
    void _t;
    return rest;
  }

  await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
  const second = await probeOnce(url, variant, name);
  if (second === null) return null;
  const { transient: _t, ...rest } = second;
  void _t;
  return {
    ...rest,
    message: `${rest.message} (after 1 retry)`,
  };
}

/**
 * localStorage cache for probe outcomes. Keyed by a fingerprint of the
 * probed URL set so any change to the asset list (new deploy, added
 * team member, renamed variant) automatically invalidates the cache.
 * Cache entries older than `CACHE_TTL_MS` are ignored so a fixed 404
 * doesn't stay "broken" forever.
 */
const CACHE_STORAGE_KEY = "team-headshot-healthcheck-v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry {
  fingerprint: string;
  timestamp: number;
  failures: HeadshotHealthFailure[];
}

function fingerprintUrls(urls: readonly string[]): string {
  // Order-independent fingerprint: sort + join. Cheap and stable enough
  // for cache-key equality (not a security hash).
  return [...urls].sort().join("|");
}

function readCache(): CacheEntry | null {
  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (
      !parsed ||
      typeof parsed.fingerprint !== "string" ||
      typeof parsed.timestamp !== "number" ||
      !Array.isArray(parsed.failures)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Quota exceeded / privacy mode — cache is a nice-to-have, not required.
  }
}

function clearCache(): void {
  try {
    window.localStorage.removeItem(CACHE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Validate every headshot URL in `groups`. Safe to call from a
 * `useEffect` — it self-guards against double-invocation (StrictMode
 * double-mount, route revisits) and only probes URLs it has not seen
 * before. Results are cached in `localStorage` for `CACHE_TTL_MS` so
 * repeat visits skip the HEAD requests entirely; the fingerprint keys
 * off the actual URL set so any change auto-invalidates the cache.
 */
export async function runTeamHeadshotHealthCheck(
  groups: readonly HeadshotSourceGroup[],
): Promise<HeadshotHealthFailure[]> {
  if (typeof window === "undefined") return [];
  if (healthCheckStarted) return [];
  healthCheckStarted = true;

  const probeSpecs: Array<[string, HeadshotHealthFailure["variant"], string]> = [];
  for (const g of groups) {
    for (const url of extractSrcSetUrls(g.avifSrcSet)) {
      probeSpecs.push([url, "avif", g.name]);
    }
    for (const url of extractSrcSetUrls(g.webpSrcSet)) {
      probeSpecs.push([url, "webp", g.name]);
    }
    if (g.fallback) probeSpecs.push([g.fallback, "fallback", g.name]);
  }

  const fingerprint = fingerprintUrls(probeSpecs.map(([u]) => u));
  const cached = readCache();
  if (
    cached &&
    cached.fingerprint === fingerprint &&
    Date.now() - cached.timestamp < CACHE_TTL_MS
  ) {
    // Populate the in-memory seen-set so the next call inside the same
    // page session still no-ops correctly.
    for (const [url] of probeSpecs) seenUrls.add(url);
    if (import.meta.env.DEV) {
      console.debug(
        `[TeamHeadshot] health check served from cache (${cached.failures.length} failure(s), age ${Math.round(
          (Date.now() - cached.timestamp) / 1000,
        )}s)`,
      );
    }
    return cached.failures;
  }

  const probes: Promise<HeadshotHealthFailure | null>[] = [];
  for (const [url, variant, name] of probeSpecs) {
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    probes.push(probeUrl(url, variant, name));
  }

  const results = await Promise.all(probes);
  const failures = results.filter((r): r is HeadshotHealthFailure => r !== null);

  writeCache({ fingerprint, timestamp: Date.now(), failures });

  if (failures.length > 0) {
    console.warn(
      `[TeamHeadshot] health check found ${failures.length} unreachable asset(s):`,
      failures,
    );
    for (const f of failures) {
      window.dispatchEvent(
        new CustomEvent("team-headshot:error", {
          detail: {
            name: f.name,
            reason: "health-check",
            url: f.url,
            variant: f.variant,
            status: f.status,
            message: f.message,
          },
        }),
      );
    }
  } else if (import.meta.env.DEV) {
    console.debug(`[TeamHeadshot] health check ok — ${seenUrls.size} asset(s) reachable`);
  }

  return failures;
}

/**
 * Reset the one-shot guard AND clear the localStorage cache so
 * `runTeamHeadshotHealthCheck` will actually re-probe every URL on the
 * next call. Used by the on-page health panel's "Re-check" action and
 * by tests.
 */
export function resetTeamHeadshotHealthCheck() {
  healthCheckStarted = false;
  seenUrls.clear();
  if (typeof window !== "undefined") clearCache();
}

/** @deprecated use `resetTeamHeadshotHealthCheck`. */
export const __resetTeamHeadshotHealthCheck = resetTeamHeadshotHealthCheck;

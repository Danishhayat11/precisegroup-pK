// Guarded service worker registration.
// Refuses to register in dev, iframes, and every Lovable preview host —
// registering a SW in preview serves stale HTML and breaks hot reload.

const SW_URL = "/sw.js";

function isLovablePreviewHost(host: string): boolean {
  return (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  );
}

function shouldRefuse(): boolean {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return true;
  if (!import.meta.env.PROD) return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const host = window.location.hostname;
  if (isLovablePreviewHost(host)) return true;
  if (
    new URLSearchParams(window.location.search).has("sw") &&
    new URLSearchParams(window.location.search).get("sw") === "off"
  )
    return true;
  return false;
}

async function unregisterMatching(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs
        .filter((r) =>
          (r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "").endsWith(
            SW_URL,
          ),
        )
        .map((r) => r.unregister()),
    );
  } catch {
    /* noop */
  }
}

export type UpdateHandler = (waiting: ServiceWorker) => void;

export function registerServiceWorker(onUpdate: UpdateHandler): void {
  if (typeof window === "undefined") return;
  if (shouldRefuse()) {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) void unregisterMatching();
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(SW_URL, { scope: "/" })
      .then((reg) => {
        // If a worker is already waiting on first load, surface it.
        if (reg.waiting) onUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) onUpdate(sw);
          });
        });
      })
      .catch(() => {
        /* silent */
      });

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

export function activateWaitingWorker(waiting: ServiceWorker): void {
  waiting.postMessage({ type: "SKIP_WAITING" });
}

// Mark the last successful online moment so the offline page can show it.
export function markSyncedNow(): void {
  try {
    localStorage.setItem("precise:lastSyncedAt", String(Date.now()));
  } catch {
    /* noop */
  }
}

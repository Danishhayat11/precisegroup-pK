/* Precise ERP service worker
 * Strategies:
 *  - App shell (HTML navigations): network-first, fallback to cache, then /offline.html
 *  - Static assets (icons/fonts/css/js): cache-first
 *  - API calls (supabase, /api/): network-first, no offline fallback
 */
const VERSION = "v1.0.0";
const STATIC_CACHE = `precise-static-${VERSION}`;
const RUNTIME_CACHE = `precise-runtime-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-72.png",
  "/icons/icon-96.png",
  "/icons/icon-128.png",
  "/icons/icon-144.png",
  "/icons/icon-152.png",
  "/icons/icon-192.png",
  "/icons/icon-384.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => Promise.all(PRECACHE_URLS.map((u) => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("precise-") && k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// Allow the page to trigger an immediate activation when a new SW is waiting.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isApiRequest(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.hostname.endsWith(".supabase.co") ||
    url.hostname.endsWith(".supabase.in") ||
    url.pathname.startsWith("/_serverFn/")
  );
}

function isStaticAsset(url, request) {
  if (
    request.destination === "font" ||
    request.destination === "image" ||
    request.destination === "style" ||
    request.destination === "script"
  )
    return true;
  return /\.(?:css|js|mjs|png|jpg|jpeg|svg|webp|avif|ico|woff2?|ttf|otf)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !isApiRequest(url)) return;

  // Never intercept OAuth broker or SSE
  if (url.pathname.startsWith("/~oauth") || request.headers.get("accept") === "text/event-stream")
    return;

  // API: network-first, no offline fallback (data must be fresh)
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(request);
        return (
          cached ||
          new Response(JSON.stringify({ offline: true }), {
            status: 503,
            headers: { "content-type": "application/json" },
          })
        );
      }),
    );
    return;
  }

  // HTML navigations: network-first, offline fallback
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(request);
          return cached || (await caches.match(OFFLINE_URL)) || Response.error();
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first with background refresh
  if (isStaticAsset(url, request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        const fetchPromise = fetch(request)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })(),
    );
  }
});

// Basic push handler (Phase 3 backend not required for it to be a no-op).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Precise ERP", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Precise ERP";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-96.png",
    data: { url: data.url || "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          c.navigate(targetUrl);
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })(),
  );
});

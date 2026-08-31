import { useEffect, useState } from "react";
import { registerServiceWorker, activateWaitingWorker, markSyncedNow } from "./register-sw";

export function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    registerServiceWorker((sw) => setWaiting(sw));
    const onOnline = () => markSyncedNow();
    markSyncedNow();
    window.addEventListener("online", onOnline);
    const focus = () => {
      if (navigator.onLine) markSyncedNow();
    };
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", focus);
    };
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-center gap-3 border-b border-border/60 bg-background/95 px-4 py-2 text-sm text-foreground shadow-sm backdrop-blur"
    >
      <span>A new version is available.</span>
      <button
        type="button"
        onClick={() => activateWaitingWorker(waiting)}
        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
      >
        Update
      </button>
      <button
        type="button"
        onClick={() => setWaiting(null)}
        className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

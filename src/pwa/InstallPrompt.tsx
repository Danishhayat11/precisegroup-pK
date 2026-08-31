import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "precise:pwaPromptDismissedAt";
const VISITS_KEY = "precise:pwaVisits";
const FIRST_SEEN_KEY = "precise:pwaFirstSeenAt";
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_SECONDS = 30 * 1000;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS
  return Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
}

function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < SEVEN_DAYS;
  } catch {
    return false;
  }
}

function bumpVisitCount(): number {
  try {
    if (!localStorage.getItem(FIRST_SEEN_KEY))
      localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()));
    const n = Number(localStorage.getItem(VISITS_KEY) || "0") + 1;
    localStorage.setItem(VISITS_KEY, String(n));
    return n;
  } catch {
    return 1;
  }
}

function markDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* noop */
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [iosSheet, setIosSheet] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;
    if (dismissedRecently()) return;

    const visits = bumpVisitCount();

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      // Show immediately on 3rd+ visit, otherwise wait 30s.
      if (visits >= 3) setShow(true);
      else setTimeout(() => setShow(true), THIRTY_SECONDS);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    // iOS Safari: no beforeinstallprompt — show instructions instead.
    let iosTimer: number | undefined;
    if (isIos()) {
      const delay = visits >= 3 ? 0 : THIRTY_SECONDS;
      iosTimer = window.setTimeout(() => setIosSheet(true), delay);
    }

    const onInstalled = () => {
      setShow(false);
      setIosSheet(false);
      markDismissed();
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      if (iosTimer) window.clearTimeout(iosTimer);
    };
  }, []);

  const dismiss = () => {
    markDismissed();
    setShow(false);
    setIosSheet(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "dismissed") markDismissed();
    setDeferred(null);
    setShow(false);
  };

  if (!show && !iosSheet) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-install-title"
      className="fixed inset-x-0 bottom-0 z-[9998] mx-auto w-full max-w-md rounded-t-2xl border border-border/60 bg-background p-4 pb-6 shadow-2xl sm:bottom-4 sm:rounded-2xl"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
    >
      {show && deferred && (
        <div className="flex items-start gap-3">
          <img
            src="/icons/icon-192.png"
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 flex-shrink-0 rounded-xl"
          />
          <div className="min-w-0 flex-1">
            <h2 id="pwa-install-title" className="text-base font-semibold text-foreground">
              Precise ERP
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Install this app on your phone for faster access — works like a native app.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={install}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 min-h-[44px]"
              >
                Install
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="flex-1 rounded-lg bg-muted px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/80 min-h-[44px]"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {iosSheet && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/icons/icon-192.png"
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 rounded-xl"
            />
            <div>
              <h2 id="pwa-install-title" className="text-base font-semibold text-foreground">
                Install Precise ERP
              </h2>
              <p className="text-xs text-muted-foreground">
                Add to your Home Screen for a native-app feel.
              </p>
            </div>
          </div>
          <ol className="space-y-2 text-sm text-foreground">
            <li className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                1
              </span>
              <span>
                Tap the Share button
                <svg
                  aria-hidden="true"
                  className="ml-1 inline h-4 w-4 align-[-2px] animate-bounce"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                in Safari's toolbar.
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                2
              </span>
              <span>
                Choose <strong>Add to Home Screen</strong>.
              </span>
            </li>
          </ol>
          <button
            type="button"
            onClick={dismiss}
            className="mt-2 w-full rounded-lg bg-muted px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/80 min-h-[44px]"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

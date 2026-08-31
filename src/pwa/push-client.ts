/**
 * Client helper to subscribe / unsubscribe the current browser to Web Push.
 * Call `enablePushOnFirstPaymentMark()` from the "Mark payment" handler —
 * it's idempotent and no-ops when already subscribed or when the browser
 * doesn't support push.
 */
import {
  getVapidPublicKey,
  savePushSubscription,
  deletePushSubscription,
} from "@/lib/push.functions";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToB64url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function getCurrentPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Request permission (if not already decided), subscribe via the SW's
 * PushManager, and persist the subscription server-side.
 * Returns `{ ok: true }` on success; `{ ok: false, reason }` on any failure.
 */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };
  try {
    const reg = await navigator.serviceWorker.ready;
    if (Notification.permission === "default") {
      const p = await Notification.requestPermission();
      if (p !== "granted") return { ok: false, reason: p };
    } else if (Notification.permission !== "granted") {
      return { ok: false, reason: Notification.permission };
    }

    const { publicKey } = await getVapidPublicKey();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const keyBytes = urlBase64ToUint8Array(publicKey);
      // Copy into a fresh ArrayBuffer to satisfy DOM lib's BufferSource typing.
      const applicationServerKey = keyBytes.buffer.slice(
        keyBytes.byteOffset,
        keyBytes.byteOffset + keyBytes.byteLength,
      ) as ArrayBuffer;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    const endpoint = json.endpoint || sub.endpoint;
    const p256dh = json.keys?.p256dh || bytesToB64url(sub.getKey("p256dh"));
    const auth = json.keys?.auth || bytesToB64url(sub.getKey("auth"));

    await savePushSubscription({
      data: { endpoint, p256dh, auth, userAgent: navigator.userAgent },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "error" };
  }
}

export async function disablePush(): Promise<{ ok: boolean }> {
  if (!isPushSupported()) return { ok: false };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await deletePushSubscription({ data: { endpoint } });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

const FLAG_KEY = "precise:pushAskedAt";
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/** Call from the first "Mark payment" click; safe to call every time — asks at most once per 7 days. */
export async function enablePushOnFirstPaymentMark(): Promise<void> {
  if (!isPushSupported()) return;
  if (Notification.permission !== "default") return; // user already decided
  try {
    const last = Number(localStorage.getItem(FLAG_KEY) || "0");
    if (last && Date.now() - last < SEVEN_DAYS) return;
    localStorage.setItem(FLAG_KEY, String(Date.now()));
  } catch {
    /* noop */
  }
  await enablePush();
}

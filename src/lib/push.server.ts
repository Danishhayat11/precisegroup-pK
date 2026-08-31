/**
 * Server-only Web Push helpers.
 * Loads VAPID keys from env at call time and provides a `sendPush` helper
 * that works on Cloudflare Workers via the WebCrypto-based `webpush-webcrypto`.
 */
import { ApplicationServerKeys, generatePushHTTPRequest } from "webpush-webcrypto";

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

let cachedKeys: ApplicationServerKeys | null = null;

/**
 * Build ApplicationServerKeys from the raw base64url values we stored as
 * secrets: VAPID_PUBLIC_KEY is the 65-byte uncompressed EC point (0x04||X||Y),
 * VAPID_PRIVATE_KEY is the 32-byte raw scalar. We import them via JWK so the
 * library can sign the VAPID JWT with WebCrypto (ECDSA P-256).
 */
async function getAppKeys(): Promise<ApplicationServerKeys> {
  if (cachedKeys) return cachedKeys;
  const pubB64 = process.env.VAPID_PUBLIC_KEY;
  const privB64 = process.env.VAPID_PRIVATE_KEY;
  if (!pubB64 || !privB64) throw new Error("VAPID keys are not configured");

  const pubBytes = b64urlToBytes(pubB64);
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY must be 65-byte uncompressed EC point");
  }
  const x = pubBytes.slice(1, 33);
  const y = pubBytes.slice(33, 65);
  const dBytes = b64urlToBytes(privB64);
  if (dBytes.length !== 32) {
    throw new Error("VAPID_PRIVATE_KEY must be a 32-byte raw scalar");
  }

  const publicJwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64url(x),
    y: bytesToB64url(y),
    ext: true,
  };
  const privateJwk: JsonWebKey = {
    ...publicJwk,
    d: bytesToB64url(dBytes),
  };

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    [],
  );
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );

  cachedKeys = new ApplicationServerKeys(publicKey, privateKey);
  return cachedKeys;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

export type StoredSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type SendResult = {
  id: string;
  ok: boolean;
  status?: number;
  gone?: boolean;
  error?: string;
};

/** Send one push. Returns `{ gone: true }` when the endpoint responded 404/410. */
export async function sendPushTo(
  sub: StoredSubscription,
  payload: PushPayload,
): Promise<SendResult> {
  try {
    const keys = await getAppKeys();
    const subject = process.env.VAPID_SUBJECT || "mailto:admin@precisegroup-pk.lovable.app";
    const { headers, body, endpoint } = await generatePushHTTPRequest({
      applicationServerKeys: keys,
      payload: JSON.stringify(payload),
      target: {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      adminContact: subject,
      ttl: 60 * 60 * 12,
      urgency: "normal",
    });

    const bodyBuf = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
    const res = await fetch(endpoint, { method: "POST", headers, body: bodyBuf });

    if (res.status === 404 || res.status === 410) {
      return { id: sub.id, ok: false, status: res.status, gone: true };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { id: sub.id, ok: false, status: res.status, error: text.slice(0, 200) };
    }
    return { id: sub.id, ok: true, status: res.status };
  } catch (e) {
    return { id: sub.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fan out to many subscriptions and clean up dead endpoints. */
export async function sendPushToMany(
  subs: StoredSubscription[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number; removed: number }> {
  if (subs.length === 0) return { sent: 0, failed: 0, removed: 0 };
  const results = await Promise.all(subs.map((s) => sendPushTo(s, payload)));
  const goneIds = results.filter((r) => r.gone).map((r) => r.id);
  let removed = 0;
  if (goneIds.length) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("push_subscriptions").delete().in("id", goneIds);
    if (!error) removed = goneIds.length;
  }
  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;
  return { sent, failed, removed };
}

/**
 * Runtime smoke check: exercises the `webpush-webcrypto` module through the
 * same code path that `sendPushTo` uses, WITHOUT actually contacting a push
 * service. Generates an ephemeral P-256 keypair, builds a signed VAPID push
 * request against a dummy endpoint, and verifies the module produced a valid
 * `Authorization` header + non-empty encrypted body. If the module fails to
 * resolve, initialize, or sign, this throws with a diagnostic message.
 *
 * Callable from a public smoke-test route; does no I/O against DB or push
 * services, so it is safe to invoke in production on demand.
 */
export async function pushSmokeCheck(): Promise<{
  ok: true;
  moduleResolved: boolean;
  applicationServerKeys: boolean;
  generatedRequest: boolean;
  authorizationHeaderPresent: boolean;
  encryptedBodyBytes: number;
  endpoint: string;
}> {
  if (typeof ApplicationServerKeys !== "function") {
    throw new Error("webpush-webcrypto: ApplicationServerKeys export is not a constructor");
  }
  if (typeof generatePushHTTPRequest !== "function") {
    throw new Error("webpush-webcrypto: generatePushHTTPRequest export is not a function");
  }

  // Ephemeral VAPID keypair — no env dependency, no persistence.
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
  ])) as CryptoKeyPair;
  const keys = new ApplicationServerKeys(kp.publicKey, kp.privateKey);

  // Ephemeral recipient keys — 65-byte uncompressed P-256 point + 16-byte auth.
  const recipient = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  )) as CryptoKeyPair;
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", recipient.publicKey));
  const authSecret = new Uint8Array(16);
  crypto.getRandomValues(authSecret);

  const dummyEndpoint = "https://push.example.invalid/smoke";
  const { headers, body, endpoint } = await generatePushHTTPRequest({
    applicationServerKeys: keys,
    payload: JSON.stringify({ smoke: true }),
    target: {
      endpoint: dummyEndpoint,
      keys: { p256dh: bytesToB64url(rawPub), auth: bytesToB64url(authSecret) },
    },
    adminContact: "mailto:smoke@precisegroup-pk.lovable.app",
    ttl: 60,
    urgency: "normal",
  });

  const auth =
    (headers as Record<string, string>)["Authorization"] ??
    (headers as Record<string, string>)["authorization"];
  if (!auth || !/^vapid\s+t=.+,\s*k=/i.test(auth)) {
    throw new Error("webpush-webcrypto: generated Authorization header is missing or malformed");
  }
  if (!(body instanceof Uint8Array) || body.byteLength === 0) {
    throw new Error("webpush-webcrypto: encrypted body is empty");
  }

  return {
    ok: true,
    moduleResolved: true,
    applicationServerKeys: true,
    generatedRequest: true,
    authorizationHeaderPresent: true,
    encryptedBodyBytes: body.byteLength,
    endpoint,
  };
}

/** Load all subscriptions for a set of user IDs. */
export async function loadSubscriptionsForUsers(userIds: string[]): Promise<StoredSubscription[]> {
  if (userIds.length === 0) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as StoredSubscription[];
}

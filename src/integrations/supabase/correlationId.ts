/**
 * Correlation IDs for RPC authorization failures.
 *
 * Every `callRpc` / `callServerRpc` invocation is tagged with a short id so
 * a denial that appears in the browser console + a Sentry event + a
 * `rpc_authorization_denied_log` row + a `stack_modern--server-function-logs`
 * line can all be joined by grepping the same value.
 *
 * Format: `rpc_<12 lowercase hex>` — short enough to eyeball, wide enough to
 * avoid collisions in the volumes we log.
 */

function randomHex(bytes: number): string {
  // Prefer Web Crypto (available in browser, Workers, and modern Node).
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (g.crypto?.getRandomValues) {
    const buf = new Uint8Array(bytes);
    g.crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Deterministic-enough fallback for exotic runtimes without Web Crypto.
  let out = "";
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}

export function newCorrelationId(): string {
  return `rpc_${randomHex(6)}`;
}

export const CORRELATION_HEADER = "x-rpc-correlation-id";

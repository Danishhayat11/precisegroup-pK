// Canonical Ref ID format: two 8-character uppercase base36 blocks joined by
// a hyphen, e.g. "K3Q9X1AZ-7F2BV0M4". 17 characters total, fixed length, no
// ambiguity between server header, HTML page, logs, and database rows.
export const ERROR_ID_LENGTH = 17;
export const ERROR_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const ERROR_ID_REGEX = /^[0-9A-Z]{8}-[0-9A-Z]{8}$/;

function randomBlock(): string {
  const out = new Array<string>(8);
  try {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    for (let i = 0; i < 8; i++) {
      out[i] = ERROR_ID_ALPHABET[buf[i] % ERROR_ID_ALPHABET.length];
    }
  } catch {
    for (let i = 0; i < 8; i++) {
      out[i] = ERROR_ID_ALPHABET[Math.floor(Math.random() * ERROR_ID_ALPHABET.length)];
    }
  }
  return out.join("");
}

function timeBlock(): string {
  // 8-char base36 of millisecond timestamp, left-padded so length is stable
  // until year 5188 (36^8 ms ≈ 89 years from epoch, wraps via slice).
  return Date.now().toString(36).toUpperCase().padStart(8, "0").slice(-8);
}

export function generateErrorId(): string {
  return `${timeBlock()}-${randomBlock()}`;
}

/** Type guard: true only for IDs that match the canonical format exactly. */
export function isValidErrorId(value: unknown): value is string {
  return typeof value === "string" && ERROR_ID_REGEX.test(value);
}

/**
 * Returns `value` when it's already a canonical Ref ID; otherwise mints a
 * fresh one. Use at every boundary that accepts an externally-supplied ID
 * (header echo, query params, persisted state) so we never display or log
 * an out-of-spec string.
 */
export function normalizeErrorId(value: unknown): string {
  return isValidErrorId(value) ? value : generateErrorId();
}

export type LogSearchContext = {
  id: string;
  method?: string;
  path?: string;
};

/**
 * Canonical, grep-friendly query that matches the server-log prefix
 * (`id=<ID> <METHOD> <PATH>`) emitted by src/server.ts so pasting it into the
 * log search lands directly on the failing request.
 */
export function formatLogSearchQuery({ id, method, path }: LogSearchContext): string {
  const parts = [`id=${id}`];
  if (method) parts.push(method.toUpperCase());
  if (path) parts.push(path);
  return parts.join(" ");
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

export function renderErrorPage(
  errorId?: string,
  ctx?: { method?: string; path?: string },
): string {
  const safeId = normalizeErrorId(errorId);
  const method = (ctx?.method ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const path = ctx?.path ?? "";
  const query = formatLogSearchQuery({ id: safeId, method, path });
  const queryAttr = escAttr(query);
  const methodAttr = escAttr(method);
  const pathAttr = escAttr(path);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-error-id" content="${safeId}" />
    ${method ? `<meta name="x-error-method" content="${methodAttr}" />` : ""}
    ${path ? `<meta name="x-error-path" content="${pathAttr}" />` : ""}
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1rem; }
      .ref { display: inline-flex; align-items: center; gap: 0.5rem; margin: 0 0 0.75rem; padding: 0.4rem 0.75rem; border-radius: 0.375rem; background: #f3f4f6; border: 1px solid #e5e7eb; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8125rem; color: #111; }
      .ref-label { color: #6b7280; font-family: inherit; }
      .copy { background: none; border: 0; padding: 0; color: #2563eb; cursor: pointer; font: inherit; }
      .debug { margin: 0 0 1.5rem; font-size: 0.75rem; }
      .debug button { background: none; border: 0; padding: 0; color: #2563eb; cursor: pointer; font: inherit; text-decoration: underline; }
      .debug code { display: block; margin-top: 0.4rem; padding: 0.35rem 0.5rem; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 0.25rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #111; word-break: break-all; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button.action { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home. If you report this, please include the reference below.</p>
      <div class="ref" role="status" aria-live="polite">
        <span class="ref-label">Ref</span>
        <code id="err-id">${safeId}</code>
        <button class="copy" type="button" onclick="navigator.clipboard&amp;&amp;navigator.clipboard.writeText('${safeId}').then(()=>{this.textContent='Copied'})">Copy</button>
      </div>
      <div class="debug">
        <button id="debug-query-btn" type="button" data-query="${queryAttr}" onclick="(function(b){var q=b.getAttribute('data-query');var c=document.getElementById('debug-query');c.style.display='block';c.textContent=q;if(navigator.clipboard){navigator.clipboard.writeText(q).then(function(){b.textContent='Copied log search query';});}else{b.textContent='Log search query shown below';}})(this)">Copy log search query</button>
        <code id="debug-query" style="display:none"></code>
      </div>
      <div class="actions">
        <button class="action primary" onclick="location.reload()">Try again</button>
        <a class="action secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}

import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { generateErrorId, normalizeErrorId, renderErrorPage } from "./lib/error-page";
import { recordSsrError } from "./lib/ssr-error-log.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  // Include request context so intermittent failures leave a breadcrumb in
  // Server Logs (the swallowed Error itself often has no usable .stack).
  const captured = consumeLastCapturedError();
  const url = (() => {
    try {
      return new URL(request.url).pathname + new URL(request.url).search;
    } catch {
      return request.url;
    }
  })();
  const errorId = normalizeErrorId(generateErrorId());
  const ctx = `[ssr-catastrophic] id=${errorId} ${request.method} ${url}`;
  if (captured instanceof Error) {
    captured.message = `${ctx} :: ${captured.message}`;
    console.error(captured);
  } else if (captured !== undefined) {
    console.error(ctx, captured);
  } else {
    console.error(new Error(`${ctx} :: h3 swallowed SSR error body=${body}`));
  }

  recordSsrError({ kind: "catastrophic", request, errorId, error: captured });

  return new Response(renderErrorPage(errorId, { method: request.method, path: url }), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-error-id": errorId,
    },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(request, response);
    } catch (error) {
      // Annotate so the log line ties back to a specific URL and reference.
      const url = (() => {
        try {
          return new URL(request.url).pathname + new URL(request.url).search;
        } catch {
          return request.url;
        }
      })();
      const errorId = normalizeErrorId(generateErrorId());
      const prefix = `[ssr-thrown] id=${errorId} ${request.method} ${url}`;
      if (error instanceof Error) {
        error.message = `${prefix} :: ${error.message}`;
        console.error(error);
      } else {
        console.error(prefix, error);
      }
      recordSsrError({ kind: "thrown", request, errorId, error });
      return new Response(renderErrorPage(errorId, { method: request.method, path: url }), {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-error-id": errorId,
        },
      });
    }
  },
};

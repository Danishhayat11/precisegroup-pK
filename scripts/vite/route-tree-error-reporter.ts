/**
 * Vite plugin: prettier + more actionable errors for TanStack Router's
 * `src/routeTree.gen.ts` generation and transform failures.
 *
 * The stock error path for a broken route file is:
 *   1. Router plugin's file watcher notices a change.
 *   2. It regenerates `routeTree.gen.ts`.
 *   3. If generation fails (name conflict, syntax error, missing
 *      export), Vite surfaces a raw stack trace to the terminal and a
 *      generic red overlay in the browser with the file path and line
 *      of the FAILING SOURCE — but no hint about which route file
 *      caused it, no hint about the classic causes ("two files claim
 *      `/`", "route file exports no default export"), and no
 *      cross-reference to the generated file.
 *
 * This plugin wraps that experience:
 *
 *   - TERMINAL: catches errors whose source path OR message references
 *     `routeTree.gen.ts` or `src/routes/`, prints a boxed, colored
 *     summary at the top of the failure, and appends the most likely
 *     causes for the specific error shape (duplicate route, missing
 *     export, invalid path param syntax). Original stack still prints
 *     so you can jump to the source line.
 *
 *   - BROWSER OVERLAY: intercepts Vite's HMR error payloads via
 *     `handleHotUpdate` / `configureServer` middleware and augments
 *     `err.message` + `err.frame` so the red overlay reads like a
 *     targeted diagnostic rather than a raw compiler dump.
 *
 * No-op in production. Additive to whatever the Lovable Tanstack
 * config already registers — this plugin does not replace the router
 * plugin, only decorates the errors it emits.
 */
import type { Plugin, ViteDevServer } from "vite";

const ROUTE_TREE_HINT = "src/routeTree.gen.ts";
const ROUTES_DIR_HINT = "src/routes/";

type ClassifiedError = {
  category: "duplicate-route" | "missing-export" | "invalid-param" | "syntax" | "unknown";
  hint: string;
};

function classify(message: string): ClassifiedError {
  if (/duplicate|already registered|conflict/i.test(message)) {
    return {
      category: "duplicate-route",
      hint: [
        "Two route files claim the same path.",
        "  • The most common offender is a leftover `src/routes/_app/index.tsx`",
        "    conflicting with `src/routes/index.tsx` — delete the `_app/` file.",
        "  • Also check for a `.tsx` + `.ts` pair with the same basename.",
      ].join("\n"),
    };
  }
  if (/no default export|missing export|createFileRoute/i.test(message)) {
    return {
      category: "missing-export",
      hint: [
        "A route file under `src/routes/` is missing its `export const Route = createFileRoute(...)`.",
        "  • Every route file must export a `Route` created via `createFileRoute('/…')`.",
        "  • Check the file path shown below for a stray default export or a typo.",
      ].join("\n"),
    };
  }
  if (/param|\$[a-zA-Z]|splat|catch-all/i.test(message)) {
    return {
      category: "invalid-param",
      hint: [
        "Path param syntax looks off.",
        "  • Dynamic segment: `posts.$postId.tsx` → `/posts/:postId`",
        "  • Splat: `docs.$.tsx` → `/docs/*`",
        "  • Do NOT use directory nesting (`posts/[id].tsx`) — flat dot syntax only.",
      ].join("\n"),
    };
  }
  if (/Unexpected token|SyntaxError|Parse failure/i.test(message)) {
    return {
      category: "syntax",
      hint: [
        "A route file has a TypeScript / JSX syntax error.",
        "  • Unbalanced JSX tags, missing semicolons in imports, or an unterminated string literal.",
        "  • Fix the source file — the router plugin will regenerate `routeTree.gen.ts` on save.",
      ].join("\n"),
    };
  }
  return {
    category: "unknown",
    hint: [
      "Generic router-plugin failure. Common recovery steps:",
      "  • Save any route file to force a regeneration.",
      "  • Delete `src/routeTree.gen.ts` and restart the dev server (it will be re-emitted).",
      "  • Check for a route file that was renamed but left an editor swap file (`.swp`, `.tsx~`) behind.",
    ].join("\n"),
  };
}

function isRouteTreeError(payload: {
  message?: string;
  id?: string;
  file?: string;
  loc?: { file?: string };
}): boolean {
  const haystack = [
    payload.message ?? "",
    payload.id ?? "",
    payload.file ?? "",
    payload.loc?.file ?? "",
  ].join(" ");
  return haystack.includes(ROUTE_TREE_HINT) || haystack.includes(ROUTES_DIR_HINT);
}

function banner(title: string): string {
  const line = "─".repeat(Math.max(48, title.length + 4));
  return `\n\x1b[31m╭${line}╮\n│  ${title}\n╰${line}╯\x1b[0m`;
}

function formatTerminal(message: string, classified: ClassifiedError): string {
  return [
    banner(`routeTree generation failed (${classified.category})`),
    "",
    "\x1b[1mLikely cause:\x1b[0m",
    classified.hint,
    "",
    "\x1b[1mOriginal error:\x1b[0m",
    message,
    "",
    "\x1b[2mThe generated file lives at src/routeTree.gen.ts — do NOT hand-edit it.\x1b[0m",
    "",
  ].join("\n");
}

function formatOverlay(message: string, classified: ClassifiedError): string {
  return [
    `⚠ routeTree generation failed (${classified.category})`,
    "",
    "Likely cause:",
    classified.hint,
    "",
    "──────────────",
    "Original error:",
    message,
  ].join("\n");
}

export function routeTreeErrorReporter(): Plugin {
  let server: ViteDevServer | undefined;

  return {
    name: "lovable:route-tree-error-reporter",
    apply: "serve",
    enforce: "post",

    configureServer(devServer) {
      server = devServer;

      // Wrap the server's error emitter so router-plugin failures print
      // our banner BEFORE Vite's stock stack trace. We do not replace
      // Vite's logger — appending to it keeps every other error path
      // unaffected.
      const originalError = devServer.config.logger.error.bind(devServer.config.logger);
      devServer.config.logger.error = (msg, options) => {
        const raw = typeof msg === "string" ? msg : String(msg);
        if (isRouteTreeError({ message: raw })) {
          const classified = classify(raw);
          originalError(formatTerminal(raw, classified), options);
          return;
        }
        originalError(msg, options);
      };

      // Wrap the WebSocket send so we can decorate `err` payloads
      // before Vite ships them to the browser overlay. This is the
      // narrowest hook that reliably fires for BOTH transform errors
      // and plugin-thrown errors, without patching Vite internals.
      const ws = devServer.ws;
      const originalSend = ws.send.bind(ws);
      ws.send = ((payload: unknown) => {
        try {
          const p = payload as {
            type?: string;
            err?: {
              message?: string;
              stack?: string;
              id?: string;
              loc?: { file?: string };
              plugin?: string;
            };
          };
          if (p && p.type === "error" && p.err && isRouteTreeError(p.err)) {
            const classified = classify(p.err.message ?? "");
            p.err.message = formatOverlay(p.err.message ?? "(no message)", classified);
            // Prefix plugin name so the overlay's badge is descriptive.
            p.err.plugin = p.err.plugin ? `${p.err.plugin} (routeTree)` : "routeTree";
          }
        } catch {
          // Never let overlay decoration crash the HMR channel.
        }
        return originalSend(payload as never);
      }) as typeof ws.send;
    },

    // Terminal fallback for errors that never reach the logger (some
    // internal plugin errors are just re-thrown). `buildEnd` fires with
    // the terminal error when a build attempt fails.
    buildEnd(error) {
      if (!error) return;
      if (!isRouteTreeError({ message: error.message })) return;
      const classified = classify(error.message);
      // Use process.stderr directly so the banner appears even if
      // Vite's logger has already flushed.
      process.stderr.write(formatTerminal(error.message, classified));
      // Also broadcast to any connected clients so an overlay appears
      // even for build-time failures during initial cold start.
      server?.ws.send({
        type: "error",
        err: {
          message: formatOverlay(error.message, classified),
          stack: error.stack ?? "",
          plugin: "routeTree",
        },
      });
    },
  };
}

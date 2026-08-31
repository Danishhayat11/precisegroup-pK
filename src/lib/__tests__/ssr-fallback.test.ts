// Verifies the catastrophic-SSR fallback contract:
//   1. response status 500 with text/html body
//   2. response carries an `x-error-id` header
//   3. the same ID is rendered inside the HTML error page
//
// Two scenarios:
//   a) the bundled server entry THROWS synchronously (try/catch path)
//   b) the bundled server entry RETURNS an h3-swallowed 500 JSON Response
//      (normalizeCatastrophicSsrResponse path)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the Supabase admin recorder — server.ts pulls it transitively and we
// don't want this unit test to touch the network.
vi.mock("@/lib/ssr-error-log.server", () => ({
  recordSsrError: vi.fn(),
}));
vi.mock("../ssr-error-log.server", () => ({
  recordSsrError: vi.fn(),
}));

// Controllable mock of the TanStack server entry that src/server.ts lazy-imports.
const entryFetch =
  vi.fn<(req: Request, env: unknown, ctx: unknown) => Promise<Response> | Response>();
vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: (req: Request, env: unknown, ctx: unknown) => entryFetch(req, env, ctx) },
}));

const ID_PATTERN = /^[0-9A-Z]{8}-[0-9A-Z]{8}$/;

async function loadServer() {
  // Re-import per test so the cached `serverEntryPromise` inside src/server.ts
  // picks up the freshly-reset entryFetch mock.
  vi.resetModules();
  const mod = await import("../../server");
  return mod.default as { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
}

describe("catastrophic-SSR fallback", () => {
  beforeEach(() => {
    entryFetch.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns x-error-id header and renders the same ID in HTML when the entry throws", async () => {
    entryFetch.mockImplementation(() => {
      throw new Error("boom from server entry");
    });
    const server = await loadServer();

    const res = await server.fetch(new Request("https://example.test/dashboard?x=1"), {}, {});

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");

    const headerId = res.headers.get("x-error-id");
    expect(headerId).toBeTruthy();
    expect(headerId!).toMatch(ID_PATTERN);

    const html = await res.text();
    expect(html).toContain('id="err-id"');
    // The ID rendered into the page MUST equal the one advertised in the header.
    const m = html.match(/<code id="err-id">([^<]+)<\/code>/);
    expect(m, 'rendered error page must include an <code id="err-id"> element').not.toBeNull();
    expect(m![1]).toBe(headerId);
  });

  it("normalizes an h3-swallowed 500 JSON response into the branded fallback with matching x-error-id", async () => {
    entryFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 500, unhandled: true, message: "HTTPError" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    const server = await loadServer();

    const res = await server.fetch(new Request("https://example.test/"), {}, {});

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");

    const headerId = res.headers.get("x-error-id");
    expect(headerId).toBeTruthy();
    expect(headerId!).toMatch(ID_PATTERN);

    const html = await res.text();
    const m = html.match(/<code id="err-id">([^<]+)<\/code>/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(headerId);

    // The page also wires the same ID into the copy button.
    expect(html).toContain(`writeText('${headerId}')`);
  });

  it("passes successful responses through untouched (no x-error-id added)", async () => {
    entryFetch.mockResolvedValue(
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const server = await loadServer();

    const res = await server.fetch(new Request("https://example.test/"), {}, {});

    expect(res.status).toBe(200);
    expect(res.headers.get("x-error-id")).toBeNull();
    expect(await res.text()).toBe("ok");
  });
});

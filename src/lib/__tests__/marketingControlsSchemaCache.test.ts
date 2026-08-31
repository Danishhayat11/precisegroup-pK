/**
 * Regression test: after a PostgREST schema cache refresh, the server function
 * path must be able to read `public.marketing_controls` without the
 * "Could not find the table ... in the schema cache" error (PGRST205/PGRST100).
 *
 * We exercise the same Data API surface the server function uses
 * (`.from("marketing_controls").select(...)`) with the publishable key.
 * RLS may legitimately return zero rows for an unauthenticated caller — that
 * is fine. What must NOT happen is a schema-discovery failure.
 *
 * The test is skipped when Supabase env vars are absent (offline CI).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";

function loadEnvFile() {
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (!key || process.env[key]) continue;
    process.env[key] = (rawValue ?? "").replace(/^["']|["']$/g, "");
  }
}

let url = "";
let key = "";

beforeAll(() => {
  loadEnvFile();
  url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
  key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "";
});

const SCHEMA_CACHE_CODES = new Set(["PGRST100", "PGRST202", "PGRST205"]);

async function selectFrom(table: string) {
  const res = await fetch(`${url}/rest/v1/${table}?select=section_key,is_enabled&limit=1`, {
    headers: { apikey: key, Accept: "application/json" },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

describe("marketing_controls schema cache", () => {
  it("reads public.marketing_controls without a schema-cache miss", async () => {
    if (!url || !key) {
      // No backend credentials available in this environment.
      expect(true).toBe(true);
      return;
    }

    const { status, body } = await selectFrom("marketing_controls");

    const err = body as { code?: string; message?: string } | null;
    const code = err && typeof err === "object" ? err.code : undefined;
    const message = err && typeof err === "object" ? (err.message ?? "") : "";

    expect(
      code && SCHEMA_CACHE_CODES.has(code),
      `Schema cache miss for public.marketing_controls: ${JSON.stringify(body)}`,
    ).toBeFalsy();
    expect(message).not.toMatch(/Could not find the table/i);
    // 200 (rows or empty) is the healthy outcome; 401/403 would mean auth,
    // never a missing table.
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  }, 20_000);

  it("reads public.marketing_controls_history without a schema-cache miss", async () => {
    if (!url || !key) {
      expect(true).toBe(true);
      return;
    }

    const res = await fetch(`${url}/rest/v1/marketing_controls_history?select=id&limit=1`, {
      headers: { apikey: key, Accept: "application/json" },
    });
    const body = (await res.json()) as { code?: string; message?: string } | unknown[];
    const code = Array.isArray(body) ? undefined : body.code;
    const message = Array.isArray(body) ? "" : (body.message ?? "");

    expect(
      code && SCHEMA_CACHE_CODES.has(code),
      `Schema cache miss for public.marketing_controls_history: ${JSON.stringify(body)}`,
    ).toBeFalsy();
    expect(message).not.toMatch(/Could not find the table/i);
  }, 20_000);
});

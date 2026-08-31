/**
 * Tests for the single source-of-truth "today" — `@/lib/systemDate`.
 *
 * Verifies that:
 *  - `fetchSystemDate()` returns the override stored in app_settings when present
 *  - falls back to local YYYY-MM-DD when no override is set
 *  - caches results for the TTL window
 *  - `invalidateSystemDate()` forces a refetch
 *  - `setSystemDateOverride()` upserts when given a date and deletes when null
 *
 * The supabase client is mocked so the test is hermetic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory store the mocked client reads from / writes to.
const store: { value: { date: string } | null } = { value: null };
const calls = { select: 0, upsert: 0, del: 0 };

vi.mock("@/integrations/supabase/client", () => {
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      maybeSingle: vi.fn(async () => {
        calls.select += 1;
        return { data: store.value === null ? null : { value: store.value }, error: null };
      }),
    })),
  }));
  const upsert = vi.fn(async (row: { key: string; value: { date: string } }) => {
    calls.upsert += 1;
    store.value = row.value;
    return { error: null };
  });
  const del = vi.fn(() => ({
    eq: vi.fn(async () => {
      calls.del += 1;
      store.value = null;
      return { error: null };
    }),
  }));
  return {
    supabase: {
      from: vi.fn((_table: string) => ({ select, upsert, delete: del })),
    },
  };
});

import {
  fetchSystemDate,
  invalidateSystemDate,
  getSystemDateSync,
  setSystemDateOverride,
} from "@/lib/systemDate";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

beforeEach(() => {
  store.value = null;
  calls.select = 0;
  calls.upsert = 0;
  calls.del = 0;
  invalidateSystemDate();
});

describe("systemDate — single source of truth", () => {
  it("returns local today when no override is set", async () => {
    const d = await fetchSystemDate();
    expect(d).toMatch(ISO);
    const localToday = new Date();
    const expected = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, "0")}-${String(localToday.getDate()).padStart(2, "0")}`;
    expect(d).toBe(expected);
  });

  it("returns the override date when one is present in app_settings", async () => {
    store.value = { date: "2030-04-15" };
    expect(await fetchSystemDate()).toBe("2030-04-15");
  });

  it("ignores malformed override values and falls back to local today", async () => {
    // Runtime guard accepts any string; we feed a non-ISO value on purpose.
    store.value = { date: "not-a-date" };
    const d = await fetchSystemDate();
    expect(d).toMatch(ISO);
    expect(d).not.toBe("not-a-date");
  });

  it("caches the result and reuses it within the TTL window", async () => {
    store.value = { date: "2030-01-01" };
    await fetchSystemDate();
    await fetchSystemDate();
    await fetchSystemDate();
    expect(calls.select).toBe(1);
  });

  it("invalidateSystemDate() forces a fresh fetch", async () => {
    store.value = { date: "2030-01-01" };
    await fetchSystemDate();
    invalidateSystemDate();
    store.value = { date: "2031-12-31" };
    expect(await fetchSystemDate()).toBe("2031-12-31");
    expect(calls.select).toBe(2);
  });

  it("getSystemDateSync mirrors the most-recently fetched date", async () => {
    store.value = { date: "2032-07-04" };
    await fetchSystemDate();
    expect(getSystemDateSync()).toBe("2032-07-04");
  });

  it("setSystemDateOverride upserts a date and clears the cache", async () => {
    store.value = { date: "2030-01-01" };
    await fetchSystemDate();
    await setSystemDateOverride("2040-06-30");
    // upsert was called; cache was invalidated; the next fetch sees the new value.
    expect(calls.upsert).toBe(1);
    expect(await fetchSystemDate()).toBe("2040-06-30");
  });

  it("setSystemDateOverride(null) deletes the override row", async () => {
    store.value = { date: "2040-06-30" };
    await fetchSystemDate();
    await setSystemDateOverride(null);
    expect(calls.del).toBe(1);
    const d = await fetchSystemDate();
    expect(d).toMatch(ISO);
    expect(d).not.toBe("2040-06-30");
  });
});

import { describe, it, expect } from "vitest";
import { buildJsonExportMetadata } from "../csvExportMetadata";

/**
 * Snapshot tests that pin the EXACT JSON envelope shape produced by
 * `buildJsonExportMetadata` for colliding-key scenarios. Any change to
 * field order, key derivation, dedup suffixing, or label fallback will
 * flip a snapshot — that's the point. If a change is intentional, the
 * reviewer regenerates the snapshot; if it's accidental, CI catches it
 * before the wire format drifts under downstream tooling (saved views,
 * replay, external importers).
 *
 * We use `toMatchInlineSnapshot` so the expected shape lives right next
 * to the test — no separate __snapshots__ file to hunt through, and
 * diffs on the wire format are unmissable in code review.
 */

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Strip the top-level `generatedAt` so snapshots stay stable. */
function withStableTimestamp(input: Parameters<typeof buildJsonExportMetadata>[0]) {
  return buildJsonExportMetadata({ ...input, generatedAt: FIXED_DATE });
}

describe("buildJsonExportMetadata — colliding-key envelope snapshots", () => {
  it("explicit key first, colliding label-only second", () => {
    const meta = withStableTimestamp({
      source: "Bookings",
      columns: [{ key: "amount", label: "Cash" }, { label: "Amount" }],
    });
    expect(meta).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "amount",
            "label": "Cash",
            "order": 0,
          },
          {
            "key": "amount_2",
            "label": "Amount",
            "order": 1,
          },
        ],
        "generatedAt": "2026-07-07T10:00:00.000Z",
        "schema": "precise-realtors.csv-export-metadata",
        "source": "Bookings",
        "version": 1,
      }
    `);
  });

  it("label-only first, colliding explicit key second (order swap)", () => {
    // Swapping the declaration order must NOT change key derivation
    // rules — the label-derived key still wins the base slot because it
    // reached the derivation helper first, and the later explicit
    // "amount" shifts to "amount_2". Labels stay in declaration order.
    const meta = withStableTimestamp({
      source: "Bookings",
      columns: [{ label: "Amount" }, { key: "amount", label: "Cash" }],
    });
    expect(meta).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "amount",
            "label": "Amount",
            "order": 0,
          },
          {
            "key": "amount_2",
            "label": "Cash",
            "order": 1,
          },
        ],
        "generatedAt": "2026-07-07T10:00:00.000Z",
        "schema": "precise-realtors.csv-export-metadata",
        "source": "Bookings",
        "version": 1,
      }
    `);
  });

  it("three-way collision: two explicit 'amount' + one label 'Amount'", () => {
    const meta = withStableTimestamp({
      source: "Bookings",
      columns: [
        { key: "amount", label: "Cash" },
        { key: "amount", label: "Bank" },
        { label: "Amount" },
      ],
    });
    expect(meta).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "amount",
            "label": "Cash",
            "order": 0,
          },
          {
            "key": "amount_2",
            "label": "Bank",
            "order": 1,
          },
          {
            "key": "amount_3",
            "label": "Amount",
            "order": 2,
          },
        ],
        "generatedAt": "2026-07-07T10:00:00.000Z",
        "schema": "precise-realtors.csv-export-metadata",
        "source": "Bookings",
        "version": 1,
      }
    `);
  });

  it("three-way collision with explicit key in the MIDDLE", () => {
    // Same three columns as above but reordered — pins that insertion
    // position drives suffix assignment.
    const meta = withStableTimestamp({
      source: "Bookings",
      columns: [
        { label: "Amount" },
        { key: "amount", label: "Cash" },
        { key: "amount", label: "Bank" },
      ],
    });
    expect(meta).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "amount",
            "label": "Amount",
            "order": 0,
          },
          {
            "key": "amount_2",
            "label": "Cash",
            "order": 1,
          },
          {
            "key": "amount_3",
            "label": "Bank",
            "order": 2,
          },
        ],
        "generatedAt": "2026-07-07T10:00:00.000Z",
        "schema": "precise-realtors.csv-export-metadata",
        "source": "Bookings",
        "version": 1,
      }
    `);
  });

  it("three-way collision with explicit key LAST", () => {
    const meta = withStableTimestamp({
      source: "Bookings",
      columns: [{ label: "Amount" }, { label: "amount!" }, { key: "amount", label: "Cash" }],
    });
    expect(meta).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "amount",
            "label": "Amount",
            "order": 0,
          },
          {
            "key": "amount_2",
            "label": "amount!",
            "order": 1,
          },
          {
            "key": "amount_3",
            "label": "Cash",
            "order": 2,
          },
        ],
        "generatedAt": "2026-07-07T10:00:00.000Z",
        "schema": "precise-realtors.csv-export-metadata",
        "source": "Bookings",
        "version": 1,
      }
    `);
  });

  it("case + punctuation collisions all funnel to the same base", () => {
    // "Amount", "amount!", "AMOUNT?", "  amount  " all slugify to
    // "amount" — expect base, _2, _3, _4 in declaration order.
    const meta = withStableTimestamp({
      source: "Bookings",
      columns: [
        { label: "Amount" },
        { label: "amount!" },
        { label: "AMOUNT?" },
        { label: "  amount  " },
      ],
    });
    expect(meta).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "amount",
            "label": "Amount",
            "order": 0,
          },
          {
            "key": "amount_2",
            "label": "amount!",
            "order": 1,
          },
          {
            "key": "amount_3",
            "label": "AMOUNT?",
            "order": 2,
          },
          {
            "key": "amount_4",
            "label": "amount",
            "order": 3,
          },
        ],
        "generatedAt": "2026-07-07T10:00:00.000Z",
        "schema": "precise-realtors.csv-export-metadata",
        "source": "Bookings",
        "version": 1,
      }
    `);
  });

  it("literal-suffix collision: [Amount, amount!, amount_2] → base bumps past the literal", () => {
    // The uniqueness-preserving dedup path. The literal "amount_2"
    // label reaches the derivation helper AFTER the second "amount"
    // slug has already claimed "amount_2", so the literal shifts to
    // "amount_2_2". Snapshot pins this so a future change to the
    // walk-past logic is visible in review.
    const meta = withStableTimestamp({
      source: "Bookings",
      columns: [{ label: "Amount" }, { label: "amount!" }, { label: "amount_2" }],
    });
    expect(meta).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "amount",
            "label": "Amount",
            "order": 0,
          },
          {
            "key": "amount_2",
            "label": "amount!",
            "order": 1,
          },
          {
            "key": "amount_2_2",
            "label": "amount_2",
            "order": 2,
          },
        ],
        "generatedAt": "2026-07-07T10:00:00.000Z",
        "schema": "precise-realtors.csv-export-metadata",
        "source": "Bookings",
        "version": 1,
      }
    `);
  });

  it("unicode-only labels: all collapse to 'column' base with declaration-order dedup", () => {
    const meta = withStableTimestamp({
      source: "Bookings",
      columns: [{ label: "北京" }, { label: "☕" }, { label: "—" }],
    });
    expect(meta).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "column",
            "label": "北京",
            "order": 0,
          },
          {
            "key": "column_2",
            "label": "☕",
            "order": 1,
          },
          {
            "key": "column_3",
            "label": "—",
            "order": 2,
          },
        ],
        "generatedAt": "2026-07-07T10:00:00.000Z",
        "schema": "precise-realtors.csv-export-metadata",
        "source": "Bookings",
        "version": 1,
      }
    `);
  });

  it("mixed string + object entries, colliding explicit key in the middle", () => {
    const meta = withStableTimestamp({
      source: "Bookings",
      columns: ["Project", { key: "pid", label: "Project ID" }, { label: "Project" }],
    });
    expect(meta).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "project",
            "label": "Project",
            "order": 0,
          },
          {
            "key": "pid",
            "label": "Project ID",
            "order": 1,
          },
          {
            "key": "project_2",
            "label": "Project",
            "order": 2,
          },
        ],
        "generatedAt": "2026-07-07T10:00:00.000Z",
        "schema": "precise-realtors.csv-export-metadata",
        "source": "Bookings",
        "version": 1,
      }
    `);
  });

  it("full envelope with filters + sort + counts alongside colliding columns", () => {
    // End-to-end snapshot including sibling fields, so the pinned shape
    // covers the whole wire format — not just `columns`. Any future
    // reshuffle of top-level keys, sort direction serialization, or
    // filter-sentinel handling flips this snapshot.
    const meta = withStableTimestamp({
      source: "Bookings",
      filters: { status: "active", agent: "all", city: "" },
      sort: { key: "sold_date", dir: "desc" },
      counts: { shown: 25, filtered: 25, total: 500 },
      columns: [{ key: "amount", label: "Cash" }, { label: "Amount" }],
    });
    expect(meta).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "amount",
            "label": "Cash",
            "order": 0,
          },
          {
            "key": "amount_2",
            "label": "Amount",
            "order": 1,
          },
        ],
        "counts": {
          "filtered": 25,
          "shown": 25,
          "total": 500,
        },
        "filters": {
          "status": "active",
        },
        "generatedAt": "2026-07-07T10:00:00.000Z",
        "schema": "precise-realtors.csv-export-metadata",
        "sort": {
          "dir": "desc",
          "key": "sold_date",
        },
        "source": "Bookings",
        "version": 1,
      }
    `);
  });
});

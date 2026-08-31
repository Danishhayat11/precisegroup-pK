import { describe, it, expect, beforeEach } from "vitest";
import { prefixCsvWithMetadata } from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";
import {
  registerCsvReplayer,
  unregisterCsvReplayer,
  hasCsvReplayer,
  listCsvReplaySources,
  replayCsvExport,
  CsvReplayError,
} from "../csvReplay";

// --- Fixture: a "Bookings" data source and its exporter ----------------------

type Booking = { id: string; sold_on: string; amount: number; client: string };

const DATASET: Booking[] = [
  { id: "BK1", sold_on: "2026-01-01", amount: 1000, client: "Alice" },
  { id: "BK2", sold_on: "2026-01-15", amount: 2500, client: "Bob" },
  { id: "BK3", sold_on: "2026-02-02", amount: 1500, client: "Cara" },
];

const COLUMN_DEFS: Record<string, { label: string; get: (b: Booking) => string | number }> = {
  id: { label: "Booking ID", get: (b) => b.id },
  sold_on: { label: "Sold On", get: (b) => b.sold_on },
  amount: { label: "Amount (PKR)", get: (b) => b.amount },
  client: { label: "Client", get: (b) => b.client },
};

function esc(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function runBookingsQuery(opts: {
  filters: Record<string, string>;
  sort: { key: string; dir: "asc" | "desc" } | null;
  columnKeys: string[];
}) {
  let rows = DATASET.slice();
  if (opts.filters.from) rows = rows.filter((r) => r.sold_on >= opts.filters.from);
  if (opts.filters.to) rows = rows.filter((r) => r.sold_on <= opts.filters.to);
  if (opts.sort) {
    const { key, dir } = opts.sort;
    rows.sort((a, b) => {
      const av = (a as unknown as Record<string, string | number>)[key];
      const bv = (b as unknown as Record<string, string | number>)[key];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  const cols = opts.columnKeys
    .map((k) => (COLUMN_DEFS[k] ? { key: k, ...COLUMN_DEFS[k] } : null))
    .filter((c): c is { key: string; label: string; get: (b: Booking) => string | number } => !!c);
  const header = cols.map((c) => esc(c.label)).join(",");
  const data = rows.map((r) => cols.map((c) => esc(c.get(r))).join(","));
  return { rows, cols, body: [header, ...data].join("\r\n") + "\r\n" };
}

/** Original exporter — matches the pattern used in Dashboard/DataHealth. */
function exportBookingsCsv(opts: {
  from?: string;
  to?: string;
  sort?: { key: string; dir: "asc" | "desc" };
  columnKeys: string[];
}) {
  const filters = {
    from: opts.from ?? "",
    to: opts.to ?? "",
    status: "all", // sentinel — will be dropped by the writer
  };
  const query = runBookingsQuery({
    filters: { from: opts.from ?? "", to: opts.to ?? "" },
    sort: opts.sort ?? null,
    columnKeys: opts.columnKeys,
  });
  return prefixCsvWithMetadata(query.body, {
    source: "Bookings — Table",
    filters,
    sort: opts.sort ?? null,
    counts: { shown: query.rows.length, total: DATASET.length },
    columns: query.cols.map((c) => ({ key: c.key, label: c.label })),
    generatedAt: new Date("2026-07-07T10:00:00Z"),
  });
}

// --- Suite -------------------------------------------------------------------

describe("replayCsvExport", () => {
  beforeEach(() => {
    unregisterCsvReplayer("Bookings — Table");
    // Register the replayer for our fixture source. It reads filters/sort/
    // columns from the parsed metadata and re-runs the SAME query.
    registerCsvReplayer("Bookings — Table", (ctx) => {
      const columnKeys = ctx.columns.map((c) => c.key).filter((k): k is string => !!k);
      const sort = ctx.sort;
      const filters = { from: ctx.filters.from ?? "", to: ctx.filters.to ?? "" };
      const query = runBookingsQuery({ filters, sort, columnKeys });
      return {
        kind: "body",
        body: query.body,
        overrides: { counts: { shown: query.rows.length, total: DATASET.length } },
      };
    });
  });

  it("registers and lists replay sources", () => {
    expect(hasCsvReplayer("Bookings — Table")).toBe(true);
    expect(listCsvReplaySources()).toContain("Bookings — Table");
  });

  it("reproduces the original body byte-for-byte from just the metadata header", async () => {
    const original = exportBookingsCsv({
      from: "2026-01-10",
      to: "2026-12-31",
      sort: { key: "sold_on", dir: "desc" },
      columnKeys: ["id", "sold_on", "amount", "client"],
    });

    // Simulate "user hands us just the downloaded file". Replay from text.
    const replayed = await replayCsvExport(original);

    // Body (header row + data rows) must match — the reproduced query
    // returned identical rows in identical order using identical columns.
    const origBody = original.split("\n\n").slice(1).join("\n\n");
    const newBody = replayed.csv.split("\n\n").slice(1).join("\n\n");
    expect(newBody).toBe(origBody);

    // Metadata carries over: filters + sort + ordered columns preserved.
    const origMeta = parseCsvMetadataHeader(original);
    const newMeta = parseCsvMetadataHeader(replayed.csv);
    expect(newMeta.filters).toEqual(origMeta.filters);
    expect(newMeta.sort).toEqual(origMeta.sort);
    expect(newMeta.columns?.map((c) => c.key)).toEqual(origMeta.columns?.map((c) => c.key));
    expect(newMeta.columns?.map((c) => c.label)).toEqual(origMeta.columns?.map((c) => c.label));
    expect(newMeta.counts).toEqual(origMeta.counts);
    expect(replayed.source).toBe("Bookings — Table");
  });

  it("replays a user-reordered subset of columns in the recorded order", async () => {
    const original = exportBookingsCsv({
      sort: { key: "amount", dir: "asc" },
      columnKeys: ["client", "amount"], // reordered subset
    });
    const replayed = await replayCsvExport(original);
    const [headerRow, ...body] = replayed.csv
      .split("\n\n")[1]
      .split(/\r\n|\n/)
      .filter((l) => l.length > 0);
    expect(headerRow).toBe("Client,Amount (PKR)");
    // Sorted ascending by amount → 1000, 1500, 2500.
    expect(body).toEqual(["Alice,1000", "Cara,1500", "Bob,2500"]);
  });

  it("throws no-metadata for a plain CSV without a header block", async () => {
    await expect(replayCsvExport("a,b\n1,2\n")).rejects.toBeInstanceOf(CsvReplayError);
    await expect(replayCsvExport("a,b\n1,2\n")).rejects.toMatchObject({
      code: "no-metadata",
    });
  });

  it("throws no-replayer when the source has no registered handler", async () => {
    const csv = prefixCsvWithMetadata("a,b\n1,2\n", {
      source: "Unknown — Source",
      generatedAt: new Date("2026-07-07T10:00:00Z"),
    });
    await expect(replayCsvExport(csv)).rejects.toMatchObject({ code: "no-replayer" });
  });

  it("accepts a raw-csv result from a replayer (no envelope wrapping)", async () => {
    registerCsvReplayer("Raw — Source", () => ({
      kind: "csv",
      csv: "# Precise Realtors — Raw — Source\n# Generated: X\n\na\n1\n",
    }));
    const csv = prefixCsvWithMetadata("a\n1\n", {
      source: "Raw — Source",
      generatedAt: new Date("2026-07-07T10:00:00Z"),
    });
    const out = await replayCsvExport(csv);
    expect(out.csv).toContain("# Precise Realtors — Raw — Source");
  });

  it(
    "reproduces the body byte-for-byte when the original export used label-only columns " +
      "(keys now derived by the writer)",
    async () => {
      // Simulate an older/legacy exporter that only knew labels — no explicit
      // keys. The writer now always slugifies + emits `# Column keys:`, so a
      // replayer that reads ctx.columns[*].key should still be able to
      // reproduce the exact same body.
      const generatedAt = new Date("2026-07-07T10:00:00Z");
      const labelOnlyColumns = [
        { label: "Booking ID" }, // → key "booking_id"
        { label: "Sold On" }, // → key "sold_on"
        { label: "Amount (PKR)" }, // → key "amount_pkr"
        { label: "Client" }, // → key "client"
      ];
      // Build the same body the fixture query produces for these columns,
      // ordered/filtered the same way as the recorded metadata.
      const query = runBookingsQuery({
        filters: { from: "2026-01-10", to: "2026-12-31" },
        sort: { key: "sold_on", dir: "desc" },
        columnKeys: ["id", "sold_on", "amount", "client"],
      });
      const original = prefixCsvWithMetadata(query.body, {
        source: "Legacy Bookings",
        filters: { from: "2026-01-10", to: "2026-12-31", status: "all" },
        sort: { key: "sold_on", dir: "desc" },
        counts: { shown: query.rows.length, total: DATASET.length },
        columns: labelOnlyColumns,
        generatedAt,
      });

      // Sanity: the writer derived stable keys from the labels alone.
      const origMeta = parseCsvMetadataHeader(original);
      expect(origMeta.columns?.map((c) => c.key)).toEqual([
        "booking_id",
        "sold_on",
        "amount_pkr",
        "client",
      ]);
      expect(origMeta.columns?.every((c) => !!c.key && c.key.length > 0)).toBe(true);

      // Register a replayer that keys off the DERIVED keys (label → slug),
      // proving downstream tooling can rely on ctx.columns[*].key even when
      // the original caller only had labels.
      const SLUG_TO_DATA_KEY: Record<string, string> = {
        booking_id: "id",
        sold_on: "sold_on",
        amount_pkr: "amount",
        client: "client",
      };
      registerCsvReplayer("Legacy Bookings", (ctx) => {
        const columnKeys = ctx.columns.map((c) => SLUG_TO_DATA_KEY[c.key] ?? c.key);
        const filters = { from: ctx.filters.from ?? "", to: ctx.filters.to ?? "" };
        const q = runBookingsQuery({ filters, sort: ctx.sort, columnKeys });
        return {
          kind: "body",
          body: q.body,
          overrides: { counts: { shown: q.rows.length, total: DATASET.length } },
        };
      });

      const replayed = await replayCsvExport(original);

      // Byte-for-byte body match (header row + all data rows, CRLF and all).
      const origBody = original.split("\n\n").slice(1).join("\n\n");
      const newBody = replayed.csv.split("\n\n").slice(1).join("\n\n");
      expect(newBody).toBe(origBody);

      // And the reproduced metadata carries the same derived keys + labels
      // in the same order — a downstream re-replay would work identically.
      const newMeta = parseCsvMetadataHeader(replayed.csv);
      expect(newMeta.columns?.map((c) => c.key)).toEqual(origMeta.columns?.map((c) => c.key));
      expect(newMeta.columns?.map((c) => c.label)).toEqual(origMeta.columns?.map((c) => c.label));

      unregisterCsvReplayer("Legacy Bookings");
    },
  );

  it("aligns filters/sort/columns by stable key even when labels are renamed after the fact", async () => {
    // Original file: writer used LABELS in filters + sort tokens (a common
    // pattern), plus explicit column keys.
    const generatedAt = new Date("2026-07-07T10:00:00Z");
    const originalCsv = prefixCsvWithMetadata("dummy_header\n", {
      source: "Renamed Bookings",
      // Filter tokens use LABELS (a common writer pattern). Sort uses the
      // label "Client" — single-word to survive the current # Sort: regex.
      filters: { "Sold On": "2026-01-10..2026-12-31", Client: "Acme" },
      sort: { key: "Client", dir: "desc" },
      columns: [
        { key: "id", label: "Booking ID" },
        { key: "sold_on", label: "Sold On" }, // label about to be "renamed"
        { key: "amount", label: "Amount" },
        { key: "client", label: "Client" }, // label about to be "renamed"
      ],
      generatedAt,
    });

    // Simulate a later product rename: "Sold On" → "Deal Date", "Client"
    // → "Buyer". Rewrite ONLY the # Columns line's display labels; the
    // stable # Column keys: line and the # Filters: / # Sort: lines still
    // reference the ORIGINAL label text.
    const renamedCsv = originalCsv.replace(
      "# Columns (4, in order): Booking ID | Sold On | Amount | Client",
      "# Columns (4, in order): Booking ID | Deal Date | Amount | Buyer",
    );

    let captured: any = null;
    registerCsvReplayer("Renamed Bookings", (ctx) => {
      captured = {
        filtersByColumnKey: ctx.filtersByColumnKey,
        sortKey: ctx.sort?.key ?? null,
        columnKeys: ctx.columnKeys,
        soldOnCol: ctx.columnsByKey["sold_on"] ?? null,
      };
      return { kind: "body", body: "x\n1\n" };
    });

    await replayCsvExport(renamedCsv);
    unregisterCsvReplayer("Renamed Bookings");

    // Filter tokens written as labels rekey to stable column keys via the
    // slugify fallback — "Sold On" → "sold_on", "Client" → "client" —
    // even though those labels are no longer present in the CSV.
    expect(captured.filtersByColumnKey).toEqual({
      sold_on: "2026-01-10..2026-12-31",
      client: "Acme",
    });
    // Sort token "Client" (a stale label) is normalised to the stable key.
    expect(captured.sortKey).toBe("client");
    // Column order is preserved via keys, independent of the new labels.
    expect(captured.columnKeys).toEqual(["id", "sold_on", "amount", "client"]);
    // Looked-up column exposes the CURRENT (renamed) label, keyed by the
    // stable identifier — proving replayers can bind to keys, not labels.
    expect(captured.soldOnCol).toEqual({
      key: "sold_on",
      label: "Deal Date",
      index: 1,
    });
  });

  it("leaves unknown filter tokens under their original name (no accidental rekey)", async () => {
    const generatedAt = new Date("2026-07-07T10:00:00Z");
    const csv = prefixCsvWithMetadata("h\n1\n", {
      source: "Passthrough Bookings",
      filters: { Region: "North", amount: "gt:1000" },
      columns: [{ key: "amount", label: "Amount (PKR)" }],
      generatedAt,
    });

    let captured: any = null;
    registerCsvReplayer("Passthrough Bookings", (ctx) => {
      captured = ctx.filtersByColumnKey;
      return { kind: "body", body: "h\n1\n" };
    });
    await replayCsvExport(csv);
    unregisterCsvReplayer("Passthrough Bookings");

    // "amount" matches a column key → stays under "amount".
    // "Region" matches no column key or label → passes through unchanged.
    expect(captured).toEqual({ amount: "gt:1000", Region: "North" });
  });
});

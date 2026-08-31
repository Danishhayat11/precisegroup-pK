import { describe, it, expect } from "vitest";
import { prefixCsvWithMetadata } from "../csvExportMetadata";
import { parseCsvMetadataHeader, stripCsvMetadataHeader } from "../csvMetadataParser";

/**
 * Minimal CSV row splitter for tests. Handles the exact escaping our
 * exporters use: comma separator, `"` quoting for cells containing
 * `,` `"` `\n` `\r`, doubled quotes for embedded `"`.
 */
function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  out.push(cell);
  return out;
}

/**
 * Reproduce the exact exporter pattern used across Dashboard,
 * ImportCenter, and DataHealth: given an ordered `columns` list and
 * source rows, build a CSV whose metadata `columns` line, header row,
 * and every data row all iterate the SAME `columns` array.
 */
function buildExportedCsv<T>(opts: {
  source: string;
  columns: Array<{ key: string; label: string; get: (row: T) => string | number }>;
  rows: T[];
}) {
  const { source, columns, rows } = opts;
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(",");
  const dataLines = rows.map((r) => columns.map((c) => esc(c.get(r))).join(","));
  const body = [header, ...dataLines].join("\r\n") + "\r\n";
  return prefixCsvWithMetadata(body, {
    source,
    columns: columns.map((c) => ({ key: c.key, label: c.label })),
    counts: { shown: rows.length, total: rows.length },
    generatedAt: new Date("2026-07-07T10:00:00Z"),
  });
}

type Booking = { id: string; sold_on: string; amount: number; client: string };

const COLUMNS = [
  { key: "id", label: "Booking ID", get: (b: Booking) => b.id },
  { key: "sold_on", label: "Sold On", get: (b: Booking) => b.sold_on },
  { key: "amount", label: "Amount (PKR)", get: (b: Booking) => b.amount },
  { key: "client", label: "Client", get: (b: Booking) => b.client },
];

const ROWS: Booking[] = [
  { id: "BK1", sold_on: "2026-01-01", amount: 1000, client: "Alice, Ltd." },
  { id: "BK2", sold_on: "2026-02-02", amount: 2500, client: 'Bob "Quoted" Co' },
];

describe("CSV export column alignment", () => {
  it("CSV header row matches the ordered labels in the metadata block", () => {
    const csv = buildExportedCsv({ source: "Bookings", columns: COLUMNS, rows: ROWS });
    const parsed = parseCsvMetadataHeader(csv);
    const body = stripCsvMetadataHeader(csv);
    const [headerRow] = body.split(/\r\n|\n/);

    expect(parsed.columns).not.toBeNull();
    const metaLabels = parsed.columns!.map((c) => c.label);
    const metaKeys = parsed.columns!.map((c) => c.key);

    expect(splitCsvRow(headerRow)).toEqual(metaLabels);
    expect(metaKeys).toEqual(COLUMNS.map((c) => c.key));
  });

  it("every data row has the same cell count as the metadata columns, in order", () => {
    const csv = buildExportedCsv({ source: "Bookings", columns: COLUMNS, rows: ROWS });
    const parsed = parseCsvMetadataHeader(csv);
    const bodyLines = stripCsvMetadataHeader(csv)
      .split(/\r\n|\n/)
      .filter((l) => l.length > 0);
    const dataLines = bodyLines.slice(1);

    expect(dataLines).toHaveLength(ROWS.length);
    const n = parsed.columns!.length;

    dataLines.forEach((line, i) => {
      const cells = splitCsvRow(line);
      expect(cells).toHaveLength(n);
      // Cell values equal the source row projected through the SAME
      // column order recorded in the metadata.
      const expected = COLUMNS.map((c) => String(c.get(ROWS[i])));
      expect(cells).toEqual(expected);
    });
  });

  it("column order is preserved when the exporter reorders columns", () => {
    // Simulate a user who dragged "Client" to the front of the picker.
    const reordered = [COLUMNS[3], COLUMNS[0], COLUMNS[2], COLUMNS[1]];
    const csv = buildExportedCsv({ source: "Bookings", columns: reordered, rows: ROWS });
    const parsed = parseCsvMetadataHeader(csv);
    const headerRow = stripCsvMetadataHeader(csv).split(/\r\n|\n/)[0];

    // Metadata order == exporter order == on-disk header row order.
    expect(parsed.columns!.map((c) => c.key)).toEqual(["client", "id", "amount", "sold_on"]);
    expect(splitCsvRow(headerRow)).toEqual(["Client", "Booking ID", "Amount (PKR)", "Sold On"]);
  });

  it("column order is preserved when a subset of columns is exported", () => {
    const subset = [COLUMNS[0], COLUMNS[2]]; // id + amount only
    const csv = buildExportedCsv({ source: "Bookings", columns: subset, rows: ROWS });
    const parsed = parseCsvMetadataHeader(csv);
    const [headerRow, ...dataRows] = stripCsvMetadataHeader(csv)
      .split(/\r\n|\n/)
      .filter((l) => l.length > 0);

    expect(parsed.columns!.map((c) => c.key)).toEqual(["id", "amount"]);
    expect(splitCsvRow(headerRow)).toEqual(["Booking ID", "Amount (PKR)"]);
    for (const line of dataRows) {
      expect(splitCsvRow(line)).toHaveLength(2);
    }
  });

  it("catches drift: if the CSV body drops a column, alignment fails", () => {
    // Build a KNOWN-BAD CSV where the metadata claims 4 columns but the
    // header/data only carry 3. The alignment assertion below is what
    // downstream audit tooling would use, and it must fail loudly.
    const csv = buildExportedCsv({ source: "Bookings", columns: COLUMNS, rows: ROWS });
    // Corrupt: strip the last cell from every body line.
    const [meta, body] = csv.split("\n\n");
    const corrupted =
      meta +
      "\n\n" +
      body
        .split(/\r\n|\n/)
        .map((line) => (line.length === 0 ? line : line.split(",").slice(0, -1).join(",")))
        .join("\r\n");

    const parsed = parseCsvMetadataHeader(corrupted);
    const headerRow = stripCsvMetadataHeader(corrupted).split(/\r\n|\n/)[0];
    expect(splitCsvRow(headerRow).length).not.toBe(parsed.columns!.length);
  });

  describe("explicit key wins over slugified label on collision", () => {
    // End-to-end integration: build a real CSV via `prefixCsvWithMetadata`
    // (the same call Dashboard / ImportCenter / DataHealth make), then
    // parse the emitted `# Column keys:` line back out with the actual
    // production parser. The invariant is: when a column declares an
    // explicit `key` that would slugify to the same value as another
    // column's label, the EXPLICIT key must reach the metadata block
    // unchanged; the label-only sibling is the one that gets a `_2`
    // suffix.

    it("explicit {key:'amount'} outranks a sibling {label:'Amount'} in the emitted CSV", () => {
      // Simulate a real exporter payload with two rows and two columns
      // whose keys collide under naive slugification.
      const rows = [
        { cash: 100, total: 500 },
        { cash: 200, total: 750 },
      ];
      const body =
        ["Cash,Amount", ...rows.map((r) => `${r.cash},${r.total}`)].join("\r\n") + "\r\n";

      const csv = prefixCsvWithMetadata(body, {
        source: "Bookings",
        columns: [
          { key: "amount", label: "Cash" }, // explicit key claims "amount"
          { label: "Amount" }, // label-only, would slugify to "amount"
        ],
        counts: { shown: rows.length, total: rows.length },
        generatedAt: new Date("2026-07-07T10:00:00Z"),
      });

      const parsed = parseCsvMetadataHeader(csv);
      expect(parsed.columns).not.toBeNull();
      // The explicit key wins the base slot; the label-only sibling gets
      // deduped to "amount_2".
      expect(parsed.columns!.map((c) => c.key)).toEqual(["amount", "amount_2"]);
      // Labels round-trip verbatim — slugification only affects keys.
      expect(parsed.columns!.map((c) => c.label)).toEqual(["Cash", "Amount"]);

      // And the on-disk header row still carries the human-facing labels
      // in the same order the metadata declares.
      const headerRow = stripCsvMetadataHeader(csv).split(/\r\n|\n/)[0];
      expect(splitCsvRow(headerRow)).toEqual(["Cash", "Amount"]);
    });

    it("preserves declaration order when the collision comes from a later explicit key", () => {
      // Label first, then an explicit key that matches the slug: the
      // label-derived key wins the base slot, and the later explicit
      // "amount" must shift to "amount_2" to stay unique.
      const csv = prefixCsvWithMetadata("Amount,Cash\r\n1,2\r\n", {
        source: "Bookings",
        columns: [{ label: "Amount" }, { key: "amount", label: "Cash" }],
        generatedAt: new Date("2026-07-07T10:00:00Z"),
      });
      const parsed = parseCsvMetadataHeader(csv);
      expect(parsed.columns!.map((c) => c.key)).toEqual(["amount", "amount_2"]);
      expect(parsed.columns!.map((c) => c.label)).toEqual(["Amount", "Cash"]);
    });

    it("three-way collision: two explicit 'amount' + one label 'Amount' all get unique keys", () => {
      const csv = prefixCsvWithMetadata("Cash,Bank,Amount\r\n1,2,3\r\n", {
        source: "Bookings",
        columns: [
          { key: "amount", label: "Cash" },
          { key: "amount", label: "Bank" },
          { label: "Amount" },
        ],
        generatedAt: new Date("2026-07-07T10:00:00Z"),
      });
      const parsed = parseCsvMetadataHeader(csv);
      expect(parsed.columns!.map((c) => c.key)).toEqual(["amount", "amount_2", "amount_3"]);
      expect(new Set(parsed.columns!.map((c) => c.key)).size).toBe(3);
      // Header row still matches labels in declaration order.
      const headerRow = stripCsvMetadataHeader(csv).split(/\r\n|\n/)[0];
      expect(splitCsvRow(headerRow)).toEqual(["Cash", "Bank", "Amount"]);
    });
  });
});

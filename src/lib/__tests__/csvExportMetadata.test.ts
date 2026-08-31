import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  CsvExportMetadataError,
  prefixCsvWithMetadata,
  JSON_ENVELOPE_SCHEMA,
  JSON_ENVELOPE_VERSION,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

describe("buildCsvMetadataHeader", () => {
  it("emits source + generated timestamp as the first two lines", () => {
    const lines = buildCsvMetadataHeader({
      source: "Dashboard — KPI Trend",
      generatedAt: FIXED_DATE,
    });
    expect(lines[0]).toBe("# Precise Realtors — Dashboard — KPI Trend");
    expect(lines[1]).toBe(`# Schema: ${JSON_ENVELOPE_SCHEMA}`);
    expect(lines[2]).toBe(`# Version: ${JSON_ENVELOPE_VERSION}`);
    expect(lines[3]).toBe(`# Generated: ${FIXED_DATE.toLocaleString()}`);
    // With nothing else supplied, only source + schema + version + generated appear.
    expect(lines).toHaveLength(4);
  });

  it("includes meaningful filters and drops sentinel/empty values", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      filters: {
        project: "PR-001",
        status: "active",
        agent: "all", // sentinel — dropped
        city: "", // empty — dropped
        archived: null, // null — dropped
        page_size: 50,
      },
    });
    const filterLine = lines.find((l) => l.startsWith("# Filters:"));
    expect(filterLine).toBe("# Filters: project=PR-001 | status=active | page_size=50");
    expect(filterLine).not.toMatch(/agent=/);
    expect(filterLine).not.toMatch(/city=/);
    expect(filterLine).not.toMatch(/archived=/);
  });

  it("omits the Filters line entirely when every filter is empty/sentinel", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      filters: { agent: "all", city: "", archived: null },
    });
    expect(lines.some((l) => l.startsWith("# Filters:"))).toBe(false);
  });

  it("renders sort direction when a sort key is provided", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      sort: { key: "sold_date", dir: "desc" },
    });
    expect(lines).toContain("# Sort: sold_date desc");
  });

  it("omits sort when key is missing", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      sort: null,
    });
    expect(lines.some((l) => l.startsWith("# Sort:"))).toBe(false);
  });

  it("renders pagination as `Page: N of M (size S)`", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      page: { page: 2, totalPages: 5, pageSize: 50 },
    });
    expect(lines).toContain("# Page: 2 of 5 (size 50)");
  });

  it("renders counts with each provided bucket joined by ` · `", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      counts: { shown: 25, filtered: 100, total: 500 },
    });
    expect(lines).toContain("# Rows: 25 shown · 100 filtered · 500 total");
  });

  it("skips missing count buckets but keeps the ones supplied", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      counts: { total: 500 },
    });
    expect(lines).toContain("# Rows: 500 total");
  });

  it("omits the Rows line entirely when counts is empty", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      counts: {},
    });
    expect(lines.some((l) => l.startsWith("# Rows:"))).toBe(false);
  });

  it("preserves column order and emits keys line when every column has a key", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      columns: [
        { key: "booking_id", label: "Booking ID" },
        { key: "sold_date", label: "Sold On" },
        { key: "amount", label: "Amount (PKR)" },
      ],
    });
    expect(lines).toContain("# Columns (3, in order): Booking ID | Sold On | Amount (PKR)");
    expect(lines).toContain("# Column keys: booking_id,sold_date,amount");
  });

  it("derives missing column keys from labels so the keys line is always emitted", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      columns: [{ key: "booking_id", label: "Booking ID" }, { label: "Amount (PKR)" }, "Client"],
    });
    expect(lines).toContain("# Columns (3, in order): Booking ID | Amount (PKR) | Client");
    // Explicit key kept as-is; label-only entries slugified to snake_case.
    expect(lines).toContain("# Column keys: booking_id,amount_pkr,client");
  });

  it("deduplicates derived keys when labels collide", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      columns: [{ label: "Amount" }, { label: "Amount" }, { label: "amount!" }],
    });
    expect(lines).toContain("# Column keys: amount,amount_2,amount_3");
  });

  it("falls back to `column` when a label has no alphanumeric characters", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      columns: [{ label: "—" }, { label: "•" }],
    });
    expect(lines).toContain("# Column keys: column,column_2");
  });

  it("emits extras only when meaningful, in insertion order", () => {
    const lines = buildCsvMetadataHeader({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      extra: {
        Project: "PR-001",
        Device: "desktop",
        Notes: "", // dropped
        LastEdit: null, // dropped
        View: "table",
      },
    });
    const extras = lines.filter((l) => /^# (Project|Device|View|Notes|LastEdit):/.test(l));
    expect(extras).toEqual(["# Project: PR-001", "# Device: desktop", "# View: table"]);
  });

  it("assembles a full metadata block in the documented order", () => {
    const lines = buildCsvMetadataHeader({
      source: "Data Health — Audit",
      generatedAt: FIXED_DATE,
      extra: { Project: "PR-001" },
      filters: { status: "tool-error" },
      sort: { key: "checked_at", dir: "asc" },
      page: { page: 1, totalPages: 3, pageSize: 100 },
      counts: { shown: 100, filtered: 250, total: 900 },
      columns: [{ key: "id", label: "ID" }],
    });
    expect(lines).toEqual([
      "# Precise Realtors — Data Health — Audit",
      `# Schema: ${JSON_ENVELOPE_SCHEMA}`,
      `# Version: ${JSON_ENVELOPE_VERSION}`,
      `# Generated: ${FIXED_DATE.toLocaleString()}`,
      "# Project: PR-001",
      "# Filters: status=tool-error",
      "# Sort: checked_at asc",
      "# Page: 1 of 3 (size 100)",
      "# Rows: 100 shown · 250 filtered · 900 total",
      "# Columns (1, in order): ID",
      "# Column keys: id",
    ]);
  });
});

describe("prefixCsvWithMetadata", () => {
  it("prepends header + blank line before the CSV body", () => {
    const out = prefixCsvWithMetadata("a,b\n1,2\n", {
      source: "Test",
      generatedAt: FIXED_DATE,
    });
    expect(out.startsWith("# Precise Realtors — Test\n")).toBe(true);
    expect(out).toContain("\n\na,b\n1,2\n");
  });
});

describe("buildJsonExportMetadata", () => {
  it("mirrors the CSV metadata shape as a structured object", () => {
    const meta = buildJsonExportMetadata({
      source: "Bookings",
      generatedAt: FIXED_DATE,
      filters: { status: "active", agent: "all" },
      sort: { key: "sold_date", dir: "desc" },
      page: { page: 2, totalPages: 5, pageSize: 50 },
      counts: { shown: 25, total: 500 },
      columns: [{ key: "booking_id", label: "Booking ID" }, "Amount"],
    });
    expect(meta).toMatchObject({
      source: "Bookings",
      generatedAt: FIXED_DATE.toISOString(),
      filters: { status: "active" },
      sort: { key: "sold_date", dir: "desc" },
      page: { page: 2, totalPages: 5, pageSize: 50 },
      counts: { shown: 25, total: 500 },
    });
    expect(meta.filters).not.toHaveProperty("agent");
    expect(meta.columns).toEqual([
      { order: 0, key: "booking_id", label: "Booking ID" },
      // Label-only column gets a slugified key ("Amount" → "amount").
      { order: 1, key: "amount", label: "Amount" },
    ]);
  });
});

describe("buildCsvMetadataHeader — column key validation", () => {
  const call = (columns: any[]) => () =>
    buildCsvMetadataHeader({ source: "X", generatedAt: FIXED_DATE, columns });

  it("throws when a column entry is null/undefined", () => {
    const err = expectThrow(call([{ key: "a", label: "A" }, null]));
    expect(err.code).toBe("empty-column-entry");
    expect(err.columnIndex).toBe(1);
  });

  it("throws when both label and key are blank", () => {
    const err = expectThrow(call([{ key: "a", label: "A" }, { label: "  " }]));
    expect(err.code).toBe("empty-column-label");
    expect(err.columnIndex).toBe(1);
  });

  it("throws when an explicit key is only whitespace", () => {
    const err = expectThrow(call([{ key: "   ", label: "Amount" }]));
    expect(err.code).toBe("empty-column-key");
    expect(err.columnIndex).toBe(0);
  });

  it("json builder applies the same validation", () => {
    expect(() =>
      buildJsonExportMetadata({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ label: "" }],
      }),
    ).toThrow(CsvExportMetadataError);
  });

  it("guarantees every emitted key is non-empty and unique", () => {
    const lines = buildCsvMetadataHeader({
      source: "X",
      generatedAt: FIXED_DATE,
      columns: [{ label: "—" }, { label: "•" }, { label: "Amount" }, { label: "Amount" }],
    });
    const keysLine = lines.find((l) => l.startsWith("# Column keys:"))!;
    const keys = keysLine.replace("# Column keys: ", "").split(",");
    expect(keys.every((k) => k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  describe("explicit key precedence over slugified labels", () => {
    it("keeps the explicit key even when a sibling label would slugify to the same value", () => {
      // {key:"amount"} + {label:"Amount"} — both would collapse to "amount"
      // if slugification ran first. Explicit keys must win: the explicit
      // entry stays as "amount"; the label-only entry gets deduped to
      // "amount_2".
      const lines = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ key: "amount", label: "Cash" }, { label: "Amount" }],
      });
      const keys = lines
        .find((l) => l.startsWith("# Column keys:"))!
        .replace("# Column keys: ", "")
        .split(",");
      expect(keys).toEqual(["amount", "amount_2"]);
    });

    it("preserves declaration order when the collision comes from a later explicit key", () => {
      // Label first, then an explicit key that matches the slug — the
      // label-derived key is emitted first, so the later explicit "amount"
      // has to shift to "amount_2" to stay unique.
      const lines = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ label: "Amount" }, { key: "amount", label: "Cash" }],
      });
      const keys = lines
        .find((l) => l.startsWith("# Column keys:"))!
        .replace("# Column keys: ", "")
        .split(",");
      expect(keys).toEqual(["amount", "amount_2"]);
    });

    it("still normalizes explicit keys past the collision (amount, amount, Amount → amount, amount_2, amount_3)", () => {
      const lines = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [
          { key: "amount", label: "Cash" },
          { key: "amount", label: "Bank" },
          { label: "Amount" },
        ],
      });
      const keys = lines
        .find((l) => l.startsWith("# Column keys:"))!
        .replace("# Column keys: ", "")
        .split(",");
      expect(keys).toEqual(["amount", "amount_2", "amount_3"]);
    });

    it("explicit key wins over a slugified label even when the label is empty for that entry", () => {
      // Sanity: an explicit key with a whitespace-only label is still valid
      // (the code falls back to using the key as the label).
      const meta = buildJsonExportMetadata({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ key: "amount", label: "  " }, { label: "Amount" }],
      });
      const cols = (meta.columns as Array<{ key: string; label: string }>) ?? [];
      expect(cols.map((c) => c.key)).toEqual(["amount", "amount_2"]);
      // Blank label falls back to the key.
      expect(cols.map((c) => c.label)).toEqual(["amount", "Amount"]);
    });

    it("mirrors the same precedence in the JSON envelope metadata", () => {
      const meta = buildJsonExportMetadata({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ key: "amount", label: "Cash" }, { label: "Amount" }],
      });
      const cols = (meta.columns as Array<{ key: string; label: string }>) ?? [];
      expect(cols.map((c) => c.key)).toEqual(["amount", "amount_2"]);
      expect(cols.map((c) => c.label)).toEqual(["Cash", "Amount"]);
    });
  });

  describe("unicode-only label slugification and fallback", () => {
    // The slugifier is intentionally ASCII-only: `[^a-z0-9]+` collapses to
    // `_`, leading/trailing underscores are trimmed, and `"column"` is the
    // last-resort fallback. These tests pin that behavior so a future
    // "let's add unicode support" change can't silently reshape keys that
    // downstream tooling (pickers, saved views) has already stored.

    it("falls back to 'column' for any single label with no ASCII alphanumerics", () => {
      for (const label of ["北京", "Ξ", "日本語", "☕", "—", "•••", "🚀🚀"]) {
        const lines = buildCsvMetadataHeader({
          source: "X",
          generatedAt: FIXED_DATE,
          columns: [{ label }],
        });
        const keys = lines
          .find((l) => l.startsWith("# Column keys:"))!
          .replace("# Column keys: ", "")
          .split(",");
        expect(keys).toEqual(["column"]);
      }
    });

    it("dedupes multiple unicode-only labels that all collapse to 'column'", () => {
      const lines = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ label: "北京" }, { label: "Ξ" }, { label: "☕" }],
      });
      const keys = lines
        .find((l) => l.startsWith("# Column keys:"))!
        .replace("# Column keys: ", "")
        .split(",");
      expect(keys).toEqual(["column", "column_2", "column_3"]);
    });

    it("strips non-ASCII runes but keeps surrounding ASCII alphanumerics", () => {
      // "café" → "caf" (é dropped, trailing _ trimmed)
      // "naïve" → "na_ve" (ï collapsed to _)
      // "Amount 💰" → "amount" (emoji + space collapsed then trimmed)
      // "日本語 2026" → "2026" (leading CJK collapsed then trimmed)
      // "über_v2" → "ber_v2" (ü stripped, leading _ trimmed)
      const lines = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [
          { label: "café" },
          { label: "naïve" },
          { label: "Amount 💰" },
          { label: "日本語 2026" },
          { label: "über_v2" },
        ],
      });
      const keys = lines
        .find((l) => l.startsWith("# Column keys:"))!
        .replace("# Column keys: ", "")
        .split(",");
      expect(keys).toEqual(["caf", "na_ve", "amount", "2026", "ber_v2"]);
    });

    it("preserves the original label text in the JSON envelope even when the key is 'column'", () => {
      const meta = buildJsonExportMetadata({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ label: "北京" }, { label: "☕" }],
      });
      const cols = (meta.columns as Array<{ key: string; label: string }>) ?? [];
      expect(cols.map((c) => c.key)).toEqual(["column", "column_2"]);
      // Human-facing label must round-trip untouched — slugification only
      // affects the machine key.
      expect(cols.map((c) => c.label)).toEqual(["北京", "☕"]);
    });

    it("lets an explicit key win over a unicode-only sibling label", () => {
      // Explicit "city" claims its slot; the unicode-only label falls back
      // to "column" without needing to dedupe against "city".
      const lines = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ key: "city", label: "北京" }, { label: "☕" }],
      });
      const keys = lines
        .find((l) => l.startsWith("# Column keys:"))!
        .replace("# Column keys: ", "")
        .split(",");
      expect(keys).toEqual(["city", "column"]);
    });

    it("does NOT throw on a unicode-only label — the 'column' fallback keeps it valid", () => {
      // A whitespace-only label with no key is the documented error path;
      // a unicode-only label like "北京" must succeed via the "column"
      // fallback. Pin the boundary so it can't silently regress into the
      // error path.
      expect(() =>
        buildCsvMetadataHeader({
          source: "X",
          generatedAt: FIXED_DATE,
          columns: [{ label: "北京" }],
        }),
      ).not.toThrow();
    });
  });

  describe("CSV vs JSON key parity", () => {
    // Both exporters funnel columns through the same `withDerivedColumnKeys`
    // helper, but the CSV path serialises to a `# Column keys:` comment
    // while the JSON path emits `_meta.columns[].key`. These tests pin the
    // invariant that BOTH exporters emit the exact same key sequence for
    // the same input — if slugification or dedup ever forks between the
    // two, saved views round-tripped through one format wouldn't match
    // the other.

    function csvKeys(input: Parameters<typeof buildCsvMetadataHeader>[0]): string[] {
      const line = buildCsvMetadataHeader(input).find((l) => l.startsWith("# Column keys:"));
      if (!line) return [];
      return line.replace("# Column keys: ", "").split(",");
    }

    function jsonKeys(input: Parameters<typeof buildJsonExportMetadata>[0]): string[] {
      const meta = buildJsonExportMetadata(input);
      const cols = (meta.columns as Array<{ key: string }> | undefined) ?? [];
      return cols.map((c) => c.key);
    }

    function jsonLabels(input: Parameters<typeof buildJsonExportMetadata>[0]): string[] {
      const meta = buildJsonExportMetadata(input);
      const cols = (meta.columns as Array<{ label: string }> | undefined) ?? [];
      return cols.map((c) => c.label);
    }

    function csvLabels(input: Parameters<typeof buildCsvMetadataHeader>[0]): string[] {
      const line = buildCsvMetadataHeader(input).find((l) => l.startsWith("# Columns ("));
      if (!line) return [];
      return line.replace(/^# Columns \(\d+, in order\): /, "").split(" | ");
    }

    const scenarios: Array<{
      name: string;
      columns: Parameters<typeof buildCsvMetadataHeader>[0]["columns"];
      expectedKeys: string[];
    }> = [
      {
        name: "plain string columns",
        columns: ["Amount", "Sold Date", "Agent"],
        expectedKeys: ["amount", "sold_date", "agent"],
      },
      {
        name: "explicit keys win over slugified label collisions",
        columns: [{ key: "amount", label: "Cash" }, { label: "Amount" }],
        expectedKeys: ["amount", "amount_2"],
      },
      {
        name: "duplicate slugified labels dedupe with _2, _3",
        columns: [{ label: "Amount" }, { label: "Amount" }, { label: "Amount" }],
        expectedKeys: ["amount", "amount_2", "amount_3"],
      },
      {
        name: "unicode-only labels fall back to 'column' and dedupe",
        columns: [{ label: "北京" }, { label: "☕" }, { label: "—" }],
        expectedKeys: ["column", "column_2", "column_3"],
      },
      {
        name: "mixed diacritics, ASCII, and unicode-only",
        columns: [
          { label: "café" },
          { label: "naïve" },
          { label: "Amount 💰" },
          { label: "日本語 2026" },
          { label: "☕" },
        ],
        expectedKeys: ["caf", "na_ve", "amount", "2026", "column"],
      },
      {
        name: "mixed string + object entries preserve declaration order",
        columns: ["Project", { key: "pid", label: "Project ID" }, { label: "Project" }],
        expectedKeys: ["project", "pid", "project_2"],
      },
    ];

    for (const { name, columns, expectedKeys } of scenarios) {
      it(`emits identical keys from CSV and JSON: ${name}`, () => {
        const input = { source: "X", generatedAt: FIXED_DATE, columns };
        const fromCsv = csvKeys(input);
        const fromJson = jsonKeys(input);
        expect(fromCsv).toEqual(expectedKeys);
        expect(fromJson).toEqual(expectedKeys);
        // Redundant with the two above, but makes a parity break obvious
        // in the failure diff.
        expect(fromCsv).toEqual(fromJson);
      });
    }

    it("emits identical labels from CSV and JSON for the same input", () => {
      // Labels aren't slugified, but the same `withDerivedColumnKeys` helper
      // owns the label-fallback rule (blank label → key). Pin that both
      // exporters resolve labels the same way.
      const input = {
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [
          "Amount",
          { key: "pid", label: "  " }, // blank label → falls back to key
          { label: "北京" }, // unicode label preserved verbatim
        ],
      };
      const csv = csvLabels(input);
      const json = jsonLabels(input);
      expect(csv).toEqual(["Amount", "pid", "北京"]);
      expect(json).toEqual(csv);
    });

    it("both exporters throw the same CsvExportMetadataError for the same invalid column", () => {
      const badInput = {
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ label: "" }], // no key + blank label = documented error
      };
      const csvErr = expectThrow(() => buildCsvMetadataHeader(badInput));
      const jsonErr = expectThrow(() => buildJsonExportMetadata(badInput));
      // Both paths must surface the same error code — a divergence here
      // would mean a caller could silently succeed via one exporter and
      // crash via the other.
      expect(csvErr.code).toBe("empty-column-label");
      expect(jsonErr.code).toBe("empty-column-label");
    });

    it("omits column metadata from both exporters when the columns list is empty", () => {
      const input = { source: "X", generatedAt: FIXED_DATE, columns: [] };
      expect(csvKeys(input)).toEqual([]);
      expect(jsonKeys(input)).toEqual([]);
      const meta = buildJsonExportMetadata(input);
      expect(meta.columns).toBeUndefined();
    });
  });

  describe("case-insensitive slug collision dedup", () => {
    // Slugification lowercases before collapsing non-alphanumerics, so many
    // visually different labels normalise to the SAME base key. Dedup must
    // suffix collisions with `_2`, `_3`, … in declaration order — and must
    // NOT reuse a suffix that a *literal* sibling label already occupies
    // (e.g. bases `[amount, amount, amount_2]` cannot emit two `amount_2`s).

    function keysFor(columns: Parameters<typeof buildCsvMetadataHeader>[0]["columns"]): string[] {
      const lines = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns,
      });
      return lines
        .find((l) => l.startsWith("# Column keys:"))!
        .replace("# Column keys: ", "")
        .split(",");
    }

    it("dedupes labels that differ only in case", () => {
      expect(keysFor([{ label: "Amount" }, { label: "amount" }, { label: "AMOUNT" }])).toEqual([
        "amount",
        "amount_2",
        "amount_3",
      ]);
    });

    it("dedupes labels that differ only in surrounding non-alphanumerics", () => {
      // "Amount", "amount!", "  amount  ", "amount?" all slugify to "amount".
      expect(
        keysFor([
          { label: "Amount" },
          { label: "amount!" },
          { label: "  amount  " },
          { label: "amount?" },
        ]),
      ).toEqual(["amount", "amount_2", "amount_3", "amount_4"]);
    });

    it("mixes case, punctuation, and whitespace collisions in declaration order", () => {
      expect(
        keysFor([
          { label: "Amount" },
          { label: "amount!" },
          { label: "AMOUNT?" },
          { label: "  Amount  " },
        ]),
      ).toEqual(["amount", "amount_2", "amount_3", "amount_4"]);
    });

    it("does NOT emit duplicate keys when a literal sibling occupies the natural suffix", () => {
      // The user-cited example: `[Amount, amount!, amount_2]`.
      // - "Amount"   → base "amount", first use → "amount"
      // - "amount!"  → base "amount", second use → "amount_2"
      // - "amount_2" → base "amount_2", first use → would be "amount_2",
      //                but that's already taken by the previous entry, so
      //                the dedup loop bumps it to "amount_2_2".
      // The invariant is uniqueness, not a specific bump path — assert
      // that first, then pin the current resolution so a future change is
      // a conscious one.
      const keys = keysFor([{ label: "Amount" }, { label: "amount!" }, { label: "amount_2" }]);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toEqual(["amount", "amount_2", "amount_2_2"]);
    });

    it("keeps every emitted key unique even under heavy cross-case collisions", () => {
      const keys = keysFor([
        { label: "Amount" },
        { label: "amount!" },
        { label: "amount_2" },
        { label: "AMOUNT" },
        { label: "  Amount  " },
        { label: "amount_3" },
      ]);
      // Uniqueness is the invariant that matters — assert it first.
      expect(new Set(keys).size).toBe(keys.length);
      // Sanity: every key still lives under the shared "amount" base.
      expect(keys.every((k) => k === "amount" || /^amount(_\d+)+$/.test(k))).toBe(true);
    });

    it("mirrors the same dedup order in the JSON envelope metadata", () => {
      const meta = buildJsonExportMetadata({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ label: "Amount" }, { label: "amount!" }, { label: "amount_2" }],
      });
      const cols = (meta.columns as Array<{ key: string; label: string }>) ?? [];
      expect(cols.map((c) => c.key)).toEqual(["amount", "amount_2", "amount_2_2"]);
      // Labels are preserved verbatim (trimmed), not slugified.
      expect(cols.map((c) => c.label)).toEqual(["Amount", "amount!", "amount_2"]);
    });

    it("explicit keys still win over case-collision slugs", () => {
      // Explicit "amount" holds the base; the label-only siblings bump past
      // it in declaration order.
      expect(
        keysFor([{ key: "amount", label: "Cash" }, { label: "Amount" }, { label: "amount!" }]),
      ).toEqual(["amount", "amount_2", "amount_3"]);
    });
  });
});

describe("buildCsvMetadataHeader — runtime validation of malformed entries", () => {
  // These tests exercise the fail-fast / safe-exclude behavior for column
  // entries that violate the runtime contract but that TypeScript's
  // structural check can miss (data crossing an API boundary, JSON.parse
  // output, forgiving Object.assign spreads, etc.).

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = (columns: any[]) => () =>
    buildCsvMetadataHeader({ source: "X", generatedAt: FIXED_DATE, columns });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callJson = (columns: any[]) => () =>
    buildJsonExportMetadata({ source: "X", generatedAt: FIXED_DATE, columns });

  describe("null / undefined column entries", () => {
    it("fails fast on a null entry with the correct index", () => {
      const err = expectThrow(call([{ label: "OK" }, null, { label: "Later" }]));
      expect(err.code).toBe("empty-column-entry");
      expect(err.columnIndex).toBe(1);
    });

    it("fails fast on an undefined entry with the correct index", () => {
      const err = expectThrow(call([undefined]));
      expect(err.code).toBe("empty-column-entry");
      expect(err.columnIndex).toBe(0);
    });

    it("reports the FIRST bad index even when later entries are also invalid", () => {
      const err = expectThrow(call([{ label: "OK" }, null, undefined, { label: "" }]));
      expect(err.columnIndex).toBe(1);
    });
  });

  describe("missing / non-string labels", () => {
    it("fails when the object has neither `key` nor `label` at all", () => {
      const err = expectThrow(call([{}]));
      expect(err.code).toBe("empty-column-label");
      expect(err.columnIndex).toBe(0);
    });

    it("fails when `label` is undefined and there is no key", () => {
      // `label: undefined` counts as the property being present with a
      // non-string value — fail-fast with the distinct type error.
      const err = expectThrow(call([{ label: undefined }]));
      expect(err.code).toBe("invalid-column-label-type");
      expect(err.columnIndex).toBe(0);
    });

    it("fails when `label` is null and there is no key", () => {
      const err = expectThrow(call([{ label: null }]));
      expect(err.code).toBe("invalid-column-label-type");
      expect(err.columnIndex).toBe(0);
    });

    it.each([
      ["number", 42],
      ["boolean true", true],
      ["boolean false", false],
      ["plain object", { toString: () => "Amount" }],
      ["array", ["Amount"]],
    ])("fails when `label` is a %s and there is no key", (_name, value) => {
      const err = expectThrow(call([{ label: value }]));
      // Non-string labels are refused up-front with a dedicated code —
      // the builder never coerces via `.toString()`, so even an object
      // with a custom toString is rejected.
      expect(err.code).toBe("invalid-column-label-type");
    });

    it("fails when the entry is a non-string primitive at the top level", () => {
      // Type contract is `string | { key?; label }`; a bare number
      // matches neither shape and is refused with `invalid-column-type`.
      const err = expectThrow(call([42 as unknown as string]));
      expect(err.code).toBe("invalid-column-type");
      expect(err.columnIndex).toBe(0);
    });

    it.each([
      ["boolean true", true],
      ["array", [1, 2, 3]],
      ["function", () => "x"],
    ])("fails when the entry is a %s at the top level", (_name, value) => {
      const err = expectThrow(call([value as unknown as string]));
      expect(err.code).toBe("invalid-column-type");
    });

    it("empty-string label with no key fails fast", () => {
      const err = expectThrow(call([{ label: "" }]));
      expect(err.code).toBe("empty-column-label");
      expect(err.columnIndex).toBe(0);
    });

    it.each([
      ["whitespace-only", "   "],
      ["tabs", "\t\t"],
      ["newlines", "\n\r\n"],
      ["mixed whitespace", " \t\n "],
    ])("%s label with no key fails fast", (_name, label) => {
      const err = expectThrow(call([{ label }]));
      expect(err.code).toBe("empty-column-label");
    });
  });

  describe("malformed explicit keys", () => {
    it.each([
      ["whitespace-only key", "   "],
      ["tabs-only key", "\t"],
      ["newlines-only key", "\n"],
    ])("%s throws empty-column-key (even with a valid label)", (_name, key) => {
      const err = expectThrow(call([{ key, label: "Amount" }]));
      expect(err.code).toBe("empty-column-key");
      expect(err.columnIndex).toBe(0);
    });

    it("empty-string key ('') is IGNORED and falls back to the label slug", () => {
      // An empty string is distinct from "present but blank" — the
      // builder treats it as "no explicit key" and uses the label.
      // This is a safe-exclude, not a throw.
      const lines = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ key: "", label: "Amount" }],
      });
      const keys = lines
        .find((l) => l.startsWith("# Column keys:"))!
        .replace("# Column keys: ", "")
        .split(",");
      expect(keys).toEqual(["amount"]);
    });

    it("undefined key is IGNORED and falls back to the label slug", () => {
      // `undefined` is the "property absent" sentinel — never a caller
      // error — so it's still tolerated for backwards compatibility.
      const lines = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ key: undefined, label: "Amount" }],
      });
      const keys = lines
        .find((l) => l.startsWith("# Column keys:"))!
        .replace("# Column keys: ", "")
        .split(",");
      expect(keys).toEqual(["amount"]);
    });

    it.each([
      ["number key", 123],
      ["boolean key", true],
      ["object key", { toString: () => "amount" }],
      ["null key", null],
    ])("non-string %s throws invalid-column-key-type", (_name, key) => {
      const err = expectThrow(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        call([{ key: key as any, label: "Amount" }]),
      );
      expect(err.code).toBe("invalid-column-key-type");
      expect(err.columnIndex).toBe(0);
    });

    it("non-string key fails BEFORE non-string label (key type is checked first)", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = expectThrow(call([{ key: 1 as any, label: 2 as any }]));
      expect(err.code).toBe("invalid-column-key-type");
    });

    it("valid explicit key + non-string label THROWS (no silent fallback)", () => {
      // Previous behavior silently coerced a non-string label to the key.
      // The new contract refuses ambiguous data outright.
      const err = expectThrow(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        callJson([{ key: "amount", label: 42 as any }]),
      );
      expect(err.code).toBe("invalid-column-label-type");
      expect(err.columnIndex).toBe(0);
    });
  });

  describe("fail-fast semantics", () => {
    it("throws on the first invalid column even when the list is long", () => {
      const cols: unknown[] = [
        { label: "A" },
        { label: "B" },
        { label: "  " }, // <-- first bad, index 2
        { label: "D" },
        null, // also bad, index 4
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = expectThrow(call(cols as any[]));
      expect(err.code).toBe("empty-column-label");
      expect(err.columnIndex).toBe(2);
    });

    it("throws even if the malformed entry is the LAST column", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = expectThrow(call([{ label: "A" }, { label: "B" }, {} as any]));
      expect(err.code).toBe("empty-column-label");
      expect(err.columnIndex).toBe(2);
    });

    it("CSV and JSON builders throw the SAME error type and code for the same bad input", () => {
      const bad = [{ label: "OK" }, null];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const csvErr = expectThrow(call(bad as any[]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jsonErr = expectThrow(callJson(bad as any[]));
      expect(csvErr.code).toBe(jsonErr.code);
      expect(csvErr.columnIndex).toBe(jsonErr.columnIndex);
    });

    it("error instance carries CsvExportMetadataError name and a descriptive message", () => {
      const err = expectThrow(call([{ label: "" }]));
      expect(err.name).toBe("CsvExportMetadataError");
      expect(err.message).toContain("index 0");
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("edge inputs that must NOT throw", () => {
    it("a bare string entry with printable content is accepted", () => {
      const lines = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: ["Amount"],
      });
      expect(lines.some((l) => l.startsWith("# Column keys: amount"))).toBe(true);
    });

    it("unicode-only labels do NOT throw — 'column' fallback keeps them valid", () => {
      expect(() =>
        buildCsvMetadataHeader({
          source: "X",
          generatedAt: FIXED_DATE,
          columns: [{ label: "北京" }, { label: "☕" }],
        }),
      ).not.toThrow();
    });

    it("a `columns: []` list is a no-op — no # Column keys line and no throw", () => {
      const lines = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [],
      });
      expect(lines.some((l) => l.startsWith("# Column keys:"))).toBe(false);
      expect(lines.some((l) => l.startsWith("# Columns ("))).toBe(false);
    });

    it("columns=null / columns=undefined are safely excluded (no throw, no columns block)", () => {
      for (const columns of [null, undefined]) {
        const lines = buildCsvMetadataHeader({
          source: "X",
          generatedAt: FIXED_DATE,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns: columns as any,
        });
        expect(lines.some((l) => l.startsWith("# Column keys:"))).toBe(false);
      }
    });
  });
});

function expectThrow(fn: () => unknown): CsvExportMetadataError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CsvExportMetadataError);
    return e as CsvExportMetadataError;
  }
  throw new Error("Expected CsvExportMetadataError but nothing was thrown");
}

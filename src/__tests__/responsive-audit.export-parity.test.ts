/**
 * Verifies the responsive-audit CSV and JSON exports route through the
 * SAME filteredRows/sortBy pipeline as the on-screen table.
 *
 * We import the pure helpers from `responsive-audit-filters.ts` — the very
 * module the route's `filteredRows` useMemo and its two `Download` buttons
 * both import from. The test asserts that, given identical filter + sort
 * state, `applyResponsiveAuditFilters` and the CSV/JSON serialisers all
 * agree on which rows appear and in which order.
 */
import { describe, expect, it } from "vitest";
import {
  applyResponsiveAuditFilters,
  EXPORT_COLUMN_KEYS,
  rowsToCsvBody,
  rowsToJson,
  type Row,
  type SortKey,
} from "@/lib/responsive-audit/filters";

const make = (over: Partial<Row>): Row => ({
  device: "mobile",
  route: "/",
  path: "/",
  viewport: { width: 375, height: 812 },
  status: "ok",
  overflowPx: 0,
  offenders: [],
  screenshot: null,
  durationMs: 100,
  ...over,
});

const FIXTURE: Row[] = [
  make({
    device: "mobile",
    route: "/site",
    path: "/site",
    status: "overflow",
    overflowPx: 42,
    durationMs: 200,
  }),
  make({
    device: "desktop",
    route: "/site",
    path: "/site",
    status: "ok",
    overflowPx: 0,
    durationMs: 90,
  }),
  make({
    device: "tablet",
    route: "/dashboard",
    path: "/dashboard",
    status: "error",
    overflowPx: 0,
    durationMs: 800,
  }),
  make({
    device: "mobile",
    route: "/login",
    path: "/login",
    status: "ok",
    overflowPx: 0,
    durationMs: 150,
  }),
  make({
    device: "mobile",
    route: "/dashboard",
    path: "/dashboard",
    status: "overflow",
    overflowPx: 12,
    durationMs: 300,
  }),
];

const FILTER_MATRIX: Array<{ name: string; f: Parameters<typeof applyResponsiveAuditFilters>[1] }> =
  [
    {
      name: "defaults",
      f: { routeFilter: "all", deviceFilter: "all", statusFilter: "all", sortBy: "route-asc" },
    },
    {
      name: "route + sort desc",
      f: {
        routeFilter: "/dashboard",
        deviceFilter: "all",
        statusFilter: "all",
        sortBy: "route-desc",
      },
    },
    {
      name: "device mobile",
      f: {
        routeFilter: "all",
        deviceFilter: "mobile",
        statusFilter: "all",
        sortBy: "overflow-desc",
      },
    },
    {
      name: "failing shortcut",
      f: { routeFilter: "all", deviceFilter: "all", statusFilter: "failing", sortBy: "status" },
    },
    {
      name: "explicit status ok + duration",
      f: { routeFilter: "all", deviceFilter: "all", statusFilter: "ok", sortBy: "duration-desc" },
    },
  ];

function keyOf(r: Row) {
  return `${r.device}::${r.path}`;
}

describe("responsive-audit exports use the same filteredRows/sortBy as the table", () => {
  it.each(FILTER_MATRIX)("$name — CSV, JSON, and filteredRows agree", ({ f }) => {
    const filtered = applyResponsiveAuditFilters(FIXTURE, f);

    // JSON payload: rowsToJson consumes the same array the UI hands to the
    // JSON download. Order and length must match filteredRows exactly.
    const json = rowsToJson(filtered, EXPORT_COLUMN_KEYS);
    expect(json).toHaveLength(filtered.length);
    expect(json.map((r) => `${r.device}::${r.path}`)).toEqual(filtered.map(keyOf));

    // CSV payload: parse the body (no metadata header here — we're testing
    // the row set, not the header) and check the same invariant.
    const csv = rowsToCsvBody(filtered, EXPORT_COLUMN_KEYS);
    const [header, ...dataLines] = csv.split("\n");
    expect(header.split(",")).toEqual(EXPORT_COLUMN_KEYS);
    expect(dataLines).toHaveLength(filtered.length);
    const deviceIdx = EXPORT_COLUMN_KEYS.indexOf("device");
    const pathIdx = EXPORT_COLUMN_KEYS.indexOf("path");
    const csvKeys = dataLines.map((line) => {
      const cells = line.split(",");
      return `${cells[deviceIdx]}::${cells[pathIdx]}`;
    });
    expect(csvKeys).toEqual(filtered.map(keyOf));
  });

  it("sortBy ordering is preserved identically across CSV and JSON", () => {
    const sorts: SortKey[] = [
      "route-asc",
      "route-desc",
      "overflow-desc",
      "status",
      "duration-desc",
    ];
    for (const sortBy of sorts) {
      const filtered = applyResponsiveAuditFilters(FIXTURE, {
        routeFilter: "all",
        deviceFilter: "all",
        statusFilter: "all",
        sortBy,
      });
      const json = rowsToJson(filtered, EXPORT_COLUMN_KEYS);
      const csv = rowsToCsvBody(filtered, EXPORT_COLUMN_KEYS).split("\n").slice(1);
      const deviceIdx = EXPORT_COLUMN_KEYS.indexOf("device");
      const pathIdx = EXPORT_COLUMN_KEYS.indexOf("path");
      const csvKeys = csv.map((line) => {
        const cells = line.split(",");
        return `${cells[deviceIdx]}::${cells[pathIdx]}`;
      });
      const jsonKeys = json.map((r) => `${r.device}::${r.path}`);
      const expected = filtered.map(keyOf);
      expect(jsonKeys, `JSON order mismatch for ${sortBy}`).toEqual(expected);
      expect(csvKeys, `CSV order mismatch for ${sortBy}`).toEqual(expected);
    }
  });

  it("column selection is honoured identically by CSV and JSON", () => {
    const filtered = applyResponsiveAuditFilters(FIXTURE, {
      routeFilter: "all",
      deviceFilter: "all",
      statusFilter: "all",
      sortBy: "route-asc",
    });
    // A restricted, reordered picker selection. rowsToJson / rowsToCsvBody
    // both filter EXPORT_COLUMNS by inclusion, so the resulting field set
    // must be the intersection (regardless of caller order).
    const picked = ["status", "path", "overflow_px"];
    const json = rowsToJson(filtered, picked);
    for (const row of json) {
      expect(Object.keys(row).sort()).toEqual([...picked].sort());
    }
    const csv = rowsToCsvBody(filtered, picked);
    const headerCells = csv.split("\n")[0].split(",");
    expect(headerCells.sort()).toEqual([...picked].sort());
  });
});

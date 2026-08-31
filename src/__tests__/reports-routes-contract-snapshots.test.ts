/**
 * Contract snapshot tests for report route loaders.
 *
 * Two snapshots per route lock the response contract:
 *
 *  1. **Schema snapshot** — the canonical strict Zod schema for the loader
 *     result, serialized to JSON Schema. Any change to fields, types,
 *     nullability, or strictness produces a snapshot diff that must be
 *     explicitly approved via `vitest -u`.
 *
 *  2. **Runtime shape snapshot** — the actual loader is invoked against a
 *     representative fixture, and its output is reduced to a sorted
 *     `{ path -> typeSignature }` map. Adding a new key at the loader
 *     boundary, dropping one, or changing a type at runtime trips this
 *     snapshot even if the Zod schema wasn't touched.
 *
 * If both snapshots are updated intentionally together, the loader and the
 * schema stay in lockstep — that is the contract we're enforcing.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { z } from "zod";

// ---------- Canonical strict schemas (source of truth) ----------

const overdueRowSchema = z
  .object({
    ledger_id: z.string().min(1),
    booking_id: z.string().nullable(),
    client_name: z.string().nullable(),
    project: z.string().nullable(),
    unit_no: z.string().nullable(),
    term_no: z.number().int().nullable(),
    due_date: z.string().nullable(),
    due_amount: z.number().nullable(),
    paid_amount: z.number().nullable(),
    days_overdue: z.number().int().nullable(),
    status: z.string().nullable(),
  })
  .strict();

const paymentRowSchema = z
  .object({
    receipt_no: z.string().min(1),
    payment_date: z.string().nullable(),
    client_name: z.string().nullable(),
    project: z.string().nullable(),
    unit_no: z.string().nullable(),
    payment_head: z.string().nullable(),
    payment_mode: z.string().nullable(),
    amount: z.number().nullable(),
    status: z.string().nullable(),
  })
  .strict();

const overdueLoaderSchema = z.object({ rows: z.array(overdueRowSchema) }).strict();
const paymentLoaderSchema = z.object({ rows: z.array(paymentRowSchema) }).strict();

// ---------- Representative fixtures ----------

const overdueFixture = [
  {
    ledger_id: "led-1",
    booking_id: "bk-1",
    client_name: "Ada Lovelace",
    project: "Skyline Tower",
    unit_no: "A-101",
    term_no: 3,
    due_date: "2026-06-01",
    due_amount: 100_000,
    paid_amount: 25_000,
    days_overdue: 47,
    status: "overdue",
  },
  {
    ledger_id: "led-2",
    booking_id: null,
    client_name: null,
    project: null,
    unit_no: null,
    term_no: null,
    due_date: null,
    due_amount: null,
    paid_amount: null,
    days_overdue: null,
    status: null,
  },
];

const paymentFixture = [
  {
    receipt_no: "R-0001",
    payment_date: "2026-07-10",
    client_name: "Ada Lovelace",
    project: "Skyline Tower",
    unit_no: "A-101",
    payment_head: "installment",
    payment_mode: "bank",
    amount: 25_000,
    status: "posted",
  },
  {
    receipt_no: "R-0002",
    payment_date: null,
    client_name: null,
    project: null,
    unit_no: null,
    payment_head: null,
    payment_mode: null,
    amount: null,
    status: null,
  },
];

vi.mock("@/lib/reports.functions", () => ({
  listOverdueInstallments: vi.fn(async () => overdueFixture),
  listPaymentCollections: vi.fn(async () => paymentFixture),
}));

// ---------- Helpers ----------

function stubLoaderArgs() {
  return {
    params: {},
    deps: {},
    context: {},
    location: { pathname: "/", search: {}, searchStr: "", hash: "", state: {}, href: "/" },
    abortController: new AbortController(),
    preload: false,
    cause: "enter" as const,
    parentMatchPromise: Promise.resolve(),
    route: {} as unknown,
    signal: new AbortController().signal,
  };
}

/**
 * Reduce arbitrary JSON to a deterministic path -> type map.
 * Arrays collapse into a single `[]` path (so the number of rows doesn't
 * affect the contract, but the row shape does). `null` is preserved as
 * its own type so nullability drift is caught.
 */
function shapeOf(value: unknown, path = "$", out: Record<string, string> = {}) {
  if (value === null) {
    out[path] = "null";
    return out;
  }
  if (Array.isArray(value)) {
    out[path] = "array";
    // Merge every element into the same synthetic index so extra keys in
    // any row surface in the snapshot.
    for (const item of value) shapeOf(item, `${path}[]`, out);
    return out;
  }
  if (typeof value === "object") {
    out[path] = "object";
    for (const key of Object.keys(value as object).sort()) {
      shapeOf((value as Record<string, unknown>)[key], `${path}.${key}`, out);
    }
    return out;
  }
  // For primitives, record `null | <primitive>` if the same path was
  // already seen with null, so nullable fields are represented faithfully.
  const t = typeof value;
  const prev = out[path];
  out[path] = prev && prev !== t ? [prev, t].sort().join(" | ") : t;
  return out;
}

type RouteCase = {
  name: string;
  routeModule: string;
  schema: z.ZodTypeAny;
};

const routeCases: RouteCase[] = [
  {
    name: "reports.overdue",
    routeModule: "@/routes/_authenticated/reports.overdue",
    schema: overdueLoaderSchema,
  },
  {
    name: "reports.payments",
    routeModule: "@/routes/_authenticated/reports.payments",
    schema: paymentLoaderSchema,
  },
];

// ---------- Tests ----------

describe("report loader contract snapshots", () => {
  for (const rc of routeCases) {
    describe(rc.name, () => {
      let loaderResult: unknown;

      beforeAll(async () => {
        const mod = (await import(rc.routeModule)) as {
          Route: { options: { loader?: (...a: never[]) => unknown } };
        };
        const loader = mod.Route.options.loader;
        if (!loader) throw new Error(`${rc.name} has no loader`);
        loaderResult = await Promise.resolve(loader(stubLoaderArgs() as never));
      });

      it("Zod schema shape matches snapshot (breaking schema change fails here)", () => {
        // z.toJSONSchema is deterministic — use it as the canonical
        // machine-readable contract representation.
        const jsonSchema = z.toJSONSchema(rc.schema);
        expect(jsonSchema).toMatchSnapshot(`${rc.name} schema`);
      });

      it("runtime response shape matches snapshot (breaking loader change fails here)", () => {
        const shape = shapeOf(loaderResult);
        expect(shape).toMatchSnapshot(`${rc.name} runtime shape`);
      });

      it("runtime response also validates against the canonical schema", () => {
        const parsed = rc.schema.safeParse(loaderResult);
        if (!parsed.success) {
          throw new Error(
            `${rc.name} loader output drifted from schema: ${JSON.stringify(
              parsed.error.issues,
              null,
              2,
            )}`,
          );
        }
        expect(parsed.success).toBe(true);
      });
    });
  }
});

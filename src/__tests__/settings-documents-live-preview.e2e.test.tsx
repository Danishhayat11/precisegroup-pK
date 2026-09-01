import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

/**
 * End-to-end-style integration test for the "Settings → Document center"
 * loop. Simulates a Settings save (writing `projects.display_name`) and
 * asserts every document surface reachable from Documents.tsx re-renders
 * with the new brand — headers, footers, and metadata.
 *
 * A real Playwright E2E would need Supabase auth + seed choreography.
 * Instead we drive the same production components with a real QueryClient
 * and a mocked Supabase select, and mutate the cache the way Settings does.
 */

// ---- Mock the Supabase client BEFORE importing the page under test ----
const state: {
  projects: Array<{ code: string; project_name: string; display_name: string | null }>;
} = {
  projects: [{ code: "MH", project_name: "Manal Heights", display_name: "Manal Heights" }],
};

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    if (table === "projects") {
      return {
        select: async (_cols?: string) => ({ data: state.projects, error: null }),
        update: (patch: Partial<{ display_name: string | null }>) => ({
          eq: async (col: string, val: string) => {
            state.projects = state.projects.map((p) =>
              (p as any)[col] === val ? { ...p, ...patch } : p,
            );
            return { data: null, error: null };
          },
        }),
      };
    }
    // Anything else: minimal chainable no-op.
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (fn: any) => Promise.resolve({ data: [], error: null }).then(fn),
    };
    return chain;
  };
  return { supabase: { from } };
});

// Now safe to import components (they'll bind to the mock above).
import { LetterheadLivePreview, Letterhead, Footer } from "@/pages/Documents";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

function Harness({ qc }: { qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <LetterheadLivePreview />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // Reset display name each test.
  state.projects = [{ code: "MH", project_name: "Manal Heights", display_name: "Manal Heights" }];
});

describe("Settings → Documents live preview E2E", () => {
  it("live preview reflects the initial Manal Heights display name", async () => {
    const qc = makeClient();
    render(<Harness qc={qc} />);
    await waitFor(() => {
      expect(screen.getByText("MANAL HEIGHTS")).toBeInTheDocument();
    });
    expect(screen.getByText(/Manal Heights, B-17 Multi Gardens, Islamabad/)).toBeInTheDocument();
    expect(screen.getByText(/manalheights@gmail.com/)).toBeInTheDocument();
  });

  it("switching the display name in Settings updates the live preview header", async () => {
    const qc = makeClient();
    render(<Harness qc={qc} />);

    await waitFor(() => {
      expect(screen.getByText("MANAL HEIGHTS")).toBeInTheDocument();
    });

    // Simulate Settings save: mutate DB + invalidate the shared query key.
    await act(async () => {
      state.projects[0].display_name = "Emerald Towers";
      await qc.invalidateQueries({ queryKey: ["s-projects"] });
    });

    await waitFor(() => {
      // Brand upper-cased in the letterhead.
      expect(screen.getByText("EMERALD TOWERS")).toBeInTheDocument();
    });
    // Old brand no longer visible.
    expect(screen.queryByText("MANAL HEIGHTS")).not.toBeInTheDocument();
  });

  it("headers, footers, and metadata all pick up the new display name", async () => {
    const qc = makeClient();
    render(<Harness qc={qc} />);
    await waitFor(() => screen.getByText("MANAL HEIGHTS"));

    await act(async () => {
      state.projects[0].display_name = "Skyline Residences";
      await qc.invalidateQueries({ queryKey: ["s-projects"] });
    });

    await waitFor(() => screen.getByText("SKYLINE RESIDENCES"));

    // Preview footer keeps the physical office address anchored to the
    // Manal Heights building (that's where the office physically is), and
    // the corporate email stays intact — the display-name swap changes the
    // header brand and the header subline, not the postal footer.
    expect(
      screen.getByText(/Office #01, 1st Floor, Manal Heights, B-17 Multi Gardens, Islamabad/),
    ).toBeInTheDocument();
    expect(screen.getByText(/manalheights@gmail.com/)).toBeInTheDocument();
  });

  it("Letterhead renders the overridden brandName end-to-end", async () => {
    const qc = makeClient();
    const overrideCtx = {
      brandName: "Grand Vista",
      isHeights: false,
      projectShortAddr: "Grand Vista, B-17, Islamabad",
      projectAddress: "Grand Vista, B-17 Multi Gardens, Islamabad",
      projectEmail: "manalheights@gmail.com",
    };
    render(
      <QueryClientProvider client={qc}>
        <Letterhead c={overrideCtx} />
        <Footer variant="precise" c={overrideCtx} />
      </QueryClientProvider>,
    );
    // Header shows the override, upper-cased.
    expect(screen.getByText("GRAND VISTA")).toBeInTheDocument();
    // Precise footer variant renders the override address inline.
    expect(screen.getByText(/Grand Vista, B-17 Multi Gardens, Islamabad/)).toBeInTheDocument();
    // No Manal Arcade leak anywhere.
    expect(document.body.innerHTML.toLowerCase().includes("manal arcade")).toBe(false);
  });

  it("direct override path: empty brandName falls back to isHeights default (MANAL HEIGHTS)", () => {
    const qc = makeClient();
    // Empty string brandName is falsy → Letterhead should pick the
    // isHeights default; Footer should keep the projectInfo email/address.
    const ctx = {
      brandName: "",
      isHeights: true,
      projectShortAddr: undefined,
      projectAddress: undefined,
      projectEmail: undefined,
    };
    const { container } = render(
      <QueryClientProvider client={qc}>
        <Letterhead c={ctx} />
        <Footer c={ctx} />
      </QueryClientProvider>,
    );
    // Header falls back to MANAL HEIGHTS (isHeights default), NOT an empty
    // string and NOT MANAL ARCADE.
    expect(screen.getByText("MANAL HEIGHTS")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/manal arcade/i);
    // Footer falls back to Heights address + email exactly as projectInfo defines.
    expect(container.textContent).toMatch(/Manal Heights, B-17 Multi Gardens, Islamabad/);
    expect(container.textContent).toMatch(/manalheights@gmail\.com/);
  });

  it("direct override path: undefined brandName + isHeights=false falls back to MANAL ARCADE", () => {
    const qc = makeClient();
    const ctx = {
      // brandName intentionally omitted (undefined).
      isHeights: false,
      // projectShortAddr/projectAddress/projectEmail also omitted so we
      // verify every Letterhead + Footer default path in one shot.
    } as any;
    const { container } = render(
      <QueryClientProvider client={qc}>
        <Letterhead c={ctx} />
        <Footer c={ctx} />
      </QueryClientProvider>,
    );
    // Header uses the non-Heights default when brandName is undefined.
    expect(screen.getByText("MANAL ARCADE")).toBeInTheDocument();
    // Precise sub-line default (non-Heights) shown when projectShortAddr is missing.
    // Letterhead default variant is "manal" so the tagline path renders instead —
    // assert Heights branding doesn't leak into the header itself. (The
    // physical office address in the footer legitimately mentions Manal
    // Heights because that's where the Precise office is physically located.)
    expect(screen.queryByText("MANAL HEIGHTS")).not.toBeInTheDocument();
    // Footer still funnels through projectInfo defaults (Heights email + address
    // are the hard-coded fallbacks in Footer when projectEmail/projectAddress
    // are undefined — this is the documented projectInfo contract).
    expect(container.textContent).toMatch(/Manal Heights, B-17 Multi Gardens, Islamabad/);
    expect(container.textContent).toMatch(/manalheights@gmail\.com/);
  });

  it("direct override path: precise variant with empty brandName ignores brandName entirely", () => {
    const qc = makeClient();
    const ctx = {
      brandName: "",
      isHeights: true,
      projectShortAddr: undefined,
      projectAddress: "Manal Heights, B-17 Multi Gardens, Islamabad",
      projectEmail: "manalheights@gmail.com",
    };
    const { container } = render(
      <QueryClientProvider client={qc}>
        <Letterhead variant="precise" c={ctx} />
        <Footer variant="precise" c={ctx} />
      </QueryClientProvider>,
    );
    // Precise header always renders the corporate name regardless of brandName.
    expect(screen.getByText("PRECISE REALTORS & BUILDERS (PVT.) LTD.")).toBeInTheDocument();
    // Sub-line falls back to the isHeights default when projectShortAddr is undefined.
    expect(screen.getByText("MANAL HEIGHTS, B-17, ISLAMABAD")).toBeInTheDocument();
    // Precise footer uses projectAddress inline.
    expect(container.textContent).toMatch(/Manal Heights, B-17 Multi Gardens, Islamabad/);
  });

  it("Settings Reset (empty-string override): live preview reverts to project_name and address funnels through projectInfo", async () => {
    // Seed state: user had overridden display_name to "Emerald Towers" via
    // the Settings draft, then clicks Reset. The resetToDefault path in
    // Settings.tsx clears the override; the DB row's display_name is
    // written back to null, so the next `s-projects` fetch returns null
    // and the preview falls back to `active.project_name`. We simulate
    // the "empty string" reset shape here (some code paths write "" back
    // instead of null before the row is refetched) to prove BOTH shapes
    // trigger the same projectInfo fallback.
    state.projects = [
      { code: "MH", project_name: "Manal Heights", display_name: "Emerald Towers" },
    ];
    const qc = makeClient();
    render(<Harness qc={qc} />);
    await waitFor(() => {
      expect(screen.getByText("EMERALD TOWERS")).toBeInTheDocument();
    });

    // Simulate clicking Reset: writes an empty string to display_name and
    // invalidates the shared query key exactly like Settings.resetToDefault.
    // Replace the array reference so React Query's structural-sharing
    // pass sees a genuine data change (matches a real DB refetch shape).
    await act(async () => {
      state.projects = [{ code: "MH", project_name: "Manal Heights", display_name: "" }];
      await qc.invalidateQueries({ queryKey: ["s-projects"] });
    });

    // Immediately (next render) the header reverts to project_name — the
    // `active.display_name || active.project_name || "Manal Heights"`
    // fallback in LetterheadLivePreview picks the project_name because
    // "" is falsy. This is the empty-brandName projectInfo fallback path.
    await waitFor(() => {
      expect(screen.getByText("MANAL HEIGHTS")).toBeInTheDocument();
    });
    expect(screen.queryByText("EMERALD TOWERS")).not.toBeInTheDocument();
    // Address funnels through projectInfo defaults for Heights.
    expect(screen.getByText(/Manal Heights, B-17 Multi Gardens, Islamabad/)).toBeInTheDocument();
    expect(screen.getByText(/manalheights@gmail.com/)).toBeInTheDocument();
  });

  it("Settings Reset (null override): live preview reverts to project_name and address funnels through projectInfo", async () => {
    // Same reset flow, but the DB reset writes `null` (the canonical
    // shape Settings.resetToDefault sends). Verifies the undefined /
    // null brandName branch of the projectInfo fallback.
    state.projects = [
      { code: "MH", project_name: "Manal Heights", display_name: "Skyline Residences" },
    ];
    const qc = makeClient();
    render(<Harness qc={qc} />);
    await waitFor(() => {
      expect(screen.getByText("SKYLINE RESIDENCES")).toBeInTheDocument();
    });

    await act(async () => {
      state.projects = [{ code: "MH", project_name: "Manal Heights", display_name: null }];
      await qc.invalidateQueries({ queryKey: ["s-projects"] });
    });

    await waitFor(() => {
      expect(screen.getByText("MANAL HEIGHTS")).toBeInTheDocument();
    });
    expect(screen.queryByText("SKYLINE RESIDENCES")).not.toBeInTheDocument();
    expect(screen.getByText(/Manal Heights, B-17 Multi Gardens, Islamabad/)).toBeInTheDocument();
    expect(screen.getByText(/manalheights@gmail.com/)).toBeInTheDocument();
  });

  it("Settings Reset on a non-Heights project falls back to project_name (Arcade), not the hard-coded Heights default", async () => {
    // Guards against a regression where an empty/null override on Arcade
    // would incorrectly cascade all the way to the "Manal Heights" hard
    // fallback in `displayName ||`. project_name must win over the hard
    // fallback for every non-Heights project.
    state.projects = [
      { code: "MA", project_name: "Manal Arcade", display_name: "Custom Arcade Name" },
    ];
    const qc = makeClient();
    render(<Harness qc={qc} />);
    await waitFor(() => {
      expect(screen.getByText("CUSTOM ARCADE NAME")).toBeInTheDocument();
    });

    // Simulate Reset — clear the override.
    await act(async () => {
      state.projects = [{ code: "MA", project_name: "Manal Arcade", display_name: null }];
      await qc.invalidateQueries({ queryKey: ["s-projects"] });
    });

    // Header reverts to Arcade's project_name, NOT the Heights hard fallback.
    await waitFor(() => {
      expect(screen.getByText("MANAL ARCADE")).toBeInTheDocument();
    });
    expect(screen.queryByText("MANAL HEIGHTS")).not.toBeInTheDocument();
    expect(screen.queryByText("CUSTOM ARCADE NAME")).not.toBeInTheDocument();
    // isHeights is false → tagline switches away from the Heights variant.
    // The preview default-variant footer only renders the physical office
    // address (which legitimately mentions Manal Heights); the Arcade
    // project address is exercised by the precise-variant tests above.
    // Assert the Heights tagline is gone so we know isHeights recomputed.
    expect(screen.queryByText("Elevated Living · Timeless Value")).not.toBeInTheDocument();
  });
});

/**
 * Extended coverage: for every printable/PDF document type routed by
 * `renderDocBody` in DocumentView.tsx, verify the header line, body
 * metadata (project name / address), and footer signals (email panel)
 * all pick up a "Settings display-name change" end-to-end.
 *
 * `projectInfo(booking)` is the single branding source for DocumentView
 * docs — so a display-name save propagates to the doc surface via the
 * `doc-booking` query returning a fresh `booking.project_name`. The
 * simulation below flips both `booking.project_name` and the
 * `booking_id` prefix (BK-MH-* → BK-MA-*) exactly as the refetched
 * booking would appear when Settings switches the project.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { renderDocBody } from "@/pages/DocumentView";

const DOC_TYPES = [
  "receipt",
  "payment-plan",
  "allotment",
  "possession",
  "prov-possession",
  "deposit-summary",
  "demand-notice",
  "transfer-form",
  "sale-agreement",
  "legal-notice",
  "final-legal-notice",
  "final-cancel-warning",
  "cancellation-notice",
] as const;

/** Realistic fixture booking; every field any of the 13 docs reads is populated. */
function makeBooking(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    booking_id: "BK-MH-101",
    project_name: "Manal Heights",
    unit_id: "AP-101",
    unit_type: "Apartment",
    floor: "1st",
    client_name: "Test Client",
    so_wo: "Test Senior",
    cnic: "12345-1234567-1",
    address: "Islamabad",
    mobile: "03001234567",
    booking_date: "2025-01-01",
    contract_date: "2025-01-01",
    size_sqft: 630,
    total_contract_value: 10_000_000,
    sold_unit_value: 10_000_000,
    down_payment: 2_000_000,
    no_of_installments: 24,
    installment_frequency: "monthly",
    installment_amount: 300_000,
    first_installment_due: "2025-02-01",
    possession_amount: 800_000,
    possession_due_date: "2027-01-01",
    total_overdue_amount: 357_500,
    gender: "male",
    ...overrides,
  };
}

const overdueLedger = [
  {
    ledger_id: "L1",
    particulars: "Installment 1",
    term_no: 1,
    due_date: "2025-06-01",
    due_amount: 357_500,
    paid_amount: 0,
    status: "overdue",
    days_overdue: 30,
  },
];

const samplePayment = {
  receipt_no: "R-001",
  amount: 500_000,
  safe_cash_amount: 500_000,
  payment_mode: "Bank Transfer",
  payment_head: "Down Payment",
  payment_date: "2025-01-15",
  cheque_txn_no: "TXN-1",
  account: "Bank - HBL",
};

function renderType(type: string, booking: Record<string, unknown>): string {
  return renderToStaticMarkup(
    renderDocBody({
      type,
      booking,
      payments: [samplePayment],
      ledger: overdueLedger,
      adjustments: [],
      receiptParam: "R-001",
      prev1: "2025-05-01",
      prev2: "2025-05-15",
    }) as any,
  );
}

/** Regex helpers so the assertion labels stay readable in failures. */
const RX_HEIGHTS = /manal\s*heights/i;
const RX_ARCADE = /manal\s*arcade/i;
const RX_HEIGHTS_EMAIL = /manalheights@gmail\.com/i;
const RX_ARCADE_EMAIL = /manalarcade@gmail\.com/i;
const RX_HEIGHTS_ADDR = /B-17 Multi Gardens, Islamabad/i;
const RX_ARCADE_ADDR = /B-1 Markaz, B-17, Islamabad/i;

/**
 * A small subset of docs (deposit-summary) is a transaction ledger keyed
 * solely by `booking.booking_id` — it does NOT render the project name or
 * address in its body by design. For those, the brand-propagation signal
 * is the booking_id prefix (BK-MH-* vs BK-MA-*) which projectInfo also
 * keys off, so a Settings display-name save that refetches booking still
 * flips the doc via the same channel.
 */
const BODY_HAS_PROJECT_NAME: ReadonlySet<string> = new Set(
  DOC_TYPES.filter((t) => t !== "deposit-summary"),
);

/* ────────────────────────────────────────────────────────────────────── *
 * Swap-leak failure artifacts.
 *
 * When the fleet-wide Heights↔Arcade swap test finds any residue signal
 * in a doc's rendered HTML, we dump the full render for the offending
 * `{docType, signal}` pair so CI can attach it to the run without the
 * developer having to reproduce locally.
 *
 * Layout:
 *   test-results/documents-swap-leak/<direction>/<docType>/<signal-slug>/
 *     ├─ manifest.json    (doc type, direction, signal label + pattern,
 *     │                    match preview, timestamp)
 *     ├─ rendered.html    (full renderToStaticMarkup output)
 *     └─ rendered.txt     (text-only extraction — grep-friendly)
 *
 * Override the root with `DOCS_SWAP_LEAK_ARTIFACT_DIR` (e.g. a CI-mounted
 * volume). The writer is best-effort: any failure is logged but never
 * masks the real test failure.
 * ────────────────────────────────────────────────────────────────────── */

const SWAP_LEAK_ARTIFACT_ROOT =
  process.env.DOCS_SWAP_LEAK_ARTIFACT_DIR ?? "test-results/documents-swap-leak";

/**
 * Default byte cap for `rendered.html` / `rendered.txt` on disk. Kept
 * as a UTF-16 character count (matches `.length`, which is what the
 * manifest's `renderedBytes` field records). Override per-call with
 * `writeSwapLeakArtifact({ maxStoredBytes })`, or globally via the
 * `DOCS_SWAP_LEAK_MAX_STORED_BYTES` env var. Set to `0` or a negative
 * value to disable capping (unbounded artifacts).
 */
export const SWAP_LEAK_DEFAULT_MAX_STORED_BYTES: number = (() => {
  const raw = process.env.DOCS_SWAP_LEAK_MAX_STORED_BYTES;
  if (!raw) return 256 * 1024; // 256 KiB — enough for full rendered docs, fits CI upload budgets.
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 256 * 1024;
})();

/**
 * Clip a rendered body to `cap` characters, appending an inline
 * truncation marker so both the diff viewer and a human reader can see
 * exactly what happened. Returns the trimmed body plus size metadata
 * that `writeSwapLeakArtifact` records in `manifest.json.storage`.
 *
 * The marker is a single line prefixed with the appropriate comment
 * syntax for the artifact kind:
 *   - `html`: `<!-- [truncated: kept N of M bytes for CI artifact size cap] -->`
 *   - `txt` : `[truncated: kept N of M bytes for CI artifact size cap]`
 *
 * Truncation happens on both `previous` and `next` bodies (because the
 * previous snapshot was written by an earlier capped run), so the
 * unified diff stays consistent — no spurious `+`/`-` lines caused by
 * asymmetric truncation. When `cap` is falsy or ≥ body length, the
 * body is returned unchanged with `truncated: false`.
 */
export function capForStorage(
  body: string,
  cap: number | undefined,
  kind: "html" | "txt",
): { stored: string; originalBytes: number; storedBytes: number; truncated: boolean } {
  const originalBytes = body.length;
  if (!cap || cap <= 0 || originalBytes <= cap) {
    return { stored: body, originalBytes, storedBytes: originalBytes, truncated: false };
  }
  const inner = `[truncated: kept __KEPT__ of ${originalBytes} bytes for CI artifact size cap]`;
  const marker = kind === "html" ? `\n<!-- ${inner} -->\n` : `\n${inner}\n`;
  // Cap must leave room for the marker; if the cap is smaller than the
  // marker itself, emit just the marker (with kept=0) — that's still
  // informative and never larger than the original body.
  const room = Math.max(0, cap - marker.length);
  const kept = Math.min(room, originalBytes);
  const finalMarker = marker.replace("__KEPT__", String(kept));
  const stored = body.slice(0, kept) + finalMarker;
  return { stored, originalBytes, storedBytes: stored.length, truncated: true };
}

function slugify(s: string): string {
  return (
    s
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase()
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "unnamed"
  );
}

/**
 * Strip tags for a grep-friendly text file. Not perfect, but sufficient
 * for locating a leaked substring in a failed CI run.
 */
function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract a short window around the first regex match so the manifest
 * shows exactly where the leak is without opening `rendered.html`.
 */
function matchPreview(html: string, rx: RegExp): string | null {
  const m = html.match(rx);
  if (!m || m.index === undefined) return null;
  const start = Math.max(0, m.index - 80);
  const end = Math.min(html.length, m.index + m[0].length + 80);
  return `…${html.slice(start, end)}…`;
}

/**
 * JSON Schema (Draft-07 shape) for a swap-leak `manifest.json`. Exported
 * so CI tooling — or a follow-up script — can point ajv/any-json-schema
 * validator at the on-disk artifact without importing runtime code.
 *
 * The schema is the source of truth; `validateSwapLeakManifest` below
 * implements a dependency-free subset of Draft-07 that covers exactly
 * what this schema declares (type, required, enum, minimum, minLength,
 * pattern, additionalProperties: false, nullable via `type: [x, "null"]`).
 * Keep the two in sync — a validator field with no schema counterpart
 * (or vice versa) is a bug.
 */
export const SWAP_LEAK_MANIFEST_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "SwapLeakManifest",
  type: "object",
  additionalProperties: false,
  required: [
    "failedAt",
    "direction",
    "docType",
    "signal",
    "matchPreview",
    "renderedBytes",
    "hasPrevious",
  ],
  properties: {
    // ISO-8601 UTC timestamp. Loose regex — we don't need to validate
    // month/day ranges, just prove the writer didn't emit a raw Date
    // object or an empty string.
    failedAt: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$",
    },
    direction: {
      type: "string",
      enum: ["heights-to-arcade", "arcade-to-heights"],
    },
    docType: { type: "string", minLength: 1 },
    signal: {
      type: "object",
      additionalProperties: false,
      required: ["label", "pattern"],
      properties: {
        label: { type: "string", minLength: 1 },
        // Regex `.toString()` always starts with `/` and ends with
        // `/<flags>` — anchoring both ends catches partial writes.
        pattern: { type: "string", pattern: "^/.+/[a-z]*$" },
      },
    },
    // Nullable: writer emits `null` when the signal's regex found no
    // match preview (should be rare but not schema-invalid).
    matchPreview: { type: ["string", "null"] },
    renderedBytes: { type: "integer", minimum: 0 },
    hasPrevious: { type: "boolean" },
    // Present only when a previous run existed and diff artifacts were
    // emitted. Sub-objects mirror `diff.html.patch` and `diff.txt.patch`.
    // Every field is a non-negative integer. `changedChars` equals
    // `addedChars + removedChars` — the writer computes both so post-
    // mortem tools don't have to.
    diffMetrics: {
      type: "object",
      additionalProperties: false,
      required: ["html", "txt"],
      properties: {
        html: {
          type: "object",
          additionalProperties: false,
          required: [
            "hunks",
            "addedLines",
            "removedLines",
            "addedChars",
            "removedChars",
            "changedChars",
          ],
          properties: {
            hunks: { type: "integer", minimum: 0 },
            addedLines: { type: "integer", minimum: 0 },
            removedLines: { type: "integer", minimum: 0 },
            addedChars: { type: "integer", minimum: 0 },
            removedChars: { type: "integer", minimum: 0 },
            changedChars: { type: "integer", minimum: 0 },
          },
        },
        txt: {
          type: "object",
          additionalProperties: false,
          required: [
            "hunks",
            "addedLines",
            "removedLines",
            "addedChars",
            "removedChars",
            "changedChars",
          ],
          properties: {
            hunks: { type: "integer", minimum: 0 },
            addedLines: { type: "integer", minimum: 0 },
            removedLines: { type: "integer", minimum: 0 },
            addedChars: { type: "integer", minimum: 0 },
            removedChars: { type: "integer", minimum: 0 },
            changedChars: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    // Present on every writer run when `rendered.*` are emitted. Records
    // the original vs on-disk size of each artifact (`originalBytes` =
    // pre-cap length, `storedBytes` = actual file length including any
    // truncation marker). `truncated: true` means the writer clipped
    // the body to fit `maxStoredBytes`.
    storage: {
      type: "object",
      additionalProperties: false,
      required: ["html", "txt"],
      properties: {
        html: {
          type: "object",
          additionalProperties: false,
          required: ["originalBytes", "storedBytes", "truncated"],
          properties: {
            originalBytes: { type: "integer", minimum: 0 },
            storedBytes: { type: "integer", minimum: 0 },
            truncated: { type: "boolean" },
          },
        },
        txt: {
          type: "object",
          additionalProperties: false,
          required: ["originalBytes", "storedBytes", "truncated"],
          properties: {
            originalBytes: { type: "integer", minimum: 0 },
            storedBytes: { type: "integer", minimum: 0 },
            truncated: { type: "boolean" },
          },
        },
      },
    },
  },
} as const;

/**
 * Dependency-free validator for the manifest schema above. Returns a
 * flat error list — empty array means valid. The messages include the
 * JSON path (`.signal.pattern`, etc.) so CI logs point at the exact
 * broken field, not the whole document.
 *
 * Only the schema features actually used by SWAP_LEAK_MANIFEST_SCHEMA
 * are implemented: `type` (including `["x","null"]` union), `enum`,
 * `required`, `additionalProperties: false`, `minLength`, `minimum`,
 * `pattern`, and object recursion. If SWAP_LEAK_MANIFEST_SCHEMA grows
 * a new keyword, wire it in here too — the self-check test at the end
 * of the file will catch a missed case.
 */
export function validateSwapLeakManifest(value: unknown): string[] {
  const errors: string[] = [];

  type SchemaNode = {
    type?: string | string[];
    enum?: readonly unknown[];
    required?: readonly string[];
    properties?: Record<string, SchemaNode>;
    additionalProperties?: boolean;
    minLength?: number;
    minimum?: number;
    pattern?: string;
  };

  const check = (node: SchemaNode, val: unknown, path: string): void => {
    // Type. Accept unions declared as arrays; "integer" is a JS number
    // that is a safe integer.
    if (node.type) {
      const types = Array.isArray(node.type) ? node.type : [node.type];
      const jsType =
        val === null
          ? "null"
          : Array.isArray(val)
            ? "array"
            : typeof val === "number" && Number.isInteger(val)
              ? "integer"
              : typeof val;
      const ok =
        types.includes(jsType) ||
        (types.includes("number") && typeof val === "number") ||
        (types.includes("string") && typeof val === "string") ||
        (types.includes("boolean") && typeof val === "boolean") ||
        (types.includes("object") && jsType === "object" && val !== null);
      if (!ok) {
        errors.push(`${path}: expected type ${types.join("|")}, got ${jsType}`);
        return;
      }
    }
    if (node.enum && !node.enum.includes(val as never)) {
      errors.push(`${path}: value ${JSON.stringify(val)} not in enum ${JSON.stringify(node.enum)}`);
    }
    if (typeof val === "string") {
      if (node.minLength !== undefined && val.length < node.minLength) {
        errors.push(`${path}: minLength ${node.minLength} violated (got length ${val.length})`);
      }
      if (node.pattern && !new RegExp(node.pattern).test(val)) {
        errors.push(`${path}: pattern /${node.pattern}/ not matched (got ${JSON.stringify(val)})`);
      }
    }
    if (typeof val === "number" && node.minimum !== undefined && val < node.minimum) {
      errors.push(`${path}: minimum ${node.minimum} violated (got ${val})`);
    }
    if (node.properties && val && typeof val === "object" && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      for (const req of node.required ?? []) {
        if (!(req in obj)) {
          errors.push(`${path}: required property "${req}" missing`);
        }
      }
      if (node.additionalProperties === false) {
        for (const key of Object.keys(obj)) {
          if (!(key in node.properties)) {
            errors.push(`${path}: additional property "${key}" not allowed`);
          }
        }
      }
      for (const [key, sub] of Object.entries(node.properties)) {
        if (key in obj) {
          check(sub as SchemaNode, obj[key], `${path}.${key}`);
        }
      }
    }
  };

  check(SWAP_LEAK_MANIFEST_SCHEMA as unknown as SchemaNode, value, "$");
  return errors;
}

/**
 * Line-level unified diff between two strings. Not a full Myers diff —
 * we use a longest-common-subsequence table sized to the line count of
 * each side, which is fine for our artifact sizes (rendered docs are a
 * few hundred lines at most) and keeps the helper dependency-free.
 *
 * Returned format matches `diff -u` conventions closely enough to be
 * readable in any text viewer:
 *   ` foo`  = unchanged (context)
 *   `-foo`  = present in previous, removed in next
 *   `+foo`  = added in next
 *
 * The header names come from `params.prevLabel` / `params.nextLabel`
 * so a downloaded `diff.txt` in CI is self-describing.
 */
export function computeUnifiedDiff(params: {
  prev: string;
  next: string;
  prevLabel?: string;
  nextLabel?: string;
  context?: number;
}): string {
  const prevLines = params.prev.split("\n");
  const nextLines = params.next.split("\n");
  const n = prevLines.length;
  const m = nextLines.length;

  // LCS table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        prevLines[i] === nextLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // Walk the table to produce ops.
  type Op = { tag: " " | "-" | "+"; text: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (prevLines[i] === nextLines[j]) {
      ops.push({ tag: " ", text: prevLines[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ tag: "-", text: prevLines[i++] });
    } else {
      ops.push({ tag: "+", text: nextLines[j++] });
    }
  }
  while (i < n) ops.push({ tag: "-", text: prevLines[i++] });
  while (j < m) ops.push({ tag: "+", text: nextLines[j++] });

  const prevLabel = params.prevLabel ?? "previous";
  const nextLabel = params.nextLabel ?? "next";
  const header = `--- ${prevLabel}\n+++ ${nextLabel}\n`;

  // If nothing changed, still emit the header so downstream tooling can
  // detect "no diff" without special-casing an empty file.
  const anyChange = ops.some((o) => o.tag !== " ");
  if (!anyChange) return `${header}(no changes)\n`;

  return header + ops.map((o) => `${o.tag}${o.text}`).join("\n") + "\n";
}

/**
 * Summary metrics for a unified diff produced by `computeUnifiedDiff`.
 * Consumed by `writeSwapLeakArtifact` to enrich `manifest.json` with
 * hunk / line / character counts so a post-mortem tool can rank leaks
 * by change size without re-parsing each `.patch` file.
 *
 * A "hunk" here is a maximal contiguous run of `+`/`-` lines separated
 * by context (` `) lines. The diff header (`---` / `+++`), blank tail
 * line, and the sentinel `(no changes)` line never count as change
 * lines and always terminate a hunk. `changedChars` = `addedChars +
 * removedChars` (the leading `+` / `-` sign is excluded).
 */
export function computeUnifiedDiffMetrics(unified: string): {
  hunks: number;
  addedLines: number;
  removedLines: number;
  addedChars: number;
  removedChars: number;
  changedChars: number;
} {
  let hunks = 0;
  let addedLines = 0;
  let removedLines = 0;
  let addedChars = 0;
  let removedChars = 0;
  let inHunk = false;

  for (const line of unified.split("\n")) {
    if (
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line === "(no changes)" ||
      line === ""
    ) {
      inHunk = false;
      continue;
    }
    if (line.startsWith("+")) {
      if (!inHunk) {
        hunks++;
        inHunk = true;
      }
      addedLines++;
      addedChars += line.length - 1;
    } else if (line.startsWith("-")) {
      if (!inHunk) {
        hunks++;
        inHunk = true;
      }
      removedLines++;
      removedChars += line.length - 1;
    } else {
      // Context line (leading space) — closes the current hunk.
      inHunk = false;
    }
  }

  return {
    hunks,
    addedLines,
    removedLines,
    addedChars,
    removedChars,
    changedChars: addedChars + removedChars,
  };
}

/**
 * Standalone HTML viewer for a computed unified diff. No external CSS /
 * JS — safe to open directly from a downloaded CI artifact. Colours use
 * literal hex intentionally: this file is written to disk for a human
 * reviewer, not rendered inside the app, so semantic-token rules don't
 * apply.
 */
export function renderDiffHtml(params: {
  title: string;
  unifiedDiff: string;
  prevLabel?: string;
  nextLabel?: string;
}): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const rows = params.unifiedDiff
    .split("\n")
    .map((line) => {
      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        return `<div class="hdr">${escape(line)}</div>`;
      }
      if (line.startsWith("+")) {
        return `<div class="add">${escape(line)}</div>`;
      }
      if (line.startsWith("-")) {
        return `<div class="del">${escape(line)}</div>`;
      }
      if (line === "(no changes)") {
        return `<div class="eq"><em>${escape(line)}</em></div>`;
      }
      return `<div class="ctx">${escape(line)}</div>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(params.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; padding: 1rem; background: #0b0f14; color: #d7e0ea; }
  h1 { font: 600 15px/1.4 system-ui, sans-serif; margin: 0 0 0.75rem; }
  .meta { color: #8ea1b8; font: 12px/1.4 system-ui, sans-serif; margin-bottom: 0.75rem; }
  .diff { border: 1px solid #223041; border-radius: 6px; overflow: auto; }
  .diff > div { padding: 0 0.75rem; white-space: pre-wrap; word-break: break-word; }
  .hdr { background: #1a2432; color: #cfe1ff; font-weight: 600; }
  .add { background: #10321f; color: #b9f5cf; }
  .del { background: #3a1418; color: #ffb4bc; }
  .ctx { color: #90a3b8; }
  .eq  { color: #8ea1b8; padding: 0.5rem 0.75rem; }
</style>
</head>
<body>
<h1>${escape(params.title)}</h1>
<p class="meta">${escape(params.prevLabel ?? "previous")} → ${escape(params.nextLabel ?? "next")}</p>
<div class="diff">${rows}</div>
</body>
</html>
`;
}

export function writeSwapLeakArtifact(params: {
  direction: "heights-to-arcade" | "arcade-to-heights";
  docType: string;
  signal: { label: string; rx: RegExp };
  html: string;
  rootDir?: string;
  /**
   * Cap for the on-disk size of `rendered.html` / `rendered.txt` /
   * `previous.*`, in characters. When a body exceeds the cap it is
   * truncated with an inline marker (see `capForStorage`). Defaults to
   * `SWAP_LEAK_DEFAULT_MAX_STORED_BYTES` (env-configurable). Pass `0`
   * or a negative value to disable capping entirely.
   */
  maxStoredBytes?: number;
}): { dir: string; files: string[]; diff: { changed: boolean; files: string[] } | null } | null {
  try {
    // Lazy imports so the file still typechecks/loads under browsers/JSDOM
    // even though the writer only runs under Node in vitest.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require("node:path") as typeof import("node:path");
    const { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } = fs;

    const root = params.rootDir ?? SWAP_LEAK_ARTIFACT_ROOT;
    const dir = join(root, params.direction, params.docType, slugify(params.signal.label));
    mkdirSync(dir, { recursive: true });

    const cap = params.maxStoredBytes ?? SWAP_LEAK_DEFAULT_MAX_STORED_BYTES;

    // Snapshot any pre-existing rendered artifacts as `previous.*` BEFORE
    // we overwrite them. This gives the diff viewer a reliable "prior
    // run" to compare against without needing an external cache.
    //
    // Apply the same size cap up-front to BOTH the incoming body and the
    // rehydrated previous body. The previous file on disk was already
    // capped by the earlier run, so re-reading it costs nothing, but if
    // the cap tightens between runs we still want the diff to compare
    // like-for-like bodies (both trimmed to the current cap) instead of
    // producing spurious `-` lines for suffix content that no longer
    // fits in the new budget.
    const rawNextHtml = params.html;
    const rawNextText = stripTags(params.html);
    const htmlStored = capForStorage(rawNextHtml, cap, "html");
    const textStored = capForStorage(rawNextText, cap, "txt");
    const nextHtml = htmlStored.stored;
    const nextText = textStored.stored;

    const priorHtmlPath = join(dir, "rendered.html");
    const priorTextPath = join(dir, "rendered.txt");
    const prevHtmlPath = join(dir, "previous.html");
    const prevTextPath = join(dir, "previous.txt");

    let prevHtml: string | null = null;
    let prevText: string | null = null;
    if (existsSync(priorHtmlPath)) {
      const raw = readFileSync(priorHtmlPath, "utf8");
      prevHtml = capForStorage(raw, cap, "html").stored;
      renameSync(priorHtmlPath, prevHtmlPath);
      if (prevHtml !== raw) writeFileSync(prevHtmlPath, prevHtml);
    }
    if (existsSync(priorTextPath)) {
      const raw = readFileSync(priorTextPath, "utf8");
      prevText = capForStorage(raw, cap, "txt").stored;
      renameSync(priorTextPath, prevTextPath);
      if (prevText !== raw) writeFileSync(prevTextPath, prevText);
    }

    const files: string[] = [];
    const write = (name: string, body: string) => {
      const p = join(dir, name);
      writeFileSync(p, body);
      files.push(p);
    };
    // `renameSync` above already placed previous.* on disk; surface them
    // in the returned file list so callers/CI logs know they exist.
    if (prevHtml !== null) files.push(prevHtmlPath);
    if (prevText !== null) files.push(prevTextPath);

    const preview = matchPreview(params.html, params.signal.rx);
    const hasPrevious = prevHtml !== null || prevText !== null;

    // Compute diff up-front so `manifest.json` can carry summary metrics
    // (hunks, added/removed lines and characters) alongside the raw
    // `.patch` files. Diff operates on the *stored* (capped) bodies so
    // the viewer never references content that isn't on disk.
    let htmlUnified: string | null = null;
    let textUnified: string | null = null;
    let diffMetrics:
      | {
          html: ReturnType<typeof computeUnifiedDiffMetrics>;
          txt: ReturnType<typeof computeUnifiedDiffMetrics>;
        }
      | undefined;
    if (hasPrevious) {
      htmlUnified = computeUnifiedDiff({
        prev: prevHtml ?? "",
        next: nextHtml,
        prevLabel: "previous/rendered.html",
        nextLabel: "next/rendered.html",
      });
      textUnified = computeUnifiedDiff({
        prev: prevText ?? "",
        next: nextText,
        prevLabel: "previous/rendered.txt",
        nextLabel: "next/rendered.txt",
      });
      diffMetrics = {
        html: computeUnifiedDiffMetrics(htmlUnified),
        txt: computeUnifiedDiffMetrics(textUnified),
      };
    }

    const manifest = {
      failedAt: new Date().toISOString(),
      direction: params.direction,
      docType: params.docType,
      signal: {
        label: params.signal.label,
        pattern: params.signal.rx.toString(),
      },
      matchPreview: preview,
      renderedBytes: params.html.length,
      hasPrevious,
      ...(diffMetrics ? { diffMetrics } : {}),
      storage: {
        html: {
          originalBytes: htmlStored.originalBytes,
          storedBytes: htmlStored.storedBytes,
          truncated: htmlStored.truncated,
        },
        txt: {
          originalBytes: textStored.originalBytes,
          storedBytes: textStored.storedBytes,
          truncated: textStored.truncated,
        },
      },
    };

    // Fail-fast schema validation: a malformed or partial write would
    // otherwise persist to disk and produce a confusing CI failure two
    // layers downstream (post-mortem tooling parsing manifest.json).
    // We throw here so the `try/catch` above turns the invalid manifest
    // into a `[documents-swap-leak] artifact write failed` warning with
    // the exact field path — clearer than a JSON.parse error later.
    const schemaErrors = validateSwapLeakManifest(manifest);
    if (schemaErrors.length > 0) {
      throw new Error(
        `manifest.json failed schema validation:\n  - ${schemaErrors.join("\n  - ")}`,
      );
    }

    write("manifest.json", JSON.stringify(manifest, null, 2));
    write("rendered.html", nextHtml);
    write("rendered.txt", nextText);

    // Emit diff artifacts only when a previous run exists; otherwise the
    // "diff" is just the full new file, which is redundant.
    let diff: { changed: boolean; files: string[] } | null = null;
    if (htmlUnified !== null && textUnified !== null) {
      const diffFiles: string[] = [];

      write("diff.html.patch", htmlUnified);
      diffFiles.push(join(dir, "diff.html.patch"));
      write("diff.txt.patch", textUnified);
      diffFiles.push(join(dir, "diff.txt.patch"));

      write(
        "diff.html",
        renderDiffHtml({
          title: `${params.docType} · ${params.signal.label} · ${params.direction}`,
          unifiedDiff: textUnified,
          prevLabel: "previous/rendered.txt",
          nextLabel: "next/rendered.txt",
        }),
      );
      diffFiles.push(join(dir, "diff.html"));

      const changed =
        !htmlUnified.includes("(no changes)") || !textUnified.includes("(no changes)");
      diff = { changed, files: diffFiles };
    }

    return { dir, files, diff };
  } catch (err) {
    console.warn(
      `[documents-swap-leak] artifact write failed for ${params.docType}/${params.signal.label}: ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * Format a human-readable block for the swap-leak assertion failure
 * message that includes clickable `file://` links pointing directly at
 * the generated `diff.html` viewer and its unified `.patch` companions.
 *
 * Rendered as (one entry per leak):
 *
 *   artifacts saved to:
 *     <artifact dir>
 *       diff viewer:         file:///.../diff.html
 *       unified diff (html): file:///.../diff.html.patch
 *       unified diff (text): file:///.../diff.txt.patch
 *
 * Runners (VS Code, most terminals, CI log viewers) hyperlink `file://`
 * URLs, so a failing test can be inspected with one click instead of
 * hunting through the `test-results/documents-swap-leak/` tree.
 *
 * When no `diff` is present (first-ever run for this signal — no
 * `previous.*` snapshot on disk yet) we still print the artifact
 * directory and note that the diff will appear on the next failure.
 */
export function formatSwapLeakArtifactLinks(
  entries: Array<{ dir: string; diff: { files: string[] } | null }>,
): string {
  if (entries.length === 0) return "";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pathToFileURL } = require("node:url") as typeof import("node:url");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { basename } = require("node:path") as typeof import("node:path");

  const LABELS: Record<string, string> = {
    "diff.html": "diff viewer:        ",
    "diff.html.patch": "unified diff (html):",
    "diff.txt.patch": "unified diff (text):",
  };
  // Preferred display order — viewer first (most useful), then patches.
  const ORDER = ["diff.html", "diff.html.patch", "diff.txt.patch"];

  const lines: string[] = ["artifacts saved to:"];
  for (const { dir, diff } of entries) {
    lines.push(`  ${dir}`);
    if (!diff || diff.files.length === 0) {
      lines.push(
        "    (no diff yet — first failing run for this signal; rerun to populate previous.*)",
      );
      continue;
    }
    const byName = new Map<string, string>();
    for (const f of diff.files) byName.set(basename(f), f);
    for (const name of ORDER) {
      const abs = byName.get(name);
      if (!abs) continue;
      lines.push(`    ${LABELS[name]} ${pathToFileURL(abs).href}`);
    }
  }
  return lines.join("\n");
}

describe("Documents E2E — every printable doc type reflects Settings display-name change", () => {
  describe.each(DOC_TYPES)("%s doc", (type) => {
    const heightsBooking = makeBooking();
    const arcadeBooking = makeBooking({
      booking_id: "BK-MA-101",
      project_name: "Manal Arcade",
    });
    const hasBrandInBody = BODY_HAS_PROJECT_NAME.has(type);

    it("initial Heights render shows Manal Heights branding in header/body/metadata", () => {
      const html = renderType(type, heightsBooking);
      if (hasBrandInBody) {
        expect(html, `${type} should render Manal Heights branding`).toMatch(RX_HEIGHTS);
      } else {
        // Ledger-style doc: brand tie is the booking_id prefix.
        expect(html, `${type} should carry Heights booking_id prefix`).toMatch(/BK-MH-/);
      }
      // Arcade must not leak into a Heights render, in either doc shape.
      expect(html, `${type} must not leak Manal Arcade in Heights render`).not.toMatch(RX_ARCADE);
      expect(html, `${type} must not leak manalarcade@ email in Heights render`).not.toMatch(
        RX_ARCADE_EMAIL,
      );
    });

    it("swapping the project (Settings display-name change) flips header, body, and footer", () => {
      const before = renderType(type, heightsBooking);
      // Simulate what the refetched booking looks like AFTER the Settings save:
      // the doc-booking query now returns the new project_name + booking_id
      // prefix. This is the exact channel Settings.tsx invalidates
      // (`doc-booking`) so document surfaces re-render with the new brand.
      const after = renderType(type, arcadeBooking);

      if (hasBrandInBody) {
        expect(before).toMatch(RX_HEIGHTS);
        expect(before).not.toMatch(RX_ARCADE);
        expect(after, `${type} header/body must switch to Manal Arcade`).toMatch(RX_ARCADE);
        expect(after, `${type} must not retain Manal Heights after swap`).not.toMatch(RX_HEIGHTS);
        expect(after, `${type} must not retain manalheights@ after swap`).not.toMatch(
          RX_HEIGHTS_EMAIL,
        );
      } else {
        // Ledger doc: assert the booking_id prefix flip end-to-end.
        expect(before).toMatch(/BK-MH-/);
        expect(before).not.toMatch(/BK-MA-/);
        expect(after, `${type} booking_id must switch to Arcade prefix`).toMatch(/BK-MA-/);
        expect(after, `${type} must not retain Heights booking_id after swap`).not.toMatch(
          /BK-MH-/,
        );
      }
    });

    it("address metadata switches with the display name", () => {
      if (!hasBrandInBody) return; // ledger doc has no address metadata by design
      const heightsHtml = renderType(type, heightsBooking);
      const arcadeHtml = renderType(type, arcadeBooking);
      // Every branded doc references the project short/full address at least
      // once (subject line, "To" block, or plot description). Verify the
      // address token present in Heights output disappears from Arcade output
      // and vice versa, so we catch any doc that forgets to funnel through
      // projectInfo.
      const heightsHasAddr = RX_HEIGHTS_ADDR.test(heightsHtml) || RX_HEIGHTS.test(heightsHtml);
      const arcadeHasAddr = RX_ARCADE_ADDR.test(arcadeHtml) || RX_ARCADE.test(arcadeHtml);
      expect(heightsHasAddr, `${type} Heights render should carry Heights address token`).toBe(
        true,
      );
      expect(arcadeHasAddr, `${type} Arcade render should carry Arcade address token`).toBe(true);
    });
  });

  it("legal-notice / final / cancel emit the correct project email in the bank panel", () => {
    // These four docs render `BankBlockDV` which historically defaulted to
    // manalarcade@gmail.com. The audit test statically banned that default;
    // this assertion is the runtime backstop: a Heights render must show
    // the Heights email and no Arcade email anywhere.
    for (const type of ["legal-notice", "final-legal-notice", "final-cancel-warning"] as const) {
      const html = renderType(type, makeBooking());
      expect(html, `${type} should surface manalheights@ in Heights render`).toMatch(
        RX_HEIGHTS_EMAIL,
      );
      expect(html, `${type} must not surface manalarcade@ in Heights render`).not.toMatch(
        RX_ARCADE_EMAIL,
      );
    }
  });

  it("Heights → non-Heights swap fully removes every Manal Heights string across all doc surfaces", () => {
    // Aggregate the "after swap" render of every doc type into one blob and
    // assert no Manal Heights signal — name, email, or address — survives.
    // This is the fleet-wide backstop: a single doc that forgets to funnel
    // through projectInfo would show up here even if its per-type test
    // passed for an unrelated reason.
    const arcadeBooking = makeBooking({
      booking_id: "BK-MA-101",
      project_name: "Manal Arcade",
    });

    const perType = DOC_TYPES.map((type) => ({
      type,
      html: renderType(type, arcadeBooking),
    }));

    // Every doc that carries brand in its body must now show Arcade.
    for (const { type, html } of perType) {
      if (BODY_HAS_PROJECT_NAME.has(type)) {
        expect(html, `${type} must show Manal Arcade after swap`).toMatch(RX_ARCADE);
      } else {
        expect(html, `${type} must carry BK-MA- booking id after swap`).toMatch(/BK-MA-/);
      }
    }

    // Fleet-wide leak check: NO doc body may contain any Heights signal
    // after the swap. Report the offending doc type in the failure message.
    const HEIGHTS_SIGNALS: Array<{ label: string; rx: RegExp }> = [
      { label: "Manal Heights (name)", rx: RX_HEIGHTS },
      { label: "manalheights@ (email)", rx: RX_HEIGHTS_EMAIL },
      { label: "B-17 Multi Gardens (Heights address)", rx: RX_HEIGHTS_ADDR },
      { label: "BK-MH- (Heights booking id)", rx: /BK-MH-/ },
    ];

    const leaks: string[] = [];
    const leakArtifacts: Array<{ dir: string; diff: { files: string[] } | null }> = [];
    for (const { type, html } of perType) {
      for (const signal of HEIGHTS_SIGNALS) {
        if (signal.rx.test(html)) {
          leaks.push(`${type} leaked ${signal.label}`);
          const written = writeSwapLeakArtifact({
            direction: "heights-to-arcade",
            docType: type,
            signal,
            html,
          });
          if (written) leakArtifacts.push({ dir: written.dir, diff: written.diff });
        }
      }
    }

    expect(
      leaks,
      `no Heights signals should survive a Heights→Arcade swap; leaks:\n${leaks.join("\n")}${
        leakArtifacts.length ? `\n\n${formatSwapLeakArtifactLinks(leakArtifacts)}` : ""
      }`,
    ).toEqual([]);

    // Also assert the combined blob so a regression report shows the exact
    // offending substring, not just a doc name.
    const combined = perType.map((p) => p.html).join("\n---\n");
    expect(combined).not.toMatch(RX_HEIGHTS);
    expect(combined).not.toMatch(RX_HEIGHTS_EMAIL);
    expect(combined).not.toMatch(RX_HEIGHTS_ADDR);
    expect(combined).not.toMatch(/BK-MH-/);
  });

  it("non-Heights → Heights swap surfaces every Manal Heights string and fully removes Arcade across all doc surfaces", () => {
    // Reverse of the Heights→Arcade fleet-wide backstop above. A doc that
    // hard-codes Arcade branding (or forgets to funnel through
    // projectInfo when the new project is Heights) would slip past the
    // one-way test — this ensures the swap is symmetric.
    const heightsBooking = makeBooking(); // BK-MH-101 / Manal Heights

    const perType = DOC_TYPES.map((type) => ({
      type,
      html: renderType(type, heightsBooking),
    }));

    // Every branded doc must now show Heights; ledger docs must carry the
    // Heights booking-id prefix.
    for (const { type, html } of perType) {
      if (BODY_HAS_PROJECT_NAME.has(type)) {
        expect(html, `${type} must show Manal Heights after swap`).toMatch(RX_HEIGHTS);
      } else {
        expect(html, `${type} must carry BK-MH- booking id after swap`).toMatch(/BK-MH-/);
      }
    }

    // Fleet-wide leak check: NO doc body may retain any Arcade signal
    // after the swap to Heights.
    const ARCADE_SIGNALS: Array<{ label: string; rx: RegExp }> = [
      { label: "Manal Arcade (name)", rx: RX_ARCADE },
      { label: "manalarcade@ (email)", rx: RX_ARCADE_EMAIL },
      { label: "B-1 Markaz (Arcade address)", rx: RX_ARCADE_ADDR },
      { label: "BK-MA- (Arcade booking id)", rx: /BK-MA-/ },
    ];

    const leaks: string[] = [];
    const leakArtifacts: Array<{ dir: string; diff: { files: string[] } | null }> = [];
    for (const { type, html } of perType) {
      for (const signal of ARCADE_SIGNALS) {
        if (signal.rx.test(html)) {
          leaks.push(`${type} leaked ${signal.label}`);
          const written = writeSwapLeakArtifact({
            direction: "arcade-to-heights",
            docType: type,
            signal,
            html,
          });
          if (written) leakArtifacts.push({ dir: written.dir, diff: written.diff });
        }
      }
    }

    expect(
      leaks,
      `no Arcade signals should survive an Arcade→Heights swap; leaks:\n${leaks.join("\n")}${
        leakArtifacts.length ? `\n\n${formatSwapLeakArtifactLinks(leakArtifacts)}` : ""
      }`,
    ).toEqual([]);

    // Combined blob backstop — surfaces the exact offending substring in
    // the failure report, not just a doc name.
    const combined = perType.map((p) => p.html).join("\n---\n");
    expect(combined, "combined output must show Manal Heights").toMatch(RX_HEIGHTS);
    expect(combined, "combined output must show manalheights@ email").toMatch(RX_HEIGHTS_EMAIL);
    expect(combined, "combined output must show Heights address").toMatch(RX_HEIGHTS_ADDR);
    expect(combined, "combined output must show BK-MH- booking id").toMatch(/BK-MH-/);
    expect(combined, "combined output must not contain Manal Arcade").not.toMatch(RX_ARCADE);
    expect(combined, "combined output must not contain manalarcade@").not.toMatch(RX_ARCADE_EMAIL);
    expect(combined, "combined output must not contain Arcade address").not.toMatch(RX_ARCADE_ADDR);
    expect(combined, "combined output must not contain BK-MA-").not.toMatch(/BK-MA-/);
  });
});

/**
 * Live-swap E2E: change the selected project (Heights ↔ non-Heights) WITHOUT
 * unmounting or reloading the harness, and verify every doc type's preview
 * updates on the same DOM nodes.
 *
 * The real Documents page keeps the doc preview and Settings side-by-side;
 * when the user swaps projects, only the `doc-booking` (and the shared
 * `s-projects`) query re-fetches — the doc components stay mounted. This
 * test mounts a single harness that subscribes to `doc-booking`, renders
 * every one of the 13 doc types into its own container, then flips the
 * store-backed booking and invalidates. The same containers must reflect
 * the new brand — no unmount, no key-based remount.
 */
describe("Documents E2E — live project swap updates every doc type without remount", () => {
  const heightsBooking = makeBooking(); // BK-MH-101 / Manal Heights
  const arcadeBooking = makeBooking({
    booking_id: "BK-MA-101",
    project_name: "Manal Arcade",
  });

  // Backing store the harness reads through the `doc-booking` query. Flipping
  // this is what a Settings project-swap ultimately does.
  const store: { current: Record<string, unknown> } = { current: heightsBooking };

  function LiveDocsHarness() {
    const { data: booking } = useQuery({
      queryKey: ["doc-booking"],
      queryFn: async () => store.current,
    });
    if (!booking) return null;
    return (
      <div>
        {DOC_TYPES.map((type) => (
          <div key={type} data-testid={`doc-${type}`}>
            {
              renderDocBody({
                type,
                booking,
                payments: [samplePayment],
                ledger: overdueLedger,
                adjustments: [],
                receiptParam: "R-001",
                prev1: "2025-05-01",
                prev2: "2025-05-15",
              }) as any
            }
          </div>
        ))}
      </div>
    );
  }

  /**
   * Capture the DOM node for each doc type BEFORE the swap so we can assert
   * post-swap that the SAME node's textContent reflects the new brand — that
   * is the "no unmount / no reload" guarantee. If any container is replaced
   * during the swap, the reference we captured here would be detached from
   * the document and `document.contains(node)` would be false.
   */
  function snapshotContainers(): Record<string, HTMLElement> {
    const snap: Record<string, HTMLElement> = {};
    for (const type of DOC_TYPES) {
      snap[type] = screen.getByTestId(`doc-${type}`);
    }
    return snap;
  }

  beforeEach(() => {
    // Reset store between tests — vitest reuses module scope.
    store.current = heightsBooking;
  });

  it("Heights → Arcade swap: every doc type re-renders in place with Arcade branding, no Heights leaks", async () => {
    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <LiveDocsHarness />
      </QueryClientProvider>,
    );

    // Initial render must reach Heights branding on every branded doc type.
    await waitFor(() => {
      const receipt = screen.getByTestId("doc-receipt");
      expect(receipt.textContent).toMatch(RX_HEIGHTS);
    });

    const preSwapNodes = snapshotContainers();
    // Sanity: initial state is Heights across the board.
    for (const type of DOC_TYPES) {
      const node = preSwapNodes[type];
      if (BODY_HAS_PROJECT_NAME.has(type)) {
        expect(node.textContent, `${type} initial should show Heights`).toMatch(RX_HEIGHTS);
        expect(node.textContent, `${type} initial must not leak Arcade`).not.toMatch(RX_ARCADE);
      } else {
        expect(node.textContent, `${type} initial should carry BK-MH-`).toMatch(/BK-MH-/);
      }
    }

    // === The swap ===  no rerender, no unmount — just the same channel
    // Settings uses when the user picks a different project.
    await act(async () => {
      store.current = arcadeBooking;
      await qc.invalidateQueries({ queryKey: ["doc-booking"] });
    });

    // Every containing node must still be the SAME DOM element (no remount)
    // AND its content must now reflect Arcade.
    await waitFor(() => {
      expect(screen.getByTestId("doc-receipt").textContent).toMatch(RX_ARCADE);
    });

    for (const type of DOC_TYPES) {
      const before = preSwapNodes[type];
      const after = screen.getByTestId(`doc-${type}`);
      expect(after, `${type} container must not remount`).toBe(before);
      expect(document.contains(before), `${type} pre-swap node must still be attached`).toBe(true);

      if (BODY_HAS_PROJECT_NAME.has(type)) {
        expect(after.textContent, `${type} must switch to Arcade`).toMatch(RX_ARCADE);
        expect(after.textContent, `${type} must not retain Heights name`).not.toMatch(RX_HEIGHTS);
        expect(after.textContent, `${type} must not retain manalheights@`).not.toMatch(
          RX_HEIGHTS_EMAIL,
        );
      } else {
        expect(after.textContent, `${type} booking id must switch to BK-MA-`).toMatch(/BK-MA-/);
        expect(after.textContent, `${type} must not retain BK-MH-`).not.toMatch(/BK-MH-/);
      }
    }
  });

  it("Arcade → Heights swap: same mounted harness flips back with Heights branding, no Arcade leaks", async () => {
    // Start on Arcade this time so we exercise the reverse direction on the
    // same mounted tree; the initial-Heights test above covered forward.
    store.current = arcadeBooking;

    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <LiveDocsHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("doc-receipt").textContent).toMatch(RX_ARCADE);
    });

    const preSwapNodes = snapshotContainers();

    await act(async () => {
      store.current = heightsBooking;
      await qc.invalidateQueries({ queryKey: ["doc-booking"] });
    });

    await waitFor(() => {
      expect(screen.getByTestId("doc-receipt").textContent).toMatch(RX_HEIGHTS);
    });

    for (const type of DOC_TYPES) {
      const before = preSwapNodes[type];
      const after = screen.getByTestId(`doc-${type}`);
      expect(after, `${type} container must not remount`).toBe(before);

      if (BODY_HAS_PROJECT_NAME.has(type)) {
        expect(after.textContent, `${type} must switch to Heights`).toMatch(RX_HEIGHTS);
        expect(after.textContent, `${type} must not retain Arcade name`).not.toMatch(RX_ARCADE);
        expect(after.textContent, `${type} must not retain manalarcade@`).not.toMatch(
          RX_ARCADE_EMAIL,
        );
      } else {
        expect(after.textContent, `${type} booking id must switch to BK-MH-`).toMatch(/BK-MH-/);
        expect(after.textContent, `${type} must not retain BK-MA-`).not.toMatch(/BK-MA-/);
      }
    }
  });

  it("rapid Heights ↔ Arcade ↔ Heights ping-pong settles on the final selection with no cross-brand leaks", async () => {
    // Guards against a stale-render bug where an in-flight refetch from an
    // earlier swap overwrites a later one. The final state must be Heights
    // and nothing from the intermediate Arcade phase may survive.
    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <LiveDocsHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("doc-receipt").textContent).toMatch(RX_HEIGHTS);
    });

    await act(async () => {
      store.current = arcadeBooking;
      await qc.invalidateQueries({ queryKey: ["doc-booking"] });
    });
    await act(async () => {
      store.current = heightsBooking;
      await qc.invalidateQueries({ queryKey: ["doc-booking"] });
    });

    // Final state: Heights everywhere, no Arcade anywhere.
    await waitFor(() => {
      const receipt = screen.getByTestId("doc-receipt");
      expect(receipt.textContent).toMatch(RX_HEIGHTS);
      expect(receipt.textContent).not.toMatch(RX_ARCADE);
    });

    for (const type of DOC_TYPES) {
      const node = screen.getByTestId(`doc-${type}`);
      if (BODY_HAS_PROJECT_NAME.has(type)) {
        expect(node.textContent, `${type} must settle on Heights`).toMatch(RX_HEIGHTS);
        expect(node.textContent, `${type} must have no Arcade residue`).not.toMatch(RX_ARCADE);
      } else {
        expect(node.textContent, `${type} must settle on BK-MH-`).toMatch(/BK-MH-/);
        expect(node.textContent, `${type} must have no BK-MA- residue`).not.toMatch(/BK-MA-/);
      }
    }
  });
});

/**
 * Themed swap-leak coverage.
 *
 * Docs render as static markup — the brand strings live in the content,
 * not in theme-scoped classNames — so a Heights↔Arcade swap must produce
 * identical brand-signal outcomes under both light and dark mode. This
 * suite enforces that invariant by toggling `.dark` + `data-theme` on
 * `document.documentElement` (the same knobs `src/lib/theme.tsx` uses)
 * around each render pass and re-running the fleet-wide leak check
 * per-theme. If a doc ever conditions its brand text on the resolved
 * theme (bad!), one arm will diverge and this suite catches it.
 */
describe("Documents E2E — fleet-wide swap-leak stays consistent across light and dark mode", () => {
  const THEMES = [
    { name: "light" as const, dark: false },
    { name: "dark" as const, dark: true },
  ];

  function applyTheme(dark: boolean) {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.setAttribute("data-theme", dark ? "dark" : "light");
    root.style.colorScheme = dark ? "dark" : "light";
  }

  const originalDark =
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false;
  const originalDataTheme =
    typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : null;

  afterAll(() => {
    // Restore whatever the harness/test-setup had configured so we don't
    // leak dark mode into later suites in the same file.
    applyTheme(originalDark);
    if (originalDataTheme === null) {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", originalDataTheme);
    }
  });

  const HEIGHTS_SIGNALS: Array<{ label: string; rx: RegExp }> = [
    { label: "Manal Heights (name)", rx: RX_HEIGHTS },
    { label: "manalheights@ (email)", rx: RX_HEIGHTS_EMAIL },
    { label: "B-17 Multi Gardens (Heights address)", rx: RX_HEIGHTS_ADDR },
    { label: "BK-MH- (Heights booking id)", rx: /BK-MH-/ },
  ];
  const ARCADE_SIGNALS: Array<{ label: string; rx: RegExp }> = [
    { label: "Manal Arcade (name)", rx: RX_ARCADE },
    { label: "manalarcade@ (email)", rx: RX_ARCADE_EMAIL },
    { label: "B-1 Markaz (Arcade address)", rx: RX_ARCADE_ADDR },
    { label: "BK-MA- (Arcade booking id)", rx: /BK-MA-/ },
  ];

  // Capture per-theme outputs so we can cross-check equality at the end
  // as well as run the leak assertion inside each theme block.
  const heightsToArcadeByTheme: Record<"light" | "dark", Record<string, string>> = {
    light: {},
    dark: {},
  };
  const arcadeToHeightsByTheme: Record<"light" | "dark", Record<string, string>> = {
    light: {},
    dark: {},
  };

  describe.each(THEMES)("$name mode", ({ name, dark }) => {
    beforeEach(() => {
      applyTheme(dark);
    });

    it(`Heights→Arcade swap: no Heights signal survives on any doc under ${name} mode`, () => {
      // Sanity: the theme flag is actually applied while we render.
      expect(document.documentElement.classList.contains("dark")).toBe(dark);

      const arcadeBooking = makeBooking({
        booking_id: "BK-MA-101",
        project_name: "Manal Arcade",
      });
      const perType = DOC_TYPES.map((type) => ({
        type,
        html: renderType(type, arcadeBooking),
      }));

      for (const { type, html } of perType) {
        heightsToArcadeByTheme[name][type] = html;
        if (BODY_HAS_PROJECT_NAME.has(type)) {
          expect(html, `${type} must show Manal Arcade under ${name} mode`).toMatch(RX_ARCADE);
        } else {
          expect(html, `${type} must carry BK-MA- under ${name} mode`).toMatch(/BK-MA-/);
        }
      }

      const leaks: string[] = [];
      for (const { type, html } of perType) {
        for (const signal of HEIGHTS_SIGNALS) {
          if (signal.rx.test(html)) leaks.push(`${type}/${name}: ${signal.label}`);
        }
      }
      expect(
        leaks,
        `no Heights signal should survive Heights→Arcade under ${name} mode; leaks:\n${leaks.join("\n")}`,
      ).toEqual([]);
    });

    it(`Arcade→Heights swap: no Arcade signal survives on any doc under ${name} mode`, () => {
      expect(document.documentElement.classList.contains("dark")).toBe(dark);

      const heightsBooking = makeBooking();
      const perType = DOC_TYPES.map((type) => ({
        type,
        html: renderType(type, heightsBooking),
      }));

      for (const { type, html } of perType) {
        arcadeToHeightsByTheme[name][type] = html;
        if (BODY_HAS_PROJECT_NAME.has(type)) {
          expect(html, `${type} must show Manal Heights under ${name} mode`).toMatch(RX_HEIGHTS);
        } else {
          expect(html, `${type} must carry BK-MH- under ${name} mode`).toMatch(/BK-MH-/);
        }
      }

      const leaks: string[] = [];
      for (const { type, html } of perType) {
        for (const signal of ARCADE_SIGNALS) {
          if (signal.rx.test(html)) leaks.push(`${type}/${name}: ${signal.label}`);
        }
      }
      expect(
        leaks,
        `no Arcade signal should survive Arcade→Heights under ${name} mode; leaks:\n${leaks.join("\n")}`,
      ).toEqual([]);
    });
  });

  it("brand-signal outcome is identical between light and dark mode for both swap directions", () => {
    // Both themes must have populated their maps.
    for (const dir of [heightsToArcadeByTheme, arcadeToHeightsByTheme]) {
      expect(Object.keys(dir.light).sort()).toEqual([...DOC_TYPES].sort());
      expect(Object.keys(dir.dark).sort()).toEqual([...DOC_TYPES].sort());
    }

    // For every doc type, the presence/absence of each brand signal must
    // match across themes. We compare the boolean signal vectors rather
    // than raw HTML — theme-scoped className / data-* differences on the
    // wrapping shell would produce false positives on a raw-string
    // comparison, but must never change WHICH brand strings appear.
    const ALL_SIGNALS = [
      ...HEIGHTS_SIGNALS.map((s) => ({ ...s, brand: "heights" as const })),
      ...ARCADE_SIGNALS.map((s) => ({ ...s, brand: "arcade" as const })),
    ];
    const vectorize = (html: string) => ALL_SIGNALS.map((s) => s.rx.test(html));

    for (const dirName of ["heightsToArcade", "arcadeToHeights"] as const) {
      const src = dirName === "heightsToArcade" ? heightsToArcadeByTheme : arcadeToHeightsByTheme;
      for (const type of DOC_TYPES) {
        const light = vectorize(src.light[type]);
        const dark = vectorize(src.dark[type]);
        expect(
          dark,
          `${dirName}/${type}: brand signals must match across themes.\n` +
            `signals: ${ALL_SIGNALS.map((s) => s.label).join(", ")}\n` +
            `light:  ${light.join(",")}\n` +
            `dark :  ${dark.join(",")}`,
        ).toEqual(light);
      }
    }
  });
});

/**
 * PDF-export swap coverage.
 *
 * The live export path in `src/pages/DocumentView.tsx` rasterises the
 * document via `html2canvas` and embeds the raster into a jsPDF page,
 * so the on-disk PDF is not text-searchable. That's the wrong surface
 * to assert against — we care that the *text feeding the export* swaps
 * cleanly. This suite reproduces the export's text substrate by:
 *
 *   1. Rendering the doc via `renderDocBody` (identical to preview).
 *   2. Stripping tags to get the visible text stream.
 *   3. Building a real PDF with jsPDF (same lib the app uses) with
 *      `compress: false` so brand strings land as literal ASCII in the
 *      PDF stream and are grep-able against the raw bytes.
 *
 * We then assert every branded doc's PDF contains the expected brand
 * and NONE of the cross-brand signals — the same fleet-wide invariant
 * the on-screen swap tests enforce, extended one hop into the export
 * pipeline.
 */
describe("Documents E2E — exported PDF text swaps brands with no cross-brand leaks", () => {
  // Build an uncompressed PDF whose text stream is the stripped visible
  // text of the rendered doc. Returns the raw PDF payload as a string
  // (Latin-1 byte-for-char) so we can regex-search brand tokens.
  async function buildPdfPayload(text: string): Promise<string> {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      unit: "pt",
      format: "a4",
      // compress: false → text objects are written as literal ASCII in
      // the content stream. Compression would gzip the stream and
      // defeat the grep-based leak assertions below.
      compress: false,
    });
    // splitTextToSize wraps at page width so long booking body text
    // doesn't fall off the right margin — jsPDF still writes every
    // segment into the content stream, so the leak grep is unaffected.
    const wrapped = pdf.splitTextToSize(text, 500);
    pdf.text(wrapped, 40, 60);
    // `output()` with no args returns the PDF as a JS string of
    // Latin-1 bytes — good enough for substring search of ASCII
    // brand tokens.
    return pdf.output();
  }

  const HEIGHTS_TOKENS = [
    { label: "Manal Heights (name)", rx: RX_HEIGHTS },
    { label: "manalheights@ (email)", rx: RX_HEIGHTS_EMAIL },
    { label: "B-17 Multi Gardens (address)", rx: RX_HEIGHTS_ADDR },
    { label: "BK-MH- (booking id)", rx: /BK-MH-/ },
  ];
  const ARCADE_TOKENS = [
    { label: "Manal Arcade (name)", rx: RX_ARCADE },
    { label: "manalarcade@ (email)", rx: RX_ARCADE_EMAIL },
    { label: "B-1 Markaz (address)", rx: RX_ARCADE_ADDR },
    { label: "BK-MA- (booking id)", rx: /BK-MA-/ },
  ];

  it("Heights→Arcade: every doc's exported PDF text contains Arcade tokens and NO Heights tokens", async () => {
    const arcadeBooking = makeBooking({
      booking_id: "BK-MA-101",
      project_name: "Manal Arcade",
    });

    const leaks: string[] = [];
    for (const type of DOC_TYPES) {
      const html = renderType(type, arcadeBooking);
      const text = stripTags(html);
      const pdfBytes = await buildPdfPayload(text);

      // Positive: branded body docs must show Arcade in the PDF; ledger
      // docs (deposit-summary) at minimum carry the BK-MA- prefix.
      if (BODY_HAS_PROJECT_NAME.has(type)) {
        expect(pdfBytes, `${type} PDF must contain Manal Arcade`).toMatch(RX_ARCADE);
      } else {
        expect(pdfBytes, `${type} PDF must contain BK-MA- booking id`).toMatch(/BK-MA-/);
      }

      // Negative: no Heights token may appear anywhere in the PDF bytes.
      for (const token of HEIGHTS_TOKENS) {
        if (token.rx.test(pdfBytes)) {
          leaks.push(`${type} PDF leaked ${token.label}`);
        }
      }
    }

    expect(
      leaks,
      `no Heights token should survive into the exported PDF after Heights→Arcade swap; leaks:\n${leaks.join("\n")}`,
    ).toEqual([]);
  });

  it("Arcade→Heights: every doc's exported PDF text contains Heights tokens and NO Arcade tokens", async () => {
    const heightsBooking = makeBooking(); // BK-MH-101 / Manal Heights

    const leaks: string[] = [];
    for (const type of DOC_TYPES) {
      const html = renderType(type, heightsBooking);
      const text = stripTags(html);
      const pdfBytes = await buildPdfPayload(text);

      if (BODY_HAS_PROJECT_NAME.has(type)) {
        expect(pdfBytes, `${type} PDF must contain Manal Heights`).toMatch(RX_HEIGHTS);
      } else {
        expect(pdfBytes, `${type} PDF must contain BK-MH- booking id`).toMatch(/BK-MH-/);
      }

      for (const token of ARCADE_TOKENS) {
        if (token.rx.test(pdfBytes)) {
          leaks.push(`${type} PDF leaked ${token.label}`);
        }
      }
    }

    expect(
      leaks,
      `no Arcade token should survive into the exported PDF after Arcade→Heights swap; leaks:\n${leaks.join("\n")}`,
    ).toEqual([]);
  });

  it("baseline self-check: an intentional cross-brand mix IS detected in the PDF bytes", async () => {
    // Sanity guard so a future refactor that accidentally rewires the
    // grep can't turn the swap tests into no-ops. Build a PDF whose
    // text explicitly contains BOTH brand names and confirm both are
    // found in the payload.
    const pdfBytes = await buildPdfPayload("Manal Heights and Manal Arcade");
    expect(pdfBytes).toMatch(RX_HEIGHTS);
    expect(pdfBytes).toMatch(RX_ARCADE);
  });
});

describe("Documents E2E — manifest.json schema validator", () => {
  // A canonical, valid manifest that every negative case starts from.
  const validManifest = () => ({
    failedAt: "2026-07-14T12:00:00.000Z",
    direction: "heights-to-arcade",
    docType: "receipt",
    signal: {
      label: "Manal Heights (name)",
      pattern: "/manal\\s*heights/i",
    },
    matchPreview: "…preview…",
    renderedBytes: 4321,
    hasPrevious: false,
  });

  it("accepts a well-formed manifest", () => {
    expect(validateSwapLeakManifest(validManifest())).toEqual([]);
  });

  it("accepts null matchPreview (writer emits null when no match window)", () => {
    const m = validManifest();
    m.matchPreview = null as unknown as string;
    expect(validateSwapLeakManifest(m)).toEqual([]);
  });

  it("flags a missing required top-level field with a field-scoped path", () => {
    const m: Record<string, unknown> = validManifest();
    delete m.docType;
    const errs = validateSwapLeakManifest(m);
    expect(errs.some((e) => /required property "docType" missing/.test(e))).toBe(true);
  });

  it("flags a missing required nested field", () => {
    const m = validManifest() as Record<string, unknown>;
    (m.signal as Record<string, unknown>).pattern = undefined;
    delete (m.signal as Record<string, unknown>).pattern;
    const errs = validateSwapLeakManifest(m);
    expect(errs.some((e) => /\$\.signal: required property "pattern" missing/.test(e))).toBe(true);
  });

  it("flags an out-of-enum direction", () => {
    const m = validManifest() as Record<string, unknown>;
    m.direction = "sideways";
    const errs = validateSwapLeakManifest(m);
    expect(errs.some((e) => /\$\.direction: value "sideways" not in enum/.test(e))).toBe(true);
  });

  it("flags a non-integer renderedBytes and a negative renderedBytes", () => {
    const m1 = validManifest() as Record<string, unknown>;
    m1.renderedBytes = 12.5;
    expect(validateSwapLeakManifest(m1).some((e) => /renderedBytes/.test(e))).toBe(true);

    const m2 = validManifest() as Record<string, unknown>;
    m2.renderedBytes = -1;
    expect(validateSwapLeakManifest(m2).some((e) => /minimum 0 violated/.test(e))).toBe(true);
  });

  it("flags an ill-formed regex pattern string (must look like /.../flags)", () => {
    const m = validManifest();
    m.signal.pattern = "not a regex string";
    const errs = validateSwapLeakManifest(m);
    expect(errs.some((e) => /\$\.signal\.pattern: pattern/.test(e))).toBe(true);
  });

  it("flags an unknown top-level property (additionalProperties: false)", () => {
    const m = validManifest() as Record<string, unknown>;
    m.wat = 1;
    const errs = validateSwapLeakManifest(m);
    expect(errs.some((e) => /additional property "wat" not allowed/.test(e))).toBe(true);
  });

  it("flags a wrong hasPrevious type", () => {
    const m = validManifest() as Record<string, unknown>;
    m.hasPrevious = "yes";
    const errs = validateSwapLeakManifest(m);
    expect(errs.some((e) => /\$\.hasPrevious: expected type boolean/.test(e))).toBe(true);
  });

  it("integration: writeSwapLeakArtifact refuses to persist a manifest that fails validation", async () => {
    // Simulate a partial write by monkey-patching Date so the writer
    // emits a non-ISO string, which the schema's timestamp pattern
    // rejects. The writer's outer try/catch converts the thrown
    // validation error into a `null` return + warning — verify both
    // and that no rendered.html landed on disk (fail-fast, no partial
    // artifact bleed).
    const { existsSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const rootDir = join(tmpdir(), `docs-swap-leak-validator-${process.pid}-${Date.now()}`);

    const originalISOString = Date.prototype.toISOString;

    (Date.prototype as any).toISOString = function () {
      return "not-an-iso-timestamp";
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = writeSwapLeakArtifact({
        direction: "heights-to-arcade",
        docType: "receipt",
        signal: { label: "x", rx: /manal\s*heights/i },
        html: "<p>Manal Heights</p>",
        rootDir,
      });

      expect(result, "writer must reject an invalid manifest").toBeNull();
      const warnMsg = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(warnMsg).toMatch(/manifest\.json failed schema validation/);
      expect(warnMsg).toMatch(/\$\.failedAt/);

      // Nothing must have been written for this leak — no rendered.html,
      // no manifest.json, no diff — so a downstream CI parser can't be
      // fooled by a half-written artifact directory.
      const leafDir = join(rootDir, "heights-to-arcade", "receipt", "x");
      expect(existsSync(join(leafDir, "manifest.json"))).toBe(false);
      expect(existsSync(join(leafDir, "rendered.html"))).toBe(false);
    } finally {
      Date.prototype.toISOString = originalISOString;
      warn.mockRestore();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe("Documents E2E — swap-leak artifact writer self-check", () => {
  it("writes manifest.json, rendered.html, and rendered.txt with the correct docType/signal path and a match preview", async () => {
    const { readFileSync, statSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    // Isolate the writer under a per-run tmp dir so a broken cleanup can't
    // clobber real CI artifacts.
    const rootDir = join(tmpdir(), `docs-swap-leak-selfcheck-${process.pid}-${Date.now()}`);

    // Synthetic leak: an Arcade render that still contains "Manal Heights"
    // — exactly the shape the real fleet-wide test would flag.
    const syntheticHtml = renderToStaticMarkup(
      (
        <div>
          <h1>Sample doc</h1>
          <p>Address: Manal Heights, B-17 Multi Gardens, Islamabad</p>
        </div>
      ) as any,
    );

    const result = writeSwapLeakArtifact({
      direction: "heights-to-arcade",
      docType: "receipt",
      signal: { label: "Manal Heights (name)", rx: RX_HEIGHTS },
      html: syntheticHtml,
      rootDir,
    });

    expect(result, "writer must return a dir + files record").not.toBeNull();
    const { dir, files } = result!;

    // Path shape: <root>/<direction>/<docType>/<signal-slug>/
    expect(dir).toContain(join("heights-to-arcade", "receipt"));
    expect(dir).toMatch(/manal-heights-name/);

    for (const name of ["manifest.json", "rendered.html", "rendered.txt"]) {
      const p = join(dir, name);
      expect(files, `writer must return ${name}`).toContain(p);
      expect(statSync(p).size, `${name} must be non-empty`).toBeGreaterThan(0);
    }

    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.direction).toBe("heights-to-arcade");
    expect(manifest.docType).toBe("receipt");
    expect(manifest.signal.label).toBe("Manal Heights (name)");
    // Pattern is the regex's toString — should encode the source.
    expect(manifest.signal.pattern).toMatch(/manal/i);
    // Match preview captures the leaked substring in context.
    expect(manifest.matchPreview).toMatch(RX_HEIGHTS);

    const html = readFileSync(join(dir, "rendered.html"), "utf8");
    expect(html).toBe(syntheticHtml);
    const text = readFileSync(join(dir, "rendered.txt"), "utf8");
    expect(text).toMatch(RX_HEIGHTS);
    // Text extraction must strip tags.
    expect(text).not.toMatch(/<h1>|<p>/);

    // First run has no prior artifact, so the writer must NOT emit diff files.
    expect(result!.diff, "first run has no previous artifact — diff must be null").toBeNull();
    expect(manifest.hasPrevious).toBe(false);

    rmSync(rootDir, { recursive: true, force: true });
  });

  it("emits diff.html / diff.txt.patch / diff.html.patch that highlight what changed between the previous and next rendered artifacts", async () => {
    const { readFileSync, statSync, existsSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const rootDir = join(tmpdir(), `docs-swap-leak-diff-${process.pid}-${Date.now()}`);

    const prevHtml = renderToStaticMarkup(
      (
        <div>
          <h1>Sample doc</h1>
          <p>Owner: Alice</p>
          <p>Address: Manal Heights</p>
        </div>
      ) as any,
    );
    const nextHtml = renderToStaticMarkup(
      (
        <div>
          <h1>Sample doc</h1>
          <p>Owner: Bob</p>
          <p>Address: Manal Heights</p>
        </div>
      ) as any,
    );

    // First write establishes the "previous" run.
    const first = writeSwapLeakArtifact({
      direction: "arcade-to-heights",
      docType: "invoice",
      signal: { label: "Manal Heights (name)", rx: RX_HEIGHTS },
      html: prevHtml,
      rootDir,
    });
    expect(first, "first write must succeed").not.toBeNull();
    expect(first!.diff, "no prior run — diff must be null").toBeNull();

    // Second write for the same {direction, docType, signal} must snapshot
    // the prior rendered.* as previous.* and emit diff artifacts.
    const second = writeSwapLeakArtifact({
      direction: "arcade-to-heights",
      docType: "invoice",
      signal: { label: "Manal Heights (name)", rx: RX_HEIGHTS },
      html: nextHtml,
      rootDir,
    });
    expect(second, "second write must succeed").not.toBeNull();
    const { dir, diff } = second!;
    expect(diff, "second run must emit diff artifacts").not.toBeNull();
    expect(diff!.changed, "content changed between runs — diff.changed must be true").toBe(true);

    // previous.* must exist and match the first render exactly.
    expect(existsSync(join(dir, "previous.html"))).toBe(true);
    expect(existsSync(join(dir, "previous.txt"))).toBe(true);
    expect(readFileSync(join(dir, "previous.html"), "utf8")).toBe(prevHtml);

    // rendered.* must match the newest render.
    expect(readFileSync(join(dir, "rendered.html"), "utf8")).toBe(nextHtml);

    // Manifest reports the prior-run link.
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.hasPrevious).toBe(true);

    // Unified-diff patch files exist, are non-empty, and contain the
    // expected -Alice/+Bob transition.
    for (const name of ["diff.txt.patch", "diff.html.patch", "diff.html"]) {
      const p = join(dir, name);
      expect(statSync(p).size, `${name} must be non-empty`).toBeGreaterThan(0);
    }
    const textPatch = readFileSync(join(dir, "diff.txt.patch"), "utf8");
    expect(textPatch).toContain("--- previous/rendered.txt");
    expect(textPatch).toContain("+++ next/rendered.txt");
    // The stripped text collapses whitespace, so Alice/Bob land on the
    // single content line — both endpoints must appear in the diff body.
    expect(textPatch).toMatch(/Alice/);
    expect(textPatch).toMatch(/Bob/);

    // HTML viewer must be a standalone document with add/del rows.
    const viewer = readFileSync(join(dir, "diff.html"), "utf8");
    expect(viewer).toContain("<!doctype html>");
    expect(viewer).toContain('class="add"');
    expect(viewer).toContain('class="del"');
    expect(viewer).toContain("invoice · Manal Heights (name) · arcade-to-heights");

    // Manifest now carries unified-diff metrics for both patches.
    expect(
      manifest.diffMetrics,
      "diffMetrics must be present when a diff was emitted",
    ).toBeTruthy();
    for (const kind of ["html", "txt"] as const) {
      const m = manifest.diffMetrics[kind];
      expect(m.hunks, `${kind} hunks must be >=1`).toBeGreaterThanOrEqual(1);
      expect(m.addedLines + m.removedLines, `${kind} must record changed lines`).toBeGreaterThan(0);
      expect(m.changedChars, `${kind}.changedChars must equal added+removed`).toBe(
        m.addedChars + m.removedChars,
      );
      expect(m.changedChars).toBeGreaterThan(0);
    }
    // The text patch is a single Alice→Bob substitution on one line —
    // exactly one hunk, one added line and one removed line.
    expect(manifest.diffMetrics.txt.hunks).toBe(1);
    expect(manifest.diffMetrics.txt.addedLines).toBe(1);
    expect(manifest.diffMetrics.txt.removedLines).toBe(1);

    rmSync(rootDir, { recursive: true, force: true });
  });

  it("computeUnifiedDiff returns a no-changes marker when prev and next are identical", () => {
    const out = computeUnifiedDiff({ prev: "a\nb\nc", next: "a\nb\nc" });
    expect(out).toContain("--- previous");
    expect(out).toContain("+++ next");
    expect(out).toContain("(no changes)");
  });

  it("computeUnifiedDiff identical cases: labelled header format is stable and no @@ / +/- lines ever appear", () => {
    // Locks the wire-format contract that downstream tooling (patch
    // viewers, diff-summary.html generation, CI failure links) relies
    // on: for identical prev/next the ONLY lines in the output are
    //   1. `--- <prevLabel>`
    //   2. `+++ <nextLabel>`
    //   3. `(no changes)`
    //   4. a trailing empty line (from the terminating `\n`)
    // in exactly that order. No `@@ -a,b +c,d @@` hunk headers, and
    // no `+…` / `-…` change lines under any label shape.
    //
    // Cover a spread of label shapes so a regression can't slip
    // through by only touching one code path (defaults, explicit,
    // path-like, unicode, empty). Bodies are also varied to prove
    // the header format is body-insensitive when nothing changed.
    const cases: Array<{
      name: string;
      body: string;
      prevLabel?: string;
      nextLabel?: string;
      expectedPrev: string;
      expectedNext: string;
    }> = [
      {
        name: "defaults",
        body: "a\nb\nc",
        expectedPrev: "previous",
        expectedNext: "next",
      },
      {
        name: "path-like labels",
        body: "Header: Documents\nBody: 1",
        prevLabel: "previous/rendered.txt",
        nextLabel: "next/rendered.txt",
        expectedPrev: "previous/rendered.txt",
        expectedNext: "next/rendered.txt",
      },
      {
        name: "unicode + punctuation labels",
        body: "Signed: Zoë — 2026-07-14 ✔",
        prevLabel: "прошлое · rendered",
        nextLabel: "後 · rendered",
        expectedPrev: "прошлое · rendered",
        expectedNext: "後 · rendered",
      },
      {
        name: "empty labels",
        body: "",
        prevLabel: "",
        nextLabel: "",
        expectedPrev: "",
        expectedNext: "",
      },
      {
        name: "single-line body, defaults",
        body: "only one line",
        expectedPrev: "previous",
        expectedNext: "next",
      },
      {
        name: "trailing newline body",
        body: "a\nb\nc\n",
        prevLabel: "prev",
        nextLabel: "next",
        expectedPrev: "prev",
        expectedNext: "next",
      },
    ];

    for (const c of cases) {
      const out = computeUnifiedDiff({
        prev: c.body,
        next: c.body,
        prevLabel: c.prevLabel,
        nextLabel: c.nextLabel,
      });

      // 1. Exact labelled header format — first two lines, verbatim.
      //    Split on "\n" (unified diffs use LF, not CRLF).
      const lines = out.split("\n");
      expect(lines[0], `${c.name}: line 0`).toBe(`--- ${c.expectedPrev}`);
      expect(lines[1], `${c.name}: line 1`).toBe(`+++ ${c.expectedNext}`);
      expect(lines[2], `${c.name}: line 2`).toBe("(no changes)");
      // Trailing empty segment from the final `\n`. Anything beyond
      // that would mean an extra line snuck into the output.
      expect(lines[3], `${c.name}: line 3`).toBe("");
      expect(lines.length, `${c.name}: line count`).toBe(4);

      // 2. No hunk headers under any label shape.
      expect(out, `${c.name}: no @@`).not.toMatch(/^@@ /m);
      expect(out, `${c.name}: no @@ anywhere`).not.toContain("@@");

      // 3. No `+…` / `-…` change lines. The regex requires a single
      //    leading sign followed by a non-sign character, which
      //    correctly excludes the `---` / `+++` file-label headers.
      expect(out, `${c.name}: no add lines`).not.toMatch(/^\+[^+]/m);
      expect(out, `${c.name}: no del lines`).not.toMatch(/^-[^-]/m);
      // And there must be EXACTLY one line starting with `---` and
      // one starting with `+++` — a duplicated header would be a
      // regression that still passed the "no add/del" checks.
      const prevHdrCount = lines.filter((l) => l.startsWith("--- ")).length;
      const nextHdrCount = lines.filter((l) => l.startsWith("+++ ")).length;
      expect(prevHdrCount, `${c.name}: exactly one --- header`).toBe(1);
      expect(nextHdrCount, `${c.name}: exactly one +++ header`).toBe(1);
    }
  });

  it("self-check: identical before/after produces empty/zero-metric diff output across representative fixtures", () => {
    // Guards the "nothing changed → nothing to show" contract for the
    // diff helpers. If either metrics or the diff body ever start
    // reporting phantom edits on byte-identical inputs, the swap-leak
    // artifacts would surface false-positive regressions in CI.
    //
    // Cover a spread of representative shapes so a single lucky
    // canonicalisation (e.g. only stripping trailing newlines) can't
    // pass the check accidentally:
    const fixtures: Array<{ name: string; body: string }> = [
      { name: "single-line", body: "only one line" },
      { name: "multi-line", body: "Header\nOwner: Alice\nAmount: 100\nFooter" },
      { name: "trailing-newline", body: "a\nb\nc\n" },
      { name: "blank-lines-inside", body: "top\n\nmiddle\n\nbottom" },
      { name: "unicode + punctuation", body: "Signed: Zoë — 2026-07-14 ✔" },
      { name: "empty", body: "" },
    ];

    for (const { name, body } of fixtures) {
      const unified = computeUnifiedDiff({
        prev: body,
        next: body,
        prevLabel: "previous/rendered.txt",
        nextLabel: "next/rendered.txt",
      });

      // The labelled headers still render (viewer relies on them) but
      // the body must be the no-changes sentinel and carry no +/- lines.
      expect(unified, `${name}: headers`).toContain("--- previous/rendered.txt");
      expect(unified, `${name}: headers`).toContain("+++ next/rendered.txt");
      expect(unified, `${name}: sentinel`).toContain("(no changes)");
      // No `+…` / `-…` change lines (the `---`/`+++` headers are excluded
      // by requiring a single leading sign followed by any non-sign char).
      expect(unified, `${name}: no add lines`).not.toMatch(/^\+[^+]/m);
      expect(unified, `${name}: no del lines`).not.toMatch(/^-[^-]/m);
      // And no hunk headers at all (`@@ … @@`).
      expect(unified, `${name}: no hunks`).not.toMatch(/^@@ /m);

      // Metrics collapse to strict zeros — including the derived
      // `changedChars` field, which some regressions have historically
      // drifted out of sync with `addedChars + removedChars`.
      expect(computeUnifiedDiffMetrics(unified), `${name}: metrics`).toEqual({
        hunks: 0,
        addedLines: 0,
        removedLines: 0,
        addedChars: 0,
        removedChars: 0,
        changedChars: 0,
      });
    }
  });

  it("self-check: identical before/after routed through renderDiffHtml renders only headers + a single (no changes) sentinel", () => {
    // Companion to the previous self-check: the raw diff was empty,
    // but the VIEWER is what a CI operator actually opens from the
    // failure-log link. It must not paint stray `.add` / `.del` /
    // `.ctx` rows when nothing changed — the sentinel is the only
    // body row. Re-uses the exact same fixture spread so any drift
    // in `renderDiffHtml` classification is caught symmetrically.
    const fixtures: Array<{ name: string; body: string }> = [
      { name: "single-line", body: "only one line" },
      { name: "multi-line", body: "Header\nOwner: Alice\nAmount: 100\nFooter" },
      { name: "trailing-newline", body: "a\nb\nc\n" },
      { name: "blank-lines-inside", body: "top\n\nmiddle\n\nbottom" },
      { name: "unicode + punctuation", body: "Signed: Zoë — 2026-07-14 ✔" },
      { name: "empty", body: "" },
    ];

    // Count occurrences of a class token in the viewer body. Counts
    // `class="X"` — the exact shape `renderDiffHtml` emits — so a
    // future addition of a class like `class="add foo"` wouldn't
    // silently be missed.
    const countClass = (html: string, cls: string) =>
      (html.match(new RegExp(`class="${cls}"`, "g")) ?? []).length;

    for (const { name, body } of fixtures) {
      const unified = computeUnifiedDiff({
        prev: body,
        next: body,
        prevLabel: "previous/rendered.txt",
        nextLabel: "next/rendered.txt",
      });
      const viewer = renderDiffHtml({
        title: `self-check · identical · ${name}`,
        unifiedDiff: unified,
        prevLabel: "previous/rendered.txt",
        nextLabel: "next/rendered.txt",
      });

      // Standalone doc + title + labelled endpoints render as normal.
      expect(viewer, `${name}: doctype`).toContain("<!doctype html>");
      expect(viewer, `${name}: title`).toContain(`self-check · identical · ${name}`);

      // Exactly two header rows — one `--- previous/…`, one `+++ next/…`.
      expect(countClass(viewer, "hdr"), `${name}: hdr count`).toBe(2);
      expect(viewer, `${name}: prev header`).toContain(">--- previous/rendered.txt<");
      expect(viewer, `${name}: next header`).toContain(">+++ next/rendered.txt<");

      // Exactly one sentinel row, and it contains `(no changes)`.
      expect(countClass(viewer, "eq"), `${name}: eq count`).toBe(1);
      expect(viewer, `${name}: sentinel body`).toMatch(
        /<div class="eq"><em>\(no changes\)<\/em><\/div>/,
      );

      // No add / del rows anywhere.
      expect(countClass(viewer, "add"), `${name}: add count`).toBe(0);
      expect(countClass(viewer, "del"), `${name}: del count`).toBe(0);
      // The unified-diff body always ends with a trailing newline, so
      // `renderDiffHtml` emits exactly ONE empty `<div class="ctx">`
      // for that final split segment. That is the only ctx row
      // allowed — no non-empty context lines when nothing changed.
      const ctxBodies = Array.from(
        viewer.matchAll(/<div class="ctx">([^<]*)<\/div>/g),
        (m) => m[1],
      );
      expect(ctxBodies.length, `${name}: ctx count`).toBeLessThanOrEqual(1);
      for (const c of ctxBodies) {
        expect(c.trim(), `${name}: ctx must be empty`).toBe("");
      }
    }
  });

  it("controlled before/after pair: computeUnifiedDiff and renderDiffHtml both produce non-empty diff output for every kind of change", () => {
    // A fixed, hand-authored before/after pair covering the three edit
    // primitives a real doc render can undergo: an in-place substitution
    // (line 2), a deletion (line 4), and an insertion (new tail line).
    // Anchoring the fixture in-source — instead of relying on the
    // renderer — makes this self-check independent of doc-template
    // regressions: if this test ever fails, the diff helpers themselves
    // are broken, not the renderer.
    const before = [
      "Header: Manal Heights",
      "Owner: Alice",
      "Amount: 100",
      "Note: pending",
      "Footer: end",
    ].join("\n");
    const after = [
      "Header: Manal Heights",
      "Owner: Bob", // substitution
      "Amount: 100",
      // "Note: pending" removed
      "Footer: end",
      "Signed: 2026-07-14", // insertion
    ].join("\n");

    const unified = computeUnifiedDiff({
      prev: before,
      next: after,
      prevLabel: "previous/rendered.txt",
      nextLabel: "next/rendered.txt",
    });

    // Unified diff is non-empty, carries the labelled headers, is NOT
    // the no-change sentinel, and contains all four expected +/- lines.
    expect(unified.length).toBeGreaterThan(0);
    expect(unified).toContain("--- previous/rendered.txt");
    expect(unified).toContain("+++ next/rendered.txt");
    expect(unified).not.toContain("(no changes)");
    expect(unified).toMatch(/^-Owner: Alice$/m);
    expect(unified).toMatch(/^\+Owner: Bob$/m);
    expect(unified).toMatch(/^-Note: pending$/m);
    expect(unified).toMatch(/^\+Signed: 2026-07-14$/m);

    // Metrics agree with the hand-authored fixture: 1 substitution +
    // 1 pure delete + 1 pure insert → 2 adds, 2 removes.
    const metrics = computeUnifiedDiffMetrics(unified);
    expect(metrics.addedLines).toBe(2);
    expect(metrics.removedLines).toBe(2);
    expect(metrics.hunks).toBeGreaterThanOrEqual(1);
    expect(metrics.changedChars).toBeGreaterThan(0);

    // The HTML viewer is a standalone doc, non-empty, with add + del
    // rows AND at least one context row (proves the fixture's shared
    // lines survived into the viewer, not just the changed ones).
    const viewer = renderDiffHtml({
      title: "self-check · controlled before/after",
      unifiedDiff: unified,
      prevLabel: "previous/rendered.txt",
      nextLabel: "next/rendered.txt",
    });
    expect(viewer.length).toBeGreaterThan(unified.length);
    expect(viewer).toContain("<!doctype html>");
    expect(viewer).toContain("self-check · controlled before/after");
    expect(viewer).toContain('class="add"');
    expect(viewer).toContain('class="del"');
    expect(viewer).toContain('class="ctx"');
    expect(viewer).toContain('class="hdr"');
    // The no-changes sentinel row must NOT appear for a genuinely
    // different pair — that would signal a regression where the viewer
    // rendered a stale "identical" state.
    expect(viewer).not.toContain('class="eq"');
    // The actual endpoint tokens survive the HTML escape.
    expect(viewer).toMatch(/Owner: Bob/);
    expect(viewer).toMatch(/Signed: 2026-07-14/);
  });

  it("computeUnifiedDiffMetrics counts hunks, lines, and characters across separated change groups", () => {
    // Two separate hunks: line 1 replaced (A→X), and line 4 added.
    // Context (unchanged) lines separate them.
    const unified = computeUnifiedDiff({
      prev: "A\nB\nC",
      next: "X\nB\nC\nD",
    });
    const m = computeUnifiedDiffMetrics(unified);
    expect(m.hunks).toBe(2);
    expect(m.addedLines).toBe(2); // +X, +D
    expect(m.removedLines).toBe(1); // -A
    expect(m.addedChars).toBe(2); // "X" + "D"
    expect(m.removedChars).toBe(1); // "A"
    expect(m.changedChars).toBe(m.addedChars + m.removedChars);
  });

  it("computeUnifiedDiffMetrics returns all-zero counts on a no-changes diff", () => {
    const unified = computeUnifiedDiff({ prev: "same\nlines", next: "same\nlines" });
    expect(computeUnifiedDiffMetrics(unified)).toEqual({
      hunks: 0,
      addedLines: 0,
      removedLines: 0,
      addedChars: 0,
      removedChars: 0,
      changedChars: 0,
    });
  });

  it("capForStorage passes short bodies through unchanged", () => {
    const out = capForStorage("hello world", 1024, "txt");
    expect(out).toEqual({
      stored: "hello world",
      originalBytes: 11,
      storedBytes: 11,
      truncated: false,
    });
  });

  it("capForStorage truncates long bodies and appends a size-cap marker (txt)", () => {
    const body = "x".repeat(5000);
    const out = capForStorage(body, 200, "txt");
    expect(out.truncated).toBe(true);
    expect(out.originalBytes).toBe(5000);
    expect(out.storedBytes).toBeLessThanOrEqual(200);
    expect(out.stored).toMatch(/\[truncated: kept \d+ of 5000 bytes for CI artifact size cap\]/);
    // Nothing from the marker's own text leaks into the kept prefix.
    expect(out.stored.startsWith("x")).toBe(true);
  });

  it("capForStorage uses HTML comment syntax for html artifacts", () => {
    const body = "<p>" + "y".repeat(5000) + "</p>";
    const out = capForStorage(body, 300, "html");
    expect(out.truncated).toBe(true);
    expect(out.stored).toMatch(
      /<!-- \[truncated: kept \d+ of \d+ bytes for CI artifact size cap\] -->/,
    );
  });

  it("capForStorage treats cap <= 0 as disabled (no truncation)", () => {
    const body = "z".repeat(100);
    for (const cap of [0, -1, undefined]) {
      const out = capForStorage(body, cap, "txt");
      expect(out.truncated).toBe(false);
      expect(out.stored).toBe(body);
    }
  });

  it("writeSwapLeakArtifact caps rendered.html and rendered.txt to maxStoredBytes and records storage metadata", async () => {
    const { readFileSync, statSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const rootDir = join(tmpdir(), `docs-swap-leak-cap-${process.pid}-${Date.now()}`);

    // Build a rendered doc that's clearly larger than our cap.
    const big = "<div>" + "A".repeat(5000) + "Manal Heights" + "B".repeat(5000) + "</div>";
    const cap = 512;

    const result = writeSwapLeakArtifact({
      direction: "heights-to-arcade",
      docType: "invoice",
      signal: { label: "Manal Heights (name)", rx: RX_HEIGHTS },
      html: big,
      rootDir,
      maxStoredBytes: cap,
    });
    expect(result, "cap run must succeed").not.toBeNull();
    const dir = result!.dir;

    // On-disk files respect the cap.
    const htmlOnDisk = readFileSync(join(dir, "rendered.html"), "utf8");
    const txtOnDisk = readFileSync(join(dir, "rendered.txt"), "utf8");
    expect(statSync(join(dir, "rendered.html")).size).toBeLessThanOrEqual(cap);
    expect(statSync(join(dir, "rendered.txt")).size).toBeLessThanOrEqual(cap);
    expect(htmlOnDisk).toMatch(
      /<!-- \[truncated: kept \d+ of \d+ bytes for CI artifact size cap\] -->/,
    );
    expect(txtOnDisk).toMatch(/\[truncated: kept \d+ of \d+ bytes for CI artifact size cap\]/);

    // Manifest carries storage metadata for both artifacts.
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.storage.html.truncated).toBe(true);
    expect(manifest.storage.txt.truncated).toBe(true);
    expect(manifest.storage.html.storedBytes).toBeLessThanOrEqual(cap);
    expect(manifest.storage.txt.storedBytes).toBeLessThanOrEqual(cap);
    expect(manifest.storage.html.originalBytes).toBe(big.length);
    // `renderedBytes` still reflects the ORIGINAL body length so
    // post-mortem tools see the true render size, not the capped one.
    expect(manifest.renderedBytes).toBe(big.length);

    rmSync(rootDir, { recursive: true, force: true });
  });

  it("writeSwapLeakArtifact records storage.truncated=false when body fits under the cap", async () => {
    const { readFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const rootDir = join(tmpdir(), `docs-swap-leak-nocap-${process.pid}-${Date.now()}`);

    const small = "<div>Manal Heights — small doc</div>";
    const result = writeSwapLeakArtifact({
      direction: "heights-to-arcade",
      docType: "invoice",
      signal: { label: "Manal Heights (name)", rx: RX_HEIGHTS },
      html: small,
      rootDir,
      maxStoredBytes: 1024,
    });
    expect(result).not.toBeNull();

    const manifest = JSON.parse(readFileSync(join(result!.dir, "manifest.json"), "utf8"));
    expect(manifest.storage.html.truncated).toBe(false);
    expect(manifest.storage.txt.truncated).toBe(false);
    expect(manifest.storage.html.storedBytes).toBe(manifest.storage.html.originalBytes);

    rmSync(rootDir, { recursive: true, force: true });
  });

  it("self-check: symmetrically truncated prev/next still yield correct add/del/context rows in renderDiffHtml", () => {
    // Simulates the CI-artifact size-cap path: both the previous and
    // next rendered bodies are clipped by `capForStorage` before being
    // diffed. The clip must be symmetric — same cap, same kind — so
    // the diff viewer sees like-for-like bodies and the real edits
    // survive as add/del rows alongside preserved context.
    //
    // Real edits live at the TOP of each fixture so they always land
    // inside the kept prefix; the shared filler that gets clipped is
    // at the tail (mirrors how a leaked brand token typically shows up
    // near the top of a rendered doc's header).
    const filler = Array.from(
      { length: 200 },
      (_, i) => `filler-line-${i.toString().padStart(3, "0")}`,
    ).join("\n");
    const prevText = [
      "Header: Manal Heights",
      "Owner: Alice",
      "Amount: 100",
      "Note: pending",
      "Footer: end",
      filler,
    ].join("\n");
    const nextText = [
      "Header: Manal Heights",
      "Owner: Bob", // substitution
      "Amount: 100",
      // "Note: pending" removed
      "Signed: 2026-07-14", // insertion
      "Footer: end",
      filler,
    ].join("\n");
    // Cap well below both bodies but comfortably above the header
    // block, so the real edits survive and only the filler tail is
    // clipped.
    const cap = 400;

    const cappedPrev = capForStorage(prevText, cap, "txt");
    const cappedNext = capForStorage(nextText, cap, "txt");

    // Symmetric clipping: both flagged truncated, both under the same
    // cap. Individual `storedBytes` may differ because bodies have
    // different lengths (the marker records each side's true original
    // size) — the invariant is the CAP, not the stored length.
    expect(cappedPrev.truncated).toBe(true);
    expect(cappedNext.truncated).toBe(true);
    expect(cappedPrev.storedBytes).toBeLessThanOrEqual(cap);
    expect(cappedNext.storedBytes).toBeLessThanOrEqual(cap);
    // The truncation marker appears in identical shape on both sides.
    const MARKER_RX = /\[truncated: kept \d+ of \d+ bytes for CI artifact size cap\]/;
    expect(cappedPrev.stored).toMatch(MARKER_RX);
    expect(cappedNext.stored).toMatch(MARKER_RX);

    const unified = computeUnifiedDiff({
      prev: cappedPrev.stored,
      next: cappedNext.stored,
      prevLabel: "previous/rendered.txt",
      nextLabel: "next/rendered.txt",
    });
    expect(unified).not.toContain("(no changes)");
    // The real edits — landing before the cap — survive verbatim.
    expect(unified).toMatch(/^-Owner: Alice$/m);
    expect(unified).toMatch(/^\+Owner: Bob$/m);
    expect(unified).toMatch(/^-Note: pending$/m);
    expect(unified).toMatch(/^\+Signed: 2026-07-14$/m);

    const viewer = renderDiffHtml({
      title: "self-check · symmetric truncation",
      unifiedDiff: unified,
      prevLabel: "previous/rendered.txt",
      nextLabel: "next/rendered.txt",
    });
    // Add, del, context, and header rows are all present — the diff
    // still renders correctly after symmetric truncation.
    expect(viewer).toContain('class="add"');
    expect(viewer).toContain('class="del"');
    expect(viewer).toContain('class="ctx"');
    expect(viewer).toContain('class="hdr"');
    // Endpoint tokens for each real edit survive HTML escaping.
    expect(viewer).toMatch(/Owner: Bob/);
    expect(viewer).toMatch(/Signed: 2026-07-14/);
    // And the no-changes sentinel row must NOT appear.
    expect(viewer).not.toContain('class="eq"');

    // Metrics agree with the fixture: 2 adds (Bob, Signed) + 2 removes
    // (Alice, Note) from the surviving header block.
    const m = computeUnifiedDiffMetrics(unified);
    expect(m.addedLines).toBeGreaterThanOrEqual(2);
    expect(m.removedLines).toBeGreaterThanOrEqual(2);
    expect(m.changedChars).toBe(m.addedChars + m.removedChars);
  });

  it("self-check: two identical writeSwapLeakArtifact runs produce all-zero diffMetrics with no hunk metadata on disk", async () => {
    // Guards the end-to-end "nothing changed → nothing to diff" contract
    // as it appears in the on-disk manifest, not just in memory. If the
    // writer ever starts synthesising phantom hunks (e.g. because of
    // asymmetric cap handling, whitespace normalisation drift, or a
    // regression in `computeUnifiedDiffMetrics`), CI would surface a
    // false-positive leak the next run — this catches it up-front.
    const { readFileSync, existsSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const rootDir = join(tmpdir(), `docs-swap-leak-identity-${process.pid}-${Date.now()}`);

    const html =
      "<html><body>" +
      "<h1>Manal Heights</h1>" +
      "<p>Invoice #1042 — Amount: PKR 500,000</p>" +
      "<footer>Generated 2026-07-14</footer>" +
      "</body></html>";

    // First run seeds `rendered.html` / `rendered.txt`. There's no
    // previous artifact yet, so no diff/metrics get written.
    const first = writeSwapLeakArtifact({
      direction: "heights-to-arcade",
      docType: "invoice",
      signal: { label: "Manal Heights (name)", rx: RX_HEIGHTS },
      html,
      rootDir,
    });
    expect(first, "first run must write successfully").not.toBeNull();
    expect(first!.diff, "first run has no previous → no diff").toBeNull();
    const firstManifest = JSON.parse(readFileSync(join(first!.dir, "manifest.json"), "utf8"));
    expect(firstManifest.hasPrevious).toBe(false);
    expect(firstManifest.diffMetrics, "no diffMetrics on first run").toBeUndefined();

    // Second run writes the SAME html into the same slot. The writer
    // rotates rendered.* → previous.* and re-diffs; because prev and
    // next are byte-identical, both diff bodies must collapse to the
    // no-changes sentinel and all metrics must be strict zeros.
    const second = writeSwapLeakArtifact({
      direction: "heights-to-arcade",
      docType: "invoice",
      signal: { label: "Manal Heights (name)", rx: RX_HEIGHTS },
      html,
      rootDir,
    });
    expect(second, "second run must write successfully").not.toBeNull();
    expect(second!.dir, "second run reuses the same signal slot").toBe(first!.dir);
    expect(second!.diff, "diff bundle emitted alongside identical bodies").not.toBeNull();
    // `.diff.changed` is the fast-path summary CI reads to decide
    // whether to flag a leak — it MUST be false for identical inputs.
    expect(second!.diff!.changed, "identical bodies → diff.changed=false").toBe(false);

    const manifest = JSON.parse(readFileSync(join(second!.dir, "manifest.json"), "utf8"));
    expect(manifest.hasPrevious).toBe(true);

    // Strict all-zero counts on BOTH the html and txt sub-manifests.
    // `.toEqual` (not `.toMatchObject`) guarantees no stray extra fields
    // like a stubbed `hunks: undefined` slip through.
    const ZERO = {
      hunks: 0,
      addedLines: 0,
      removedLines: 0,
      addedChars: 0,
      removedChars: 0,
      changedChars: 0,
    };
    expect(manifest.diffMetrics).toBeDefined();
    expect(manifest.diffMetrics.html).toEqual(ZERO);
    expect(manifest.diffMetrics.txt).toEqual(ZERO);

    // On-disk patch files carry the sentinel and NO unified-diff hunk
    // markers (`@@ -a,b +c,d @@`) — that's the "no hunk metadata"
    // half of the contract, verified at the artifact layer where
    // post-mortem tools actually look.
    const htmlPatch = readFileSync(join(second!.dir, "diff.html.patch"), "utf8");
    const txtPatch = readFileSync(join(second!.dir, "diff.txt.patch"), "utf8");
    for (const [name, patch] of [
      ["diff.html.patch", htmlPatch],
      ["diff.txt.patch", txtPatch],
    ] as const) {
      expect(patch, `${name}: sentinel`).toContain("(no changes)");
      expect(patch, `${name}: no hunk header`).not.toMatch(/^@@ /m);
      // No `+…` / `-…` change lines either (only the file-label
      // headers `---`/`+++` are allowed, and those are excluded by
      // requiring a single leading sign followed by a non-sign char).
      expect(patch, `${name}: no add lines`).not.toMatch(/^\+[^+]/m);
      expect(patch, `${name}: no del lines`).not.toMatch(/^-[^-]/m);
    }

    // And the rendered viewer that ships alongside the patches also
    // reflects the no-change state — no add/del rows anywhere.
    const viewer = readFileSync(join(second!.dir, "diff.html"), "utf8");
    expect(viewer).toContain('class="eq"');
    expect(viewer).not.toContain('class="add"');
    expect(viewer).not.toContain('class="del"');

    // Sanity: previous.* is on disk from the rotation (proves the
    // second run really did diff prev-vs-next, not next-vs-empty).
    expect(existsSync(join(second!.dir, "previous.html"))).toBe(true);
    expect(existsSync(join(second!.dir, "previous.txt"))).toBe(true);

    rmSync(rootDir, { recursive: true, force: true });
  });

  it("self-check: truncated identical bodies still report (no changes) and all-zero diffMetrics", async () => {
    // Combines the two hardest cases: identical prev/next AND
    // `maxStoredBytes` clipping. Because `writeSwapLeakArtifact` caps
    // both the incoming body AND the rehydrated `previous.*` snapshot
    // with the same cap+kind up-front, the stored bodies stay
    // byte-identical even when both are truncated — so the diff must
    // still collapse to `(no changes)` and metrics stay strict zeros.
    // If the cap ever drifts (e.g. truncation marker embeds a per-run
    // timestamp, or `originalBytes` differs between calls) the marker
    // itself would show up as a phantom edit here.
    const { readFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const rootDir = join(tmpdir(), `docs-swap-leak-trunc-identity-${process.pid}-${Date.now()}`);

    // Body clearly larger than the cap so truncation is guaranteed on
    // both html and txt sides.
    const html =
      "<html><body><h1>Manal Heights</h1>" +
      "<p>" +
      "A".repeat(4000) +
      "</p>" +
      "<p>" +
      "B".repeat(4000) +
      "</p>" +
      "<footer>Generated 2026-07-14</footer></body></html>";
    const cap = 512;

    // First run seeds the artifacts with the cap applied.
    const first = writeSwapLeakArtifact({
      direction: "heights-to-arcade",
      docType: "invoice",
      signal: { label: "Manal Heights (name)", rx: RX_HEIGHTS },
      html,
      rootDir,
      maxStoredBytes: cap,
    });
    expect(first, "first run must write").not.toBeNull();
    expect(first!.diff, "first run has no previous → no diff").toBeNull();
    const firstManifest = JSON.parse(readFileSync(join(first!.dir, "manifest.json"), "utf8"));
    expect(firstManifest.storage.html.truncated, "first html truncated").toBe(true);
    expect(firstManifest.storage.txt.truncated, "first txt truncated").toBe(true);

    // Second run writes the SAME html with the SAME cap.
    const second = writeSwapLeakArtifact({
      direction: "heights-to-arcade",
      docType: "invoice",
      signal: { label: "Manal Heights (name)", rx: RX_HEIGHTS },
      html,
      rootDir,
      maxStoredBytes: cap,
    });
    expect(second, "second run must write").not.toBeNull();
    expect(second!.dir).toBe(first!.dir);
    expect(second!.diff, "diff bundle emitted").not.toBeNull();
    expect(second!.diff!.changed, "identical truncated bodies → diff.changed=false").toBe(false);

    const manifest = JSON.parse(readFileSync(join(second!.dir, "manifest.json"), "utf8"));
    expect(manifest.hasPrevious).toBe(true);
    // Truncation flags on both sides — proves the cap really did fire
    // (otherwise this test would silently degrade to the un-capped case).
    expect(manifest.storage.html.truncated, "second html truncated").toBe(true);
    expect(manifest.storage.txt.truncated, "second txt truncated").toBe(true);
    // And the stored size stays under the cap on both sides.
    expect(manifest.storage.html.storedBytes).toBeLessThanOrEqual(cap);
    expect(manifest.storage.txt.storedBytes).toBeLessThanOrEqual(cap);

    // Strict all-zero diffMetrics for both html and txt.
    const ZERO = {
      hunks: 0,
      addedLines: 0,
      removedLines: 0,
      addedChars: 0,
      removedChars: 0,
      changedChars: 0,
    };
    expect(manifest.diffMetrics).toBeDefined();
    expect(manifest.diffMetrics.html).toEqual(ZERO);
    expect(manifest.diffMetrics.txt).toEqual(ZERO);

    // On-disk `.patch` files carry the sentinel and no hunk metadata —
    // the truncation marker (which appears verbatim in BOTH prev and
    // next bodies) must not surface as a diff line.
    const htmlPatch = readFileSync(join(second!.dir, "diff.html.patch"), "utf8");
    const txtPatch = readFileSync(join(second!.dir, "diff.txt.patch"), "utf8");
    for (const [name, patch] of [
      ["diff.html.patch", htmlPatch],
      ["diff.txt.patch", txtPatch],
    ] as const) {
      expect(patch, `${name}: sentinel`).toContain("(no changes)");
      expect(patch, `${name}: no hunk header`).not.toMatch(/^@@ /m);
      expect(patch, `${name}: no add lines`).not.toMatch(/^\+[^+]/m);
      expect(patch, `${name}: no del lines`).not.toMatch(/^-[^-]/m);
      // And specifically no `+`/`-` line carrying the truncation marker.
      expect(patch, `${name}: marker never a diff line`).not.toMatch(/^[+-]\[truncated: kept /m);
    }

    // And the viewer that ships to the CI operator matches — the
    // sentinel is present, no add/del rows.
    const viewer = readFileSync(join(second!.dir, "diff.html"), "utf8");
    expect(viewer).toContain('class="eq"');
    expect(viewer).toContain("(no changes)");
    expect(viewer).not.toContain('class="add"');
    expect(viewer).not.toContain('class="del"');

    rmSync(rootDir, { recursive: true, force: true });
  });
});

/**
 * Unit tests for the "Show details" disclosure inside the URL-sanitizer banner.
 *
 * These tests pin two behaviors:
 *   1. Expand/collapse mechanics — the button toggles, the panel mounts only
 *      when open, and aria-expanded / aria-label stay in sync with state.
 *   2. Screen-reader friendliness — the expanded list is aria-hidden (so AT
 *      users hear the sibling sr-only list, not the visible one twice), a
 *      polite live region announces the change, and the toggle has a clear
 *      accessible name that includes the change count.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Hoisted mock for the clipboard helper — must be set before the component
// import so the module factory captures `copyMock` at module load.
const { copyMock } = vi.hoisted(() => ({ copyMock: vi.fn<(text: string) => Promise<boolean>>() }));
vi.mock("@/lib/shareLink", () => ({
  tryCopyToClipboard: (text: string) => copyMock(text),
}));

import { UrlSanitizerDisclosure, type ResetChange } from "@/components/UrlSanitizerDisclosure";

const LABELS: Record<string, string> = {
  risk: "Risk Level",
  kpi: "KPI Card",
  kexp: "Expanded KPI Row",
};

const CHANGES: ResetChange[] = [
  { key: "risk", from: "BANANA", to: "removed" },
  { key: "kpi", from: "ghost", to: "overdue" },
  { key: "kexp", from: "-1", to: "1" },
];

function renderDisclosure(changes: ResetChange[] = CHANGES) {
  return render(<UrlSanitizerDisclosure changes={changes} paramLabels={LABELS} />);
}

describe("UrlSanitizerDisclosure — expand/collapse mechanics", () => {
  beforeEach(() => {
    // requestAnimationFrame in jsdom defers; flush it synchronously so the
    // focus-management effect can run inside the same `await user...` tick.
    if (!("requestAnimationFrame" in window)) {
      // @ts-expect-error jsdom polyfill
      window.requestAnimationFrame = (cb: FrameRequestCallback) =>
        setTimeout(() => cb(performance.now()), 0) as unknown as number;
      // @ts-expect-error jsdom polyfill
      window.cancelAnimationFrame = (id: number) => clearTimeout(id);
    }
  });

  it("starts collapsed: panel is not rendered, toggle says 'Show details (N)'", () => {
    renderDisclosure();
    const toggle = screen.getByRole("button", { name: /show details for|hide details for/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Show details (3)");
    expect(screen.queryByRole("list", { hidden: true })).not.toBeInTheDocument();
  });

  it("expands on click and mounts the panel with one <li> per change", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    await user.click(screen.getByRole("button", { name: /show details for|hide details for/i }));

    const toggle = screen.getByRole("button", { name: /show details for|hide details for/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Hide details");

    // aria-hidden panels need { hidden: true } to be discoverable by RTL.
    const panel = document.getElementById("url-sanitizer-details-panel")!;
    expect(panel).toBeInTheDocument();
    const items = within(panel).getAllByRole("listitem", { hidden: true });
    expect(items).toHaveLength(3);
  });

  it("collapses again on a second click and removes the panel", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    const toggle = screen.getByRole("button", { name: /show details for|hide details for/i });
    await user.click(toggle);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("url-sanitizer-details-panel")).toBeNull();
  });

  it("toggles via keyboard (Enter and Space)", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    const toggle = screen.getByRole("button", { name: /show details for|hide details for/i });
    toggle.focus();

    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps focus on the toggle button after open and after close", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    const toggle = screen.getByRole("button", { name: /show details for|hide details for/i });
    await user.click(toggle);
    // raf-deferred focus restoration — flush microtasks
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(toggle);

    await user.click(toggle);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(toggle);
  });

  it("singular wording when there is exactly one change", () => {
    renderDisclosure([{ key: "risk", from: "BAD", to: "removed" }]);
    const toggle = screen.getByRole("button", { name: /show details for|hide details for/i });
    expect(toggle).toHaveTextContent("Show details (1)");
    expect(toggle).toHaveAttribute("aria-label", "Show details for 1 invalid parameter");
  });

  it("plural wording for >1 changes", () => {
    renderDisclosure();
    expect(
      screen.getByRole("button", { name: /show details for|hide details for/i }),
    ).toHaveAttribute("aria-label", "Show details for 3 invalid parameters");
  });
});

describe("UrlSanitizerDisclosure — screen-reader contract", () => {
  it("expanded panel is aria-hidden so AT does not double-read the visible list", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    await user.click(screen.getByRole("button", { name: /show details for|hide details for/i }));
    const panel = document.getElementById("url-sanitizer-details-panel")!;
    expect(panel).toHaveAttribute("aria-hidden", "true");
  });

  it("renders a polite role=status live region for disclosure announcements", () => {
    renderDisclosure();
    const live = screen.getByTestId("url-sanitizer-details-live");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveAttribute("aria-atomic", "true");
    expect(live).toHaveClass("sr-only");
    expect(live).toHaveTextContent(""); // silent before any toggle
  });

  it("announces 'expanded. Showing N changes.' when opened", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    await user.click(screen.getByRole("button", { name: /show details for|hide details for/i }));
    expect(screen.getByTestId("url-sanitizer-details-live")).toHaveTextContent(
      "Invalid parameter details expanded. Showing 3 changes.",
    );
  });

  it("announces singular 'Showing 1 change.' for one change", async () => {
    const user = userEvent.setup();
    renderDisclosure([{ key: "risk", from: "BAD", to: "removed" }]);
    await user.click(screen.getByRole("button", { name: /show details for|hide details for/i }));
    expect(screen.getByTestId("url-sanitizer-details-live")).toHaveTextContent(
      "Invalid parameter details expanded. Showing 1 change.",
    );
  });

  it("announces 'collapsed.' when closed again", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    const toggle = screen.getByRole("button", { name: /show details for|hide details for/i });
    await user.click(toggle);
    await user.click(toggle);
    expect(screen.getByTestId("url-sanitizer-details-live")).toHaveTextContent(
      "Invalid parameter details collapsed.",
    );
  });

  it("aria-controls points at the panel id and updates aria-expanded in sync", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    const toggle = screen.getByRole("button", { name: /show details for|hide details for/i });
    expect(toggle).toHaveAttribute("aria-controls", "url-sanitizer-details-panel");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("url-sanitizer-details-panel")).not.toBeNull();
  });

  it("trigger has a stable id and the panel references it via aria-labelledby", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    const toggle = screen.getByRole("button", { name: /show details for|hide details for/i });
    expect(toggle).toHaveAttribute("id", "url-sanitizer-details-toggle");
    await user.click(toggle);
    const panel = document.getElementById("url-sanitizer-details-panel")!;
    expect(panel).toHaveAttribute("aria-labelledby", "url-sanitizer-details-toggle");
    expect(panel).toHaveAttribute("role", "group");
  });

  it("aria-expanded is always present (never omitted) so AT reads a state", () => {
    renderDisclosure();
    const toggle = screen.getByRole("button", { name: /show details for|hide details for/i });
    // Must be the literal string "false" — not missing — when collapsed.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders 'removed' badge for dropped params and '→ \"value\"' for replaced ones", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    await user.click(screen.getByRole("button", { name: /show details for|hide details for/i }));
    const panel = document.getElementById("url-sanitizer-details-panel")!;
    // Removed param: badge text is the literal "removed"
    expect(within(panel).getByText("removed")).toBeInTheDocument();
    // Replaced param: shows the new value in quotes
    expect(within(panel).getByText('"overdue"')).toBeInTheDocument();
    expect(within(panel).getByText('"1"')).toBeInTheDocument();
  });

  it("uses friendly labels from paramLabels for each row", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    await user.click(screen.getByRole("button", { name: /show details for|hide details for/i }));
    const panel = document.getElementById("url-sanitizer-details-panel")!;
    expect(within(panel).getByText("(Risk Level)")).toBeInTheDocument();
    expect(within(panel).getByText("(KPI Card)")).toBeInTheDocument();
    expect(within(panel).getByText("(Expanded KPI Row)")).toBeInTheDocument();
  });

  it("falls back to the raw key when no label is supplied", async () => {
    const user = userEvent.setup();
    render(
      <UrlSanitizerDisclosure
        changes={[{ key: "mystery", from: "x", to: "removed" }]}
        paramLabels={{}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /show details for|hide details for/i }));
    const panel = document.getElementById("url-sanitizer-details-panel")!;
    expect(within(panel).getByText("(mystery)")).toBeInTheDocument();
  });

  it("renders '(missing)' for changes with an empty `from`", async () => {
    const user = userEvent.setup();
    renderDisclosure([{ key: "kpi", from: "", to: "overdue" }]);
    await user.click(screen.getByRole("button", { name: /show details for|hide details for/i }));
    expect(screen.getByText("(missing)")).toBeInTheDocument();
  });
});

describe("UrlSanitizerDisclosure — export breakdown (JSON / CSV)", () => {
  let createObjectURL: typeof URL.createObjectURL;
  let revokeObjectURL: typeof URL.revokeObjectURL;
  const captured: { blob: Blob | null; filename: string; mime: string }[] = [];

  beforeEach(() => {
    captured.length = 0;
    createObjectURL = URL.createObjectURL;
    revokeObjectURL = URL.revokeObjectURL;
    // jsdom has no real Blob URL implementation — stub it and capture the blob.
    URL.createObjectURL = ((blob: Blob) => {
      captured.push({ blob, filename: "", mime: blob.type });
      return "blob:mock";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    // Intercept the synthetic anchor click so jsdom does not try to navigate.
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLElement;
      if (tag.toLowerCase() === "a") {
        (el as HTMLAnchorElement).click = function () {
          if (captured.length)
            captured[captured.length - 1].filename = (this as HTMLAnchorElement).download;
        };
      }
      return el;
    });
  });

  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.restoreAllMocks();
  });

  async function readBlob(blob: Blob): Promise<string> {
    // jsdom Blob has .text() in recent versions; fall back to FileReader.
    if (typeof (blob as any).text === "function") return await (blob as any).text();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsText(blob);
    });
  }

  it("renders JSON and CSV export buttons with accessible labels", () => {
    renderDisclosure();
    const json = screen.getByTestId("url-sanitizer-export-json");
    const csv = screen.getByTestId("url-sanitizer-export-csv");
    expect(json).toHaveAttribute("aria-label", "Download 3 invalid parameters as JSON");
    expect(csv).toHaveAttribute("aria-label", "Download 3 invalid parameters as CSV");
  });

  it("JSON export contains key, label, original value, and outcome for every change", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    await user.click(screen.getByTestId("url-sanitizer-export-json"));
    expect(captured).toHaveLength(1);
    expect(captured[0].filename).toBe("url-sanitizer-breakdown.json");
    expect(captured[0].mime).toBe("application/json");
    const parsed = JSON.parse(await readBlob(captured[0].blob!));
    expect(parsed.count).toBe(3);
    expect(parsed.changes).toEqual([
      { key: "risk", label: "Risk Level", original: "BANANA", outcome: "removed", replacement: "" },
      {
        key: "kpi",
        label: "KPI Card",
        original: "ghost",
        outcome: "replaced",
        replacement: "overdue",
      },
      {
        key: "kexp",
        label: "Expanded KPI Row",
        original: "-1",
        outcome: "replaced",
        replacement: "1",
      },
    ]);
    expect(typeof parsed.exportedAt).toBe("string");
  });

  it("CSV export has the expected header row and one row per change with quoting", async () => {
    const user = userEvent.setup();
    renderDisclosure([
      { key: "risk", from: 'BAD,"VAL"', to: "removed" },
      { key: "kpi", from: "ghost", to: "overdue" },
    ]);
    await user.click(screen.getByTestId("url-sanitizer-export-csv"));
    expect(captured).toHaveLength(1);
    expect(captured[0].filename).toBe("url-sanitizer-breakdown.csv");
    expect(captured[0].mime).toBe("text/csv;charset=utf-8");
    const text = await readBlob(captured[0].blob!);
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toBe("key,label,original,outcome,replacement");
    // Comma + quote in the original value must be CSV-escaped.
    expect(lines[1]).toBe('risk,Risk Level,"BAD,""VAL""",removed,');
    expect(lines[2]).toBe("kpi,KPI Card,ghost,replaced,overdue");
  });

  it("export buttons are disabled when there are zero changes", () => {
    renderDisclosure([]);
    expect(screen.getByTestId("url-sanitizer-export-json")).toBeDisabled();
    expect(screen.getByTestId("url-sanitizer-export-csv")).toBeDisabled();
  });
});

describe("UrlSanitizerDisclosure — XLSX export", () => {
  let createObjectURL: typeof URL.createObjectURL;
  let revokeObjectURL: typeof URL.revokeObjectURL;
  const captured: { blob: Blob | null; filename: string; mime: string }[] = [];

  beforeEach(() => {
    captured.length = 0;
    createObjectURL = URL.createObjectURL;
    revokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      captured.push({ blob, filename: "", mime: blob.type });
      return "blob:mock";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLElement;
      if (tag.toLowerCase() === "a") {
        (el as HTMLAnchorElement).click = function () {
          if (captured.length)
            captured[captured.length - 1].filename = (this as HTMLAnchorElement).download;
        };
      }
      return el;
    });
  });

  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.restoreAllMocks();
  });

  async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    if (typeof (blob as any).arrayBuffer === "function") return await (blob as any).arrayBuffer();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.readAsArrayBuffer(blob);
    });
  }

  it("renders the XLSX export button with accessible label", () => {
    renderDisclosure();
    const btn = screen.getByTestId("url-sanitizer-export-xlsx");
    expect(btn).toHaveAttribute("aria-label", "Download 3 invalid parameters as Excel workbook");
    expect(btn).toHaveTextContent("XLSX");
    expect(btn).not.toBeDisabled();
  });

  it("is disabled when there are zero changes", () => {
    renderDisclosure([]);
    expect(screen.getByTestId("url-sanitizer-export-xlsx")).toBeDisabled();
  });

  it("downloads url-sanitizer-breakdown.xlsx with the spreadsheetml MIME type", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    await user.click(screen.getByTestId("url-sanitizer-export-xlsx"));
    await waitFor(() => expect(captured).toHaveLength(1));

    expect(captured).toHaveLength(1);
    expect(captured[0].filename).toBe("url-sanitizer-breakdown.xlsx");
    expect(captured[0].mime).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(captured[0].blob!.size).toBeGreaterThan(0);
  });

  it("workbook contains an 'Invalid params' sheet with the expected header and one row per change", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    await user.click(screen.getByTestId("url-sanitizer-export-xlsx"));
    await waitFor(() => expect(captured).toHaveLength(1));

    const XLSX = await import("xlsx");
    const buf = await blobToArrayBuffer(captured[0].blob!);
    const wb = XLSX.read(buf, { type: "array" });
    expect(wb.SheetNames).toEqual(["Invalid params"]);

    const ws = wb.Sheets["Invalid params"];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false });
    expect(aoa[0]).toEqual(["key", "label", "original", "outcome", "replacement"]);
    expect(aoa).toHaveLength(4); // header + 3 changes
    expect(aoa[1]).toEqual(["risk", "Risk Level", "BANANA", "removed", ""]);
    expect(aoa[2]).toEqual(["kpi", "KPI Card", "ghost", "replaced", "overdue"]);
    expect(aoa[3]).toEqual(["kexp", "Expanded KPI Row", "-1", "replaced", "1"]);
  });

  it("preserves embedded commas and quotes in cell values losslessly", async () => {
    const user = userEvent.setup();
    renderDisclosure([
      { key: "risk", from: 'BAD,"VAL"', to: "removed" },
      { key: "kpi", from: "ghost\nly", to: "overdue" },
    ]);
    await user.click(screen.getByTestId("url-sanitizer-export-xlsx"));
    await waitFor(() => expect(captured).toHaveLength(1));

    const XLSX = await import("xlsx");
    const buf = await blobToArrayBuffer(captured[0].blob!);
    const wb = XLSX.read(buf, { type: "array" });
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Invalid params"], {
      header: 1,
      blankrows: false,
    });
    expect(aoa[1][2]).toBe('BAD,"VAL"');
    expect(aoa[2][2]).toBe("ghost\nly");
  });
});

describe("UrlSanitizerDisclosure — Copy JSON button", () => {
  beforeEach(() => {
    copyMock.mockReset();
  });

  it("renders a Copy JSON button with accessible label and Copy icon", () => {
    renderDisclosure();
    const btn = screen.getByTestId("url-sanitizer-copy-json");
    expect(btn).toHaveAttribute("aria-label", "Copy 3 invalid parameters as JSON to clipboard");
    expect(btn).toHaveTextContent("Copy JSON");
    expect(btn).not.toBeDisabled();
  });

  it("is disabled when there are zero changes", () => {
    renderDisclosure([]);
    expect(screen.getByTestId("url-sanitizer-copy-json")).toBeDisabled();
  });

  it("on success: writes JSON payload (count, changes, exportedAt) to clipboard", async () => {
    copyMock.mockResolvedValue(true);
    const user = userEvent.setup();
    renderDisclosure();
    await user.click(screen.getByTestId("url-sanitizer-copy-json"));

    expect(copyMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(copyMock.mock.calls[0][0]);
    expect(payload.count).toBe(3);
    expect(typeof payload.exportedAt).toBe("string");
    expect(payload.changes).toEqual([
      { key: "risk", label: "Risk Level", original: "BANANA", outcome: "removed", replacement: "" },
      {
        key: "kpi",
        label: "KPI Card",
        original: "ghost",
        outcome: "replaced",
        replacement: "overdue",
      },
      {
        key: "kexp",
        label: "Expanded KPI Row",
        original: "-1",
        outcome: "replaced",
        replacement: "1",
      },
    ]);
  });

  it("on success: flips to 'Copied' with check icon and announces, then reverts after 1.5s", async () => {
    copyMock.mockResolvedValue(true);
    // Use fake timers so the 1.5s revert state update can be flushed inside
    // act(...), avoiding a React act() warning from a late setTimeout firing.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderDisclosure();
      const btn = screen.getByTestId("url-sanitizer-copy-json");
      await user.click(btn);

      expect(btn).toHaveTextContent("Copied");
      expect(btn.querySelector("svg.lucide-check")).not.toBeNull();
      expect(screen.getByTestId("url-sanitizer-details-live")).toHaveTextContent(
        "Copied 3 changes as JSON to clipboard.",
      );

      // Flush the 1.5s revert timer inside act() so the state update is tracked.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1700);
      });
      expect(btn).toHaveTextContent("Copy JSON");
      expect(btn.querySelector("svg.lucide-copy")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  }, 7000);

  it("announces singular 'change' when there is exactly one change", async () => {
    copyMock.mockResolvedValue(true);
    const user = userEvent.setup();
    renderDisclosure([{ key: "risk", from: "BAD", to: "removed" }]);
    await user.click(screen.getByTestId("url-sanitizer-copy-json"));
    expect(screen.getByTestId("url-sanitizer-details-live")).toHaveTextContent(
      "Copied 1 change as JSON to clipboard.",
    );
  });

  it("on failure: announces failure, does not flip to 'Copied'", async () => {
    copyMock.mockResolvedValue(false);
    const user = userEvent.setup();
    renderDisclosure();
    const btn = screen.getByTestId("url-sanitizer-copy-json");
    await user.click(btn);

    expect(btn).toHaveTextContent("Copy JSON");
    expect(btn).not.toHaveTextContent("Copied");
    expect(screen.getByTestId("url-sanitizer-details-live")).toHaveTextContent(
      "Copy to clipboard failed.",
    );
  });
});

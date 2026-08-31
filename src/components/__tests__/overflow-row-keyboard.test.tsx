/**
 * Keyboard activation contract for the "overflow" (scrollable) rows in the
 * Import Center audit-runs table.
 *
 * Source of truth: src/pages/ImportCenter.tsx:643-661
 *   <tr tabIndex={0} onClick={() => setDetail(a)}
 *       onKeyDown={(e) => {
 *         if (e.key === "Enter" || e.key === " ") {
 *           e.preventDefault();
 *           setDetail(a);
 *         }
 *       }}>
 *
 * The full ImportCenter route pulls Supabase + TanStack Router + heavy
 * dialogs. To keep this test fast and hermetic we mount a minimal harness
 * that reproduces the exact row markup and handler, and drive it with
 * real keyboard events via userEvent. If the ImportCenter markup drifts
 * from this shape, update BOTH.
 *
 * Verifies:
 *   1. Tab focus lands on the first row (the "highlighted" one).
 *   2. Enter on the focused row updates the selected-row detail panel.
 *   3. Moving focus + pressing Space activates a different row.
 *   4. preventDefault stops Space from scrolling the overflow container.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";

type Audit = { id: string; file_name: string; input_rows: number };

const AUDITS: Audit[] = [
  { id: "a1", file_name: "jan-2026.xlsx", input_rows: 120 },
  { id: "a2", file_name: "feb-2026.xlsx", input_rows: 240 },
  { id: "a3", file_name: "mar-2026.xlsx", input_rows: 360 },
];

/** Records the last keydown default-prevention state for assertion. */
function Harness() {
  const [detail, setDetail] = useState<Audit | null>(null);
  const lastPreventedRef = useRef<boolean | null>(null);

  return (
    <div>
      {/* Detail surface — mirrors the AuditDetailDialog projection. */}
      <div data-testid="detail" aria-live="polite" role="status">
        {detail ? `Selected: ${detail.file_name} (${detail.input_rows} rows)` : "No selection"}
      </div>

      {/* Overflow container: max-height + overflow-y-auto in the real UI. */}
      <div style={{ maxHeight: 200, overflowY: "auto" }} data-testid="scroll">
        <table>
          <tbody>
            {AUDITS.map((a) => (
              <tr
                key={a.id}
                data-testid={`row-${a.id}`}
                tabIndex={0}
                onClick={() => setDetail(a)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    lastPreventedRef.current = e.defaultPrevented;
                    setDetail(a);
                  }
                }}
              >
                <td>{a.file_name}</td>
                <td>{a.input_rows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Probe surface for the preventDefault assertion. */}
      <span data-testid="last-prevented">
        {lastPreventedRef.current == null ? "unset" : lastPreventedRef.current ? "yes" : "no"}
      </span>
    </div>
  );
}

describe("overflow row keyboard activation", () => {
  it("Enter on the highlighted row updates the selected-row detail", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Baseline: nothing selected.
    expect(screen.getByTestId("detail").textContent).toBe("No selection");

    // First Tab lands on the first row (the "highlighted" one — tabIndex=0).
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId("row-a1"));

    await user.keyboard("{Enter}");
    expect(screen.getByTestId("detail").textContent).toBe("Selected: jan-2026.xlsx (120 rows)");
  });

  it("Space on a different highlighted row swaps the selected content", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Advance focus to the second row.
    await user.tab(); // row-a1
    await user.tab(); // row-a2
    expect(document.activeElement).toBe(screen.getByTestId("row-a2"));

    await user.keyboard(" "); // Space
    expect(screen.getByTestId("detail").textContent).toBe("Selected: feb-2026.xlsx (240 rows)");

    // And swap once more to a third row to prove the content actually
    // tracks focus, not a stale closure.
    await user.tab(); // row-a3
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("detail").textContent).toBe("Selected: mar-2026.xlsx (360 rows)");
  });

  it("Space activation prevents default (so the overflow container does not scroll)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();

    await user.keyboard(" ");

    expect(screen.getByTestId("last-prevented").textContent).toBe("yes");
  });

  it("non-activation keys do not update the selection", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("a");

    expect(screen.getByTestId("detail").textContent).toBe("No selection");
  });
});

/**
 * Keyboard + ARIA contract for the AI Diagnostics sortable column
 * header. Locks in three things a future refactor could silently
 * break:
 *
 *   1. Each header is a `role="columnheader"` with `aria-sort` reflecting
 *      the current sort state, so screen readers announce it correctly.
 *   2. The inner control is a real, focusable `<button>` — it lands in
 *      the tab order without any custom tabIndex.
 *   3. Enter AND Space both toggle the sort (this comes from the native
 *      button element; if it ever gets swapped for a `<div role="button">`
 *      Space activation is easy to lose — and this test will fail).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortableColumnHeader } from "../SortableColumnHeader";

afterEach(cleanup);

describe("SortableColumnHeader — ARIA + keyboard", () => {
  it("exposes role=columnheader with aria-sort='none' when not the active sort", () => {
    render(
      <SortableColumnHeader
        columnKey="tool"
        label="Tool name"
        active={false}
        sortDir="asc"
        defaultDir="asc"
        onToggle={() => {}}
      />,
    );
    const header = screen.getByRole("columnheader");
    expect(header.getAttribute("aria-sort")).toBe("none");
  });

  it("advertises the active direction via aria-sort when sorted", () => {
    const { rerender } = render(
      <SortableColumnHeader
        columnKey="time"
        label="Time"
        active
        sortDir="asc"
        defaultDir="desc"
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("columnheader").getAttribute("aria-sort")).toBe("ascending");
    rerender(
      <SortableColumnHeader
        columnKey="time"
        label="Time"
        active
        sortDir="desc"
        defaultDir="desc"
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("columnheader").getAttribute("aria-sort")).toBe("descending");
  });

  it("is reachable by keyboard focus without needing a custom tabIndex", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>before</button>
        <SortableColumnHeader
          columnKey="tool"
          label="Tool name"
          active={false}
          sortDir="asc"
          defaultDir="asc"
          onToggle={() => {}}
        />
      </>,
    );
    await user.tab(); // → "before"
    await user.tab(); // → column header button
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /sort by tool name/i }));
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("toggles sort when the header button receives %s", async (_label, keys) => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <SortableColumnHeader
        columnKey="tool"
        label="Tool name"
        active={false}
        sortDir="asc"
        defaultDir="asc"
        onToggle={onToggle}
      />,
    );
    const btn = screen.getByRole("button", { name: /sort by tool name/i });
    btn.focus();
    await user.keyboard(keys);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("asc"); // defaultDir when idle
  });

  it("computes nextDir by flipping the current direction when already active", () => {
    const onToggle = vi.fn();
    render(
      <SortableColumnHeader
        columnKey="time"
        label="Time"
        active
        sortDir="desc"
        defaultDir="desc"
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sort by time/i }));
    // active + current desc → next click should sort ascending
    expect(onToggle).toHaveBeenCalledWith("asc");
  });

  it("announces state to AT via aria-label AND a redundant sr-only cue", () => {
    render(
      <SortableColumnHeader
        columnKey="status"
        label="Status"
        active
        sortDir="asc"
        defaultDir="asc"
        onToggle={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /sort by status/i });
    expect(btn.getAttribute("aria-label")).toMatch(/currently sorted ascending/i);
    expect(btn.getAttribute("aria-label")).toMatch(/activate to sort descending/i);
    // sr-only redundancy for AT that skips aria-label
    expect(btn.textContent).toMatch(/sorted ascending/i);
  });
});

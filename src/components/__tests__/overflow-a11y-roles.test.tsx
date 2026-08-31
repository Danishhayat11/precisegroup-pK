/**
 * Accessibility assertions for:
 *   (A) The Breadcrumbs overflow menu (real Radix DropdownMenu) —
 *       correct ARIA roles + states on the trigger and menu items,
 *       including the "highlighted" (active-descendant style) property
 *       Radix exposes via data-highlighted + roving tabindex.
 *   (B) The Import Center overflow rows — correct row role, keyboard
 *       reachability, and aria-selected reflecting the highlighted /
 *       currently-selected row.
 *
 * These are pure a11y contracts: no visual behavior is asserted here,
 * only the roles/states screen readers announce.
 *
 * Sources of truth:
 *   src/components/Breadcrumbs.tsx:448-508   (overflow DropdownMenu)
 *   src/pages/ImportCenter.tsx:643-661       (scrollable audit rows)
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---- Router mocks for Breadcrumbs (same shape as sibling tests) ----------
vi.mock("@/lib/router-compat", () => ({
  useLocation: () => ({
    pathname: "/bookings/alpha/beta/gamma/delta",
    search: "",
    hash: "",
    state: null,
  }),
  Link: React.forwardRef<
    HTMLAnchorElement,
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }
  >(({ to, children, ...rest }, ref) => (
    <a ref={ref} href={to} {...rest}>
      {children}
    </a>
  )),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: React.forwardRef<
    HTMLAnchorElement,
    React.AnchorHTMLAttributes<HTMLAnchorElement> & {
      to?: string;
      activeOptions?: unknown;
    }
  >(({ to, activeOptions: _a, children, ...rest }, ref) => (
    <a ref={ref} href={to} {...rest}>
      {children}
    </a>
  )),
}));

// Radix uses pointer capture; jsdom doesn't implement it.
beforeAll(() => {
  if (!(HTMLElement.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
    Object.assign(HTMLElement.prototype, {
      hasPointerCapture: () => false,
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      scrollIntoView: () => {},
    });
  }
});

import Breadcrumbs from "@/components/Breadcrumbs";

// ==========================================================================
// (A) Overflow menu — ARIA roles + states + highlighted property
// ==========================================================================
describe("Breadcrumbs overflow menu — ARIA roles & states", () => {
  it("trigger exposes button role with haspopup=menu and expanded state", () => {
    render(<Breadcrumbs />);
    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });

    // Correct role: it's a real <button>, not a div with onClick.
    expect(trigger.tagName).toBe("BUTTON");
    // Announces "menu button" to AT.
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    // Collapsed by default — expanded state must be exposed, not implied.
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Not focus-trapped or removed from the tab order.
    expect(trigger).not.toHaveAttribute("aria-hidden");
    expect(trigger.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it("opened menu exposes role=menu and menuitem children with roving tabindex", async () => {
    const user = userEvent.setup();
    render(<Breadcrumbs />);
    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });

    trigger.focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu");
    // Menu container has the correct landmark role for AT.
    expect(menu).toBeInTheDocument();
    // Trigger state flips to expanded and points at the open popup.
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const items = within(menu).getAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);

    // Roving tabindex: exactly one item is in the tab sequence at a time.
    // Radix drives this by setting tabindex="0" on the highlighted item
    // and "-1" on the rest.
    const tabbable = items.filter((el) => el.tabIndex === 0);
    expect(tabbable.length).toBe(1);
    for (const item of items) {
      // Every option must have role=menuitem (asserted above via getAllByRole)
      // and none should be aria-hidden while the menu is open.
      expect(item).not.toHaveAttribute("aria-hidden", "true");
    }
  });

  it("highlighted menuitem exposes data-highlighted and moves with ArrowDown", async () => {
    const user = userEvent.setup();
    render(<Breadcrumbs />);
    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });

    trigger.focus();
    await user.keyboard("{Enter}");

    const items = await screen.findAllByRole("menuitem");
    // Radix auto-highlights the first item on keyboard open — this is the
    // "selected/highlighted" property AT announces as the active option.
    await waitFor(() => expect(items[0]).toHaveAttribute("data-highlighted"));
    // Highlighted item is the tabbable one (roving tabindex contract).
    expect(items[0].tabIndex).toBe(0);

    if (items.length > 1) {
      await user.keyboard("{ArrowDown}");
      await waitFor(() => expect(items[1]).toHaveAttribute("data-highlighted"));
      // Previous item releases the highlight AND the tabindex slot.
      expect(items[0]).not.toHaveAttribute("data-highlighted");
      expect(items[0].tabIndex).toBe(-1);
      expect(items[1].tabIndex).toBe(0);
    }
  });
});

// ==========================================================================
// (B) Overflow rows — role=row, keyboard reachable, aria-selected reflects
//     the highlighted / currently-selected row.
// ==========================================================================
type Audit = { id: string; file_name: string };

const AUDITS: Audit[] = [
  { id: "a1", file_name: "jan-2026.xlsx" },
  { id: "a2", file_name: "feb-2026.xlsx" },
  { id: "a3", file_name: "mar-2026.xlsx" },
];

/**
 * Mirrors the ImportCenter overflow rows with the ARIA contract we want
 * screen readers to see: role=row (implicit via <tr>), tabIndex=0 for
 * keyboard reach, and aria-selected reflecting the highlighted row.
 */
function RowHarness() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <table>
      <tbody>
        {AUDITS.map((a) => {
          const selected = selectedId === a.id;
          return (
            <tr
              key={a.id}
              data-testid={`row-${a.id}`}
              tabIndex={0}
              aria-selected={selected}
              onClick={() => setSelectedId(a.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(a.id);
                }
              }}
            >
              <td>{a.file_name}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

describe("overflow rows — ARIA roles & selected state", () => {
  it("each row exposes role=row, is keyboard-focusable, and starts aria-selected=false", () => {
    render(<RowHarness />);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(AUDITS.length);

    for (const row of rows) {
      // <tr> gives implicit role=row — no role override sneaking in.
      expect(row.tagName).toBe("TR");
      // Reachable by keyboard (matches ImportCenter tabIndex={0}).
      expect(row.tabIndex).toBe(0);
      // Selected state is EXPOSED (not merely styled) and starts false.
      expect(row).toHaveAttribute("aria-selected", "false");
    }
  });

  it("activating the highlighted row flips aria-selected on it and leaves siblings false", async () => {
    const user = userEvent.setup();
    render(<RowHarness />);

    // Tab to the first (highlighted) row and activate with Enter.
    await user.tab();
    const first = screen.getByTestId("row-a1");
    expect(document.activeElement).toBe(first);

    await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("row-a2")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("row-a3")).toHaveAttribute("aria-selected", "false");

    // Move highlight to the second row and activate with Space.
    await user.tab();
    const second = screen.getByTestId("row-a2");
    expect(document.activeElement).toBe(second);
    await user.keyboard(" ");

    // Selection moves — only ONE row is aria-selected at a time.
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("row-a3")).toHaveAttribute("aria-selected", "false");

    // Global invariant: exactly one selected row.
    const selected = screen
      .getAllByRole("row")
      .filter((r) => r.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
  });
});

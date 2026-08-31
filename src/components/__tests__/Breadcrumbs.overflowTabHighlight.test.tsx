/**
 * Keyboard focus + highlight test for the Breadcrumbs OVERFLOW dropdown.
 *
 * This complements Breadcrumbs.tabOrder.test.tsx (which asserts the outer
 * Tab / Shift+Tab order through the whole breadcrumb trail) by focusing
 * on the OPEN overflow menu:
 *
 *   1. Tab lands on the ellipsis trigger from the preceding crumb;
 *      Shift+Tab moves back to that crumb without skipping.
 *   2. When the menu is open, Radix uses ARROW KEYS to move highlight
 *      between rows (Tab intentionally closes the menu — the standard
 *      WAI-ARIA menu contract, verified in Breadcrumbs.tabOrder). We
 *      assert ArrowDown / ArrowUp move `data-highlighted` correctly
 *      and — critically — that the ACCENT DESIGN TOKENS
 *      (`bg-accent`, `text-accent-foreground`) update in lockstep with
 *      the highlight. This is what the user sees as the highlighted
 *      row and what the code contract at Breadcrumbs.tsx:485-489
 *      promises via `data-[highlighted]:bg-accent
 *      data-[highlighted]:text-accent-foreground`.
 *
 * Target: src/components/Breadcrumbs.tsx:448-508
 */
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

/**
 * Row is "visually accented" iff:
 *   (a) it declares the accent design tokens as `data-[highlighted]:`
 *       variant classes (Breadcrumbs.tsx:485-489), AND
 *   (b) the `data-highlighted` attribute is currently present, which is
 *       what activates those variant classes via CSS.
 * Both together = the row IS painted with the accent tokens right now.
 */
function hasAccentTokens(el: HTMLElement): boolean {
  const hasVariantClasses =
    el.classList.contains("data-[highlighted]:bg-accent") &&
    el.classList.contains("data-[highlighted]:text-accent-foreground");
  const isActivated = el.hasAttribute("data-highlighted");
  return hasVariantClasses && isActivated;
}

describe("Breadcrumbs overflow — Tab/Shift+Tab focus + highlight/accent updates", () => {
  it("Tab reaches the trigger; Shift+Tab returns to the previous crumb without skipping", async () => {
    const user = userEvent.setup();
    render(
      <div>
        {/* Sentinel BEFORE the breadcrumbs so Shift+Tab from the first
            breadcrumb link has somewhere well-defined to land. */}
        <button data-testid="sentinel-before">before</button>
        <Breadcrumbs />
        <button data-testid="sentinel-after">after</button>
      </div>,
    );

    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });

    // Tab forward from the preceding crumb: it must land ON the trigger.
    // Reach the previous control by putting focus on the trigger first,
    // then Shift+Tab once — the element we land on is the "previous
    // control", i.e. the crumb immediately before the ellipsis.
    trigger.focus();
    await user.tab({ shift: true });
    const previousControl = document.activeElement as HTMLElement;
    expect(previousControl).not.toBe(trigger);
    expect(previousControl.tagName).toBe("A"); // a crumb link, not skipped

    // Now Tab forward: focus MUST advance back onto the trigger — not
    // skip over it to the next crumb.
    await user.tab();
    expect(document.activeElement).toBe(trigger);

    // And Tab once more advances PAST the trigger to the next crumb link
    // (or the after-sentinel), never trapping focus on the trigger.
    await user.tab();
    expect(document.activeElement).not.toBe(trigger);
    expect(document.activeElement).not.toBe(previousControl);
  });

  it("Arrow keys move data-highlighted AND swap the accent tokens between rows", async () => {
    const user = userEvent.setup();
    render(<Breadcrumbs />);

    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });
    trigger.focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    // Need at least two rows to prove "highlight moves between them".
    expect(items.length).toBeGreaterThanOrEqual(2);

    // --- Initial state: Radix auto-highlights row 0 on keyboard open. ----
    await waitFor(() => expect(items[0]).toHaveAttribute("data-highlighted"));

    // The highlighted row wears the accent tokens; the others do not.
    // (bg-accent / text-accent-foreground are the design-system tokens
    // wired via data-[highlighted]: in Breadcrumbs.tsx:485-489.)
    await waitFor(() => expect(hasAccentTokens(items[0])).toBe(true));
    for (let i = 1; i < items.length; i++) {
      expect(items[i]).not.toHaveAttribute("data-highlighted");
      expect(hasAccentTokens(items[i])).toBe(false);
    }

    // --- ArrowDown: highlight + accent move from row 0 to row 1. ---------
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(items[1]).toHaveAttribute("data-highlighted"));
    expect(items[0]).not.toHaveAttribute("data-highlighted");
    // Accent tokens follow the highlight — this is the whole point of
    // data-[highlighted]:bg-accent.
    expect(hasAccentTokens(items[1])).toBe(true);
    expect(hasAccentTokens(items[0])).toBe(false);

    // Global invariant: exactly ONE row is accented at any time.
    expect(items.filter(hasAccentTokens)).toHaveLength(1);

    // --- ArrowUp: highlight + accent snap back to row 0. -----------------
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(items[0]).toHaveAttribute("data-highlighted"));
    expect(items[1]).not.toHaveAttribute("data-highlighted");
    expect(hasAccentTokens(items[0])).toBe(true);
    expect(hasAccentTokens(items[1])).toBe(false);
    expect(items.filter(hasAccentTokens)).toHaveLength(1);
  });
});

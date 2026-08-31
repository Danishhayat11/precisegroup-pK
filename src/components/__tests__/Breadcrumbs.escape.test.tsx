/**
 * Keyboard test: Escape closes the Breadcrumbs overflow menu from the
 * highlighted state and restores focus + UI state.
 *
 * Target: src/components/Breadcrumbs.tsx:448-508
 *   The collapsed-ancestors DropdownMenu (Radix) that appears between
 *   the Home crumb and the last two visible crumbs when the trail is
 *   long enough to require an ellipsis.
 *
 * Unlike Breadcrumbs.aria.test.tsx (which mocks the DropdownMenu to
 * inert primitives to assert ARIA labels deterministically), this test
 * uses the REAL Radix DropdownMenu so we exercise Radix's actual Escape
 * handler, focus-return-to-trigger contract, and open/closed state
 * transitions. Router bits are still mocked to avoid booting the app.
 *
 * Assertions:
 *   1. Trigger renders collapsed (aria-expanded="false"), menu not in DOM.
 *   2. Enter on the focused trigger opens the menu (aria-expanded="true"),
 *      Radix auto-highlights the first item (data-highlighted).
 *   3. ArrowDown moves the highlight to the next item (proves we ARE in
 *      the "highlighted state" the test brief calls out).
 *   4. Escape from that highlighted state closes the menu.
 *   5. Focus returns to the trigger (Radix contract).
 *   6. Trigger's aria-expanded flips back to "false".
 */
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Router mocks — same shape as Breadcrumbs.aria.test.tsx ---------------
vi.mock("@/lib/router-compat", () => ({
  useLocation: () => ({
    // Deep pathname → forces the overflow: 1 visible + ellipsis + last 2.
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

// Radix's DropdownMenu uses pointer capture; jsdom doesn't implement it.
// Stub the missing APIs so the trigger doesn't throw on interaction.
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

describe("Breadcrumbs overflow menu — Escape from highlighted state", () => {
  it("Escape closes the menu, returns focus to the trigger, and clears aria-expanded", async () => {
    const user = userEvent.setup();
    render(<Breadcrumbs />);

    // (1) Trigger is present and collapsed.
    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // (2) Focus + Enter opens the menu (Radix keyboard-activation path).
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Radix auto-highlights the first menuitem on keyboard open.
    const items = await screen.findAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);
    await waitFor(() => expect(items[0]).toHaveAttribute("data-highlighted"));

    // (3) Move highlight to prove we're driving from the "highlighted state".
    if (items.length > 1) {
      await user.keyboard("{ArrowDown}");
      await waitFor(() => expect(items[1]).toHaveAttribute("data-highlighted"));
      // Previously-highlighted item is no longer highlighted.
      expect(items[0]).not.toHaveAttribute("data-highlighted");
    }

    // (4) Escape from the highlighted state closes the menu.
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    // (5) Focus returns to the trigger (Radix contract, important for
    //     keyboard users so they don't get stranded at document.body).
    expect(document.activeElement).toBe(trigger);

    // (6) aria-expanded flips back to "false" — the visible UI-state signal
    //     that assistive tech reads to know the popup is dismissed.
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

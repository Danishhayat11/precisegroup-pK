/**
 * Keyboard activation: Enter on the AUTO-HIGHLIGHTED first overflow
 * dropdown item navigates to that item's target, and the corresponding
 * breadcrumb is selected as the current page.
 *
 * Distinct from Breadcrumbs.overflowClick.test.tsx (which uses mouse
 * click) — this one exercises the pure keyboard path:
 *   Focus trigger → Enter (opens menu, Radix auto-highlights row 0) →
 *   Enter again → navigate to row 0's target.
 *
 * Target: src/components/Breadcrumbs.tsx:448-508
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Module-level pathname so we can simulate the post-navigation render.
let currentPathname = "/bookings/alpha/beta/gamma/delta";
const linkClickSpy = vi.fn<(to: string) => void>();

// Anchors intentionally omit `href` — see Breadcrumbs.overflowClick.test.tsx
// for the reason (preventDefault would make Radix skip its close-on-select).
vi.mock("@/lib/router-compat", () => ({
  useLocation: () => ({
    pathname: currentPathname,
    search: "",
    hash: "",
    state: null,
  }),
  Link: React.forwardRef<
    HTMLAnchorElement,
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }
  >(({ to, children, onClick, ...rest }, ref) => (
    <a
      ref={ref}
      data-to={to}
      onClick={(e) => {
        if (to) linkClickSpy(to);
        onClick?.(e);
      }}
      {...rest}
    >
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
  >(({ to, activeOptions: _a, children, onClick, ...rest }, ref) => (
    <a
      ref={ref}
      data-to={to}
      onClick={(e) => {
        if (to) linkClickSpy(to);
        onClick?.(e);
      }}
      {...rest}
    >
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

beforeEach(() => {
  linkClickSpy.mockClear();
  currentPathname = "/bookings/alpha/beta/gamma/delta";
});

import Breadcrumbs from "@/components/Breadcrumbs";

describe("Breadcrumbs overflow — Enter on auto-highlighted first item", () => {
  it("navigates to the first item's target and selects the destination breadcrumb", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Breadcrumbs />);

    // Focus the ellipsis trigger and open the menu with Enter.
    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });
    trigger.focus();
    await user.keyboard("{Enter}");

    // Radix auto-highlights the FIRST menuitem on keyboard open — no arrows.
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);
    await waitFor(() => expect(items[0]).toHaveAttribute("data-highlighted"));

    // Capture the auto-highlighted item's destination + label BEFORE activating.
    const firstItem = items[0];
    const anchor =
      firstItem.tagName === "A"
        ? (firstItem as HTMLAnchorElement)
        : (firstItem.querySelector("a") as HTMLAnchorElement | null);
    expect(anchor).not.toBeNull();
    const expectedHref = anchor!.getAttribute("data-to")!;
    const expectedLabel = (anchor!.textContent ?? "").trim();
    expect(expectedHref).toMatch(/^\//);
    expect(expectedLabel.length).toBeGreaterThan(0);
    // Sanity: the auto-highlighted item is NOT the current page — that would
    // make "destination becomes current" a tautology. Radix highlights first
    // enabled item, and the collapsed ancestors are by construction not the
    // current path.
    expect(anchor!.getAttribute("aria-current")).not.toBe("page");

    // --- The action under test: Enter on the auto-highlighted item. -----
    await user.keyboard("{Enter}");

    // Navigation fires exactly once, with the expected target.
    expect(linkClickSpy).toHaveBeenCalledTimes(1);
    expect(linkClickSpy).toHaveBeenCalledWith(expectedHref);

    // Menu closes (Radix contract on select).
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    // Simulate the router settling on the new pathname and re-render.
    // The destination crumb is rendered as <span aria-current="page">
    // (current crumb is not a link), so query by attribute.
    currentPathname = expectedHref;
    rerender(<Breadcrumbs />);

    const nav = screen.getByRole("navigation", { name: /breadcrumb/i });
    const currentCrumbs = Array.from(nav.querySelectorAll('[aria-current="page"]'));

    // Exactly one crumb is selected AND its label matches the item we activated.
    expect(currentCrumbs).toHaveLength(1);
    expect((currentCrumbs[0].textContent ?? "").trim()).toBe(expectedLabel);
  });
});

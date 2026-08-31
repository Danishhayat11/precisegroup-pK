/**
 * Click activation on the HIGHLIGHTED overflow row.
 *
 * Verifies (against the real Radix DropdownMenu):
 *   1. Clicking the currently-highlighted menuitem dispatches a Link
 *      navigation whose target `to` matches that item's href.
 *   2. The overflow menu closes (removed from the DOM).
 *   3. After navigation completes (simulated by updating the mocked
 *      pathname + re-render), the destination crumb is marked as the
 *      selected/current crumb via `aria-current="page"`.
 *
 * Target: src/components/Breadcrumbs.tsx:448-508
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Module-level pathname so tests can simulate navigation between renders.
let currentPathname = "/bookings/alpha/beta/gamma/delta";
const linkClickSpy = vi.fn<(to: string) => void>();

// NOTE: the anchor mocks intentionally OMIT `href`. If we set `href` and
// then called `preventDefault()` inside `onClick`, Radix would read
// `event.defaultPrevented` on the item click and REFUSE to close the menu
// — that would make the "menu closes on click" assertion below flaky and
// wrong. Reading `data-to` instead lets us verify the navigation target
// without triggering jsdom's "navigation not implemented" warning.
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

describe("Breadcrumbs overflow — click on highlighted row navigates and closes", () => {
  it("navigates to the highlighted row's href, closes the menu, and selects the destination crumb", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Breadcrumbs />);

    // Open the overflow menu via keyboard so Radix auto-highlights item[0].
    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });
    trigger.focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);
    await waitFor(() => expect(items[0]).toHaveAttribute("data-highlighted"));

    // Pick the highlighted item and read its href (the anchor inside — Radix
    // renders DropdownMenuItem asChild, so the <a> is either the item itself
    // or its descendant depending on Radix internals).
    const highlighted = items[0];
    const anchor =
      highlighted.tagName === "A"
        ? (highlighted as HTMLAnchorElement)
        : (highlighted.querySelector("a") as HTMLAnchorElement | null);
    expect(anchor).not.toBeNull();
    const targetHref = anchor!.getAttribute("data-to")!;
    const targetLabel = (anchor!.textContent ?? "").trim();
    expect(targetHref).toMatch(/^\//); // sanity: a real app path
    expect(targetLabel.length).toBeGreaterThan(0);

    // (1) Click the highlighted row — this is the action under test.
    await user.click(highlighted);

    // Link navigation fires with exactly the highlighted row's href.
    expect(linkClickSpy).toHaveBeenCalledTimes(1);
    expect(linkClickSpy).toHaveBeenCalledWith(targetHref);

    // (2) Menu closes.
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // (3) Simulate the resulting navigation: update the mocked pathname to
    //     the clicked href and re-render. The destination crumb should now
    //     be the SELECTED crumb (aria-current="page"). Breadcrumbs renders
    //     the current crumb as a <span aria-current="page">, not a link,
    //     so query by attribute rather than role.
    currentPathname = targetHref;
    rerender(<Breadcrumbs />);

    const nav = screen.getByRole("navigation", { name: /breadcrumb/i });
    const currentCrumbs = Array.from(nav.querySelectorAll('[aria-current="page"]'));

    // Exactly one crumb is marked current, and its label matches the row
    // we clicked (the crumb IS the destination, so its label must equal
    // the overflow row's label).
    expect(currentCrumbs).toHaveLength(1);
    expect((currentCrumbs[0].textContent ?? "").trim()).toBe(targetLabel);
  });
});

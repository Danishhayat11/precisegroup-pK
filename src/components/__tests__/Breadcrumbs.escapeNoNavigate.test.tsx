/**
 * Keyboard test: Escape on a HIGHLIGHTED overflow menuitem closes the
 * Breadcrumbs overflow dropdown WITHOUT navigating, and the visible
 * breadcrumb trail is unchanged.
 *
 * Distinct from Breadcrumbs.escape.test.tsx, which asserts the trigger
 * focus-return / aria-expanded contract. This test asserts:
 *   - No navigation happens (Link onClick spy never fires, window.location
 *     stays put, and Radix's onSelect does not run on Escape).
 *   - The rendered crumb trail before and after Escape is byte-identical.
 *
 * Target: src/components/Breadcrumbs.tsx:448-508 (collapsed-ancestors menu).
 */
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const INITIAL_PATH = "/bookings/alpha/beta/gamma/delta";

// Router mocks: capture Link clicks so we can prove no navigation occurred.
const linkClickSpy = vi.fn();

vi.mock("@/lib/router-compat", () => ({
  useLocation: () => ({
    pathname: INITIAL_PATH,
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
      href={to}
      onClick={(e) => {
        // Prevent jsdom "not implemented: navigation" noise AND record the click.
        e.preventDefault();
        linkClickSpy(to);
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
      href={to}
      onClick={(e) => {
        e.preventDefault();
        linkClickSpy(to);
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  )),
}));

// Radix pointer-capture stubs (jsdom).
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

/** Snapshot of the visible breadcrumb trail (labels + hrefs), menu excluded. */
function snapshotTrail(): Array<{ label: string; href: string | null }> {
  const nav = screen.getByRole("navigation", { name: /breadcrumb/i });
  // Only anchors that are NOT inside the open Radix menu portal.
  return within(nav)
    .getAllByRole("link")
    .map((a) => ({
      label: (a.textContent ?? "").trim(),
      href: a.getAttribute("href"),
    }));
}

describe("Breadcrumbs overflow — Escape from highlighted row does not navigate", () => {
  it("closes the menu, fires no Link click, and leaves the crumb trail unchanged", async () => {
    linkClickSpy.mockClear();
    const user = userEvent.setup();
    const { container } = render(<Breadcrumbs />);

    // Capture the crumb trail + full nav HTML BEFORE opening the menu.
    const trailBefore = snapshotTrail();
    const navBefore = container.querySelector('nav[aria-label*="readcrumb" i]')!.innerHTML;
    const urlBefore = window.location.href;
    expect(trailBefore.length).toBeGreaterThan(0);

    // Open the overflow menu via keyboard (Enter on the focused trigger).
    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });
    trigger.focus();
    await user.keyboard("{Enter}");

    // Wait for the menu + Radix's auto-highlight on the first item.
    const items = await screen.findAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);
    await waitFor(() => expect(items[0]).toHaveAttribute("data-highlighted"));

    // Move highlight if we have more than one item, so we're on a "highlighted"
    // row that isn't the auto-focused default — this is the row the test brief
    // calls out.
    if (items.length > 1) {
      await user.keyboard("{ArrowDown}");
      await waitFor(() => expect(items[1]).toHaveAttribute("data-highlighted"));
    }

    // ---- The action under test: Escape from the highlighted row. --------
    await user.keyboard("{Escape}");

    // Menu closes.
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    // No navigation happened:
    //  - No Link click was dispatched by Radix on Escape.
    expect(linkClickSpy).not.toHaveBeenCalled();
    //  - jsdom URL is unchanged.
    expect(window.location.href).toBe(urlBefore);

    // Breadcrumb trail is byte-identical (same labels + hrefs, same order).
    const trailAfter = snapshotTrail();
    expect(trailAfter).toEqual(trailBefore);

    // And the rendered nav markup itself is unchanged (belt + suspenders:
    // catches any DOM churn beyond the link list, like the trigger being
    // replaced or the ellipsis disappearing).
    const navAfter = container.querySelector('nav[aria-label*="readcrumb" i]')!.innerHTML;
    expect(navAfter).toBe(navBefore);
  });
});

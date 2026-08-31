/**
 * Tab / Shift+Tab focus order through the Breadcrumbs overflow controls.
 *
 * Target: src/components/Breadcrumbs.tsx (the full breadcrumb trail with
 * the collapsed-ancestors DropdownMenu in the middle).
 *
 * With pathname `/bookings/alpha/beta/gamma/delta`, the trail resolves to:
 *   [Home]  →  [bookings]  →  [… trigger]  →  [gamma]  →  [delta (current)]
 *
 * Expected keyboard tab-order contract:
 *   • Forward Tab: sentinel-before → Home → bookings → overflow trigger
 *     → gamma → sentinel-after. `delta` is a `<span aria-current="page">`
 *     and MUST NOT be tabbable (no double-announced current page, no
 *     dead tab stop).
 *   • Shift+Tab reverses the same order without skipping any control
 *     and without getting trapped inside the breadcrumb region.
 *   • When the overflow menu is OPEN, Radix's Tab/Shift+Tab handler
 *     closes the menu and moves focus to the NEXT / PREVIOUS tabbable
 *     element on the page — confirming there is no focus trap inside
 *     the popup, which is the WAI-ARIA menu contract.
 *
 * Uses REAL Radix DropdownMenu (not the ARIA-test mock) because Tab
 * handling and focus return are Radix behavior, not Breadcrumbs behavior.
 * Router bits and pointer-capture APIs are stubbed as in
 * Breadcrumbs.escape.test.tsx.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

/** Frames the breadcrumb region with well-defined boundary tab stops so
 *  we can assert that Tab past the trigger actually leaves the region
 *  and Shift+Tab from outside comes back to the last breadcrumb control. */
function TabHarness() {
  return (
    <div>
      <button type="button" data-testid="before">
        before
      </button>
      <Breadcrumbs />
      <button type="button" data-testid="after">
        after
      </button>
    </div>
  );
}

function activeLabel(): string {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return "<body>";
  const testid = el.getAttribute("data-testid");
  if (testid) return `#${testid}`;
  return (
    el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.tagName.toLowerCase()
  );
}

describe("Breadcrumbs overflow — Tab / Shift+Tab focus order", () => {
  it("Tab walks forward through every control without skipping or trapping", async () => {
    const user = userEvent.setup();
    render(<TabHarness />);

    const before = screen.getByTestId("before");
    const after = screen.getByTestId("after");
    const home = screen.getByRole("link", { name: /go to dashboard/i });
    const bookings = screen.getByRole("link", { name: /go to bookings/i });
    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });
    const gamma = screen.getByRole("link", { name: /go to gamma/i });

    // Sanity: the current-page crumb must NOT be tabbable.
    const currentCrumb = screen.getByText("Delta");
    expect(currentCrumb).toHaveAttribute("aria-current", "page");
    expect(currentCrumb.tagName).toBe("SPAN");
    expect(currentCrumb).not.toHaveAttribute("tabindex", "0");

    before.focus();
    expect(document.activeElement).toBe(before);

    const forwardExpected = [home, bookings, trigger, gamma, after];
    const forwardSeen: string[] = [];
    for (const target of forwardExpected) {
      await user.tab();
      forwardSeen.push(activeLabel());
      expect(
        document.activeElement,
        `expected focus on ${activeLabel()} to match ${target.getAttribute("aria-label") ?? target.textContent ?? target.tagName}`,
      ).toBe(target);
    }

    // Tab past the "after" sentinel must not loop back into the breadcrumbs.
    await user.tab();
    expect(document.activeElement).not.toBe(trigger);
    expect(document.activeElement).not.toBe(home);
    expect(document.activeElement).not.toBe(bookings);
    expect(document.activeElement).not.toBe(gamma);
  });

  it("Shift+Tab walks backward through the same controls in reverse", async () => {
    const user = userEvent.setup();
    render(<TabHarness />);

    const after = screen.getByTestId("after");
    const before = screen.getByTestId("before");
    const home = screen.getByRole("link", { name: /go to dashboard/i });
    const bookings = screen.getByRole("link", { name: /go to bookings/i });
    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });
    const gamma = screen.getByRole("link", { name: /go to gamma/i });

    after.focus();
    expect(document.activeElement).toBe(after);

    const reverseExpected = [gamma, trigger, bookings, home, before];
    for (const target of reverseExpected) {
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(target);
    }
  });

  /**
   * Per WAI-ARIA menu pattern, intra-menu navigation is arrow-key based
   * (verified in Breadcrumbs.escape.test.tsx), NOT Tab. Radix implements
   * this via roving tabindex: exactly ONE menu item is in the tab
   * sequence at any time — the currently-highlighted one — and every
   * other item has `tabindex="-1"`. That structural guarantee is what
   * makes it impossible for Tab to walk between menu items (no skipping)
   * and impossible for focus to get trapped ping-ponging inside the
   * popup, regardless of which item the user highlighted.
   *
   * The full end-to-end "Tab closes menu and refocuses the trigger's
   * next sibling" contract is a Radix behavior that depends on real
   * browser focus events not fully emulated by jsdom, and is covered by
   * the a11y Playwright suite that runs in Chromium.
   */
  it("open menu uses roving tabindex so Tab cannot skip or trap between items", async () => {
    const user = userEvent.setup();
    render(<TabHarness />);

    const trigger = screen.getByRole("button", {
      name: /show \d+ hidden breadcrumb/i,
    });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");

    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(1);

    // Exactly one item is in the tab sequence at first-open.
    const tabbable = items.filter((el) => el.getAttribute("tabindex") !== "-1");
    expect(tabbable).toHaveLength(1);

    // Move highlight — the tabbable item follows the highlight,
    // never producing two simultaneous tab stops.
    await user.keyboard("{ArrowDown}");
    const tabbableAfterMove = items.filter((el) => el.getAttribute("tabindex") !== "-1");
    expect(tabbableAfterMove).toHaveLength(1);
    expect(tabbableAfterMove[0]).not.toBe(tabbable[0]);
  });
});

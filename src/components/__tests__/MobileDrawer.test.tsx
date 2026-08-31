/**
 * Mobile drawer navigation tests (hermetic harness).
 *
 * Mounting the real AppShell requires Supabase, TanStack Router, Auth
 * context, and the whole app graph. Instead we mount a MINIMAL drawer
 * that reproduces the exact contract AppShell wires up:
 *   - shadcn Sheet (Radix Dialog) with a hamburger trigger
 *   - a nav list whose active item gets `aria-current="page"` and the
 *     visible "is-active" class (the AppShell active-highlight signal)
 *   - clicking a nav link closes the drawer AND updates the active route
 *   - useSwipeToClose wired onto SheetContent
 *
 * Verifies:
 *   A. Keyboard a11y — trigger has an accessible name, Enter opens,
 *      Escape closes, focus returns to the trigger, dialog is announced
 *      with role="dialog".
 *   B. Swipe — a leftward drag on SheetContent closes the drawer.
 *   C. Active highlight — clicking a nav item updates aria-current +
 *      the "is-active" class BEFORE closing, and after re-opening the
 *      drawer the tapped item is still highlighted (persistence).
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useSwipeToClose } from "@/lib/useSwipeToClose";

// Radix uses pointer capture APIs that jsdom doesn't ship.
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

const ROUTES = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/bookings", label: "Bookings" },
  { to: "/payments", label: "Payments" },
] as const;

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState<string>("/dashboard");
  const swipe = useSwipeToClose({ onClose: () => setOpen(false), direction: "left" });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger aria-label="Open navigation menu" data-testid="mobile-trigger">
        Open
      </SheetTrigger>
      <SheetContent
        side="left"
        data-testid="drawer"
        // Matches AppShell wiring — swipe handlers on the sheet content.
        {...swipe}
      >
        <nav aria-label="Main navigation">
          {ROUTES.map((r) => {
            const active = currentPath === r.to;
            return (
              <a
                key={r.to}
                href={r.to}
                aria-current={active ? "page" : undefined}
                className={active ? "is-active" : ""}
                onClick={(e) => {
                  // Prevent jsdom navigation, then apply the AppShell
                  // contract: update the active route + close the sheet.
                  e.preventDefault();
                  setCurrentPath(r.to);
                  setOpen(false);
                }}
              >
                {r.label}
              </a>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

describe("Mobile drawer — keyboard a11y", () => {
  it("trigger has an accessible name; Enter opens; Escape closes; focus returns", async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);

    const trigger = screen.getByRole("button", { name: /open navigation menu/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    // All nav links are reachable inside the open dialog.
    const links = within(dialog).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Dashboard", "Bookings", "Payments"]);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Focus contract: returns to the trigger, not stranded on body.
    expect(document.activeElement).toBe(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Mobile drawer — swipe-to-close", () => {
  it("closes on a leftward swipe on the drawer surface", async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);

    await user.click(screen.getByRole("button", { name: /open navigation menu/i }));
    const drawer = await screen.findByTestId("drawer");
    expect(drawer).toBeInTheDocument();

    // Dispatch synthesized pointerdown + pointerup React events. Using
    // fireEvent.pointerDown/Up would go through React's synthetic bridge.
    // We inline it with the exact shape useSwipeToClose reads.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.pointerDown(drawer, {
      isPrimary: true,
      pointerType: "touch",
      pointerId: 1,
      clientX: 260,
      clientY: 200,
    });
    fireEvent.pointerUp(drawer, {
      isPrimary: true,
      pointerType: "touch",
      pointerId: 1,
      clientX: 140, // dx = -120 (well past 60px threshold), dy = 0
      clientY: 200,
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("Mobile drawer — active-item highlight updates on tap and on re-open", () => {
  it("tapping a nav item highlights it (aria-current + is-active) and re-open preserves it", async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);

    const trigger = screen.getByRole("button", { name: /open navigation menu/i });

    // First open — Dashboard is the default active item.
    await user.click(trigger);
    let dialog = await screen.findByRole("dialog");
    let dashboard = within(dialog).getByRole("link", { name: "Dashboard" });
    let bookings = within(dialog).getByRole("link", { name: "Bookings" });
    expect(dashboard).toHaveAttribute("aria-current", "page");
    expect(dashboard).toHaveClass("is-active");
    expect(bookings).not.toHaveAttribute("aria-current");
    expect(bookings).not.toHaveClass("is-active");

    // Tap Bookings — must update active + close.
    await user.click(bookings);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Re-open the drawer — Bookings is now the highlighted item, and
    // Dashboard has released the highlight. This is the "returning to
    // the menu" contract: the drawer's active state must reflect the
    // most recent navigation, not a stale cache.
    await user.click(trigger);
    dialog = await screen.findByRole("dialog");
    dashboard = within(dialog).getByRole("link", { name: "Dashboard" });
    bookings = within(dialog).getByRole("link", { name: "Bookings" });
    expect(bookings).toHaveAttribute("aria-current", "page");
    expect(bookings).toHaveClass("is-active");
    expect(dashboard).not.toHaveAttribute("aria-current");
    expect(dashboard).not.toHaveClass("is-active");

    // Global invariant: exactly ONE item is highlighted at a time.
    const highlighted = within(dialog)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(highlighted).toHaveLength(1);
  });
});

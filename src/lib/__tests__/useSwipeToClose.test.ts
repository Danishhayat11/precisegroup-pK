/**
 * Unit tests for the swipe-to-close hook used by the mobile drawer.
 *
 * We assert the CONTRACT users depend on:
 *   1. A dominantly-horizontal swipe in the close direction that clears
 *      the distance threshold fires `onClose`.
 *   2. Ambiguous (mostly-vertical) or short drags do NOT fire.
 *   3. AT-synthesized pointer events (`pointerType === ""`) are ignored
 *      so screen-reader gestures can't dismiss the nav.
 *   4. The `direction` option flips the sign correctly (right-anchored
 *      drawers close on a right-swipe).
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSwipeToClose } from "@/lib/useSwipeToClose";
import type { PointerEvent as ReactPointerEvent } from "react";

/** Minimal typed factory — only the fields the hook reads. */
function makePointer(
  overrides: Partial<ReactPointerEvent<HTMLElement>>,
): ReactPointerEvent<HTMLElement> {
  return {
    isPrimary: true,
    pointerType: "touch",
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    ...overrides,
  } as ReactPointerEvent<HTMLElement>;
}

function setup(opts: Partial<Parameters<typeof useSwipeToClose>[0]> = {}) {
  const onClose = vi.fn();
  const { result } = renderHook(() => useSwipeToClose({ onClose, ...opts }));
  return { onClose, handlers: result.current };
}

describe("useSwipeToClose", () => {
  it("fires onClose on a dominant leftward swipe past the threshold", () => {
    const { onClose, handlers } = setup(); // default direction=left, distance=60
    handlers.onPointerDown(makePointer({ clientX: 200, clientY: 100 }));
    handlers.onPointerUp(makePointer({ clientX: 120, clientY: 108 })); // dx=-80, dy=8
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when the swipe is too short (below distancePx)", () => {
    const { onClose, handlers } = setup({ distancePx: 60 });
    handlers.onPointerDown(makePointer({ clientX: 200, clientY: 100 }));
    handlers.onPointerUp(makePointer({ clientX: 170, clientY: 100 })); // dx=-30 < 60
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does NOT fire when the swipe is mostly vertical (scroll intent)", () => {
    const { onClose, handlers } = setup();
    handlers.onPointerDown(makePointer({ clientX: 200, clientY: 100 }));
    // dx=-70 (passes distance), dy=200 → dy*1.5 (300) >= |dx| (70) → not horizontal.
    handlers.onPointerUp(makePointer({ clientX: 130, clientY: 300 }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does NOT fire for a rightward swipe when direction=left", () => {
    const { onClose, handlers } = setup();
    handlers.onPointerDown(makePointer({ clientX: 100, clientY: 100 }));
    handlers.onPointerUp(makePointer({ clientX: 200, clientY: 100 })); // dx=+100
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fires on a rightward swipe when direction=right (right-anchored drawer)", () => {
    const { onClose, handlers } = setup({ direction: "right" });
    handlers.onPointerDown(makePointer({ clientX: 100, clientY: 100 }));
    handlers.onPointerUp(makePointer({ clientX: 200, clientY: 100 }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores AT-synthesized pointer events (empty pointerType)", () => {
    const { onClose, handlers } = setup();
    handlers.onPointerDown(
      // Cast: the DOM type union omits "", but real AT events send it.
      makePointer({ clientX: 200, clientY: 100, pointerType: "" as unknown as "touch" }),
    );
    handlers.onPointerUp(makePointer({ clientX: 100, clientY: 100 }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores non-primary pointers (multi-touch second finger)", () => {
    const { onClose, handlers } = setup();
    handlers.onPointerDown(makePointer({ clientX: 200, clientY: 100, isPrimary: false }));
    handlers.onPointerUp(makePointer({ clientX: 100, clientY: 100 }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets state on pointercancel — a following independent swipe still works", () => {
    const { onClose, handlers } = setup();
    handlers.onPointerDown(makePointer({ clientX: 200, clientY: 100 }));
    handlers.onPointerCancel(makePointer({ clientX: 150, clientY: 100 }));
    // Without a fresh down, up must not fire close.
    handlers.onPointerUp(makePointer({ clientX: 100, clientY: 100 }));
    expect(onClose).not.toHaveBeenCalled();

    // A brand new swipe still works after the cancel.
    handlers.onPointerDown(makePointer({ clientX: 200, clientY: 100 }));
    handlers.onPointerUp(makePointer({ clientX: 100, clientY: 100 }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

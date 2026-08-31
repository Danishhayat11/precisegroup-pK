/**
 * Swipe-to-close for the mobile navigation drawer (left-anchored Sheet).
 *
 * Shadcn's Sheet is Radix Dialog under the hood — it exposes Escape /
 * click-outside close, but not the native mobile "swipe the drawer away"
 * gesture users expect from iOS / Material. This hook layers that
 * gesture on top WITHOUT touching Radix internals or breaking its
 * keyboard/focus contract.
 *
 * Contract:
 *   - Only reacts to primary POINTER input (mouse / touch / pen), never
 *     to keyboard scrolling — so screen-reader users can't
 *     accidentally close the drawer with a swipe from an AT gesture.
 *   - Requires a horizontal swipe of at least `distancePx` (default 60)
 *     that is DOMINANT over the vertical delta (dx > dy * 1.5). This
 *     mirrors iOS' "must be clearly horizontal, not a scroll" rule.
 *   - `direction` picks which way is the close direction (default
 *     "left" for a left-anchored drawer).
 *   - Never captures pointer input while it's still ambiguous — the
 *     inner nav list stays scrollable.
 */
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

type Direction = "left" | "right";

export interface SwipeToCloseOptions {
  onClose: () => void;
  /** Minimum horizontal travel in CSS px to trigger close. Default 60. */
  distancePx?: number;
  /** Which direction "closes" the drawer. Default `"left"`. */
  direction?: Direction;
}

interface Handlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
}

export function useSwipeToClose({
  onClose,
  distancePx = 60,
  direction = "left",
}: SwipeToCloseOptions): Handlers {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);

  const reset = useCallback(() => {
    startX.current = null;
    startY.current = null;
    pointerId.current = null;
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    // Only primary pointer, and only real pointer types (mouse/pen/touch).
    // AT-synthesized events arrive with `pointerType === ""` (empty
    // string, outside the DOM type union) — skip them so screen-reader
    // gestures never trigger a close.
    if (!e.isPrimary) return;
    if (!e.pointerType) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    pointerId.current = e.pointerId;
  }, []);

  const onPointerMove = useCallback((_e: ReactPointerEvent<HTMLElement>) => {
    // No-op: we decide only on release, so an ambiguous drag doesn't
    // steal scroll from the inner nav list.
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (
        pointerId.current == null ||
        e.pointerId !== pointerId.current ||
        startX.current == null ||
        startY.current == null
      ) {
        reset();
        return;
      }
      const dx = e.clientX - startX.current;
      const dy = Math.abs(e.clientY - startY.current);
      reset();

      const signedDistance = direction === "left" ? -dx : dx;
      if (signedDistance < distancePx) return;
      // Must be a dominantly-horizontal gesture.
      if (dy * 1.5 >= Math.abs(dx)) return;
      onClose();
    },
    [distancePx, direction, onClose, reset],
  );

  const onPointerCancel = useCallback(() => {
    reset();
  }, [reset]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab/Shift+Tab inside `ref` while `active`. Captures the element that
 * had focus at the moment the trap activated, and returns focus to it after
 * the trap deactivates or the component unmounts — so screen-reader users
 * land back on the button that opened the dialog.
 *
 * The trigger is stored in a ref so re-running the keydown effect (e.g. when
 * `onEscape` gets a new identity each render) never overwrites it.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
) {
  const triggerRef = useRef<HTMLElement | null>(null);

  // Capture the trigger the moment the trap activates, and restore focus
  // when it deactivates. Runs only on the active edge, so it survives
  // any number of onEscape re-renders in between.
  useEffect(() => {
    if (!active) return;
    const activeEl = document.activeElement as HTMLElement | null;
    // Don't capture body/null or anything already inside the container.
    if (activeEl && activeEl !== document.body && !ref.current?.contains(activeEl)) {
      triggerRef.current = activeEl;
    }
    return () => {
      const t = triggerRef.current;
      triggerRef.current = null;
      // Defer so any close-time DOM changes settle first, then move focus.
      if (t && typeof t.focus === "function") {
        requestAnimationFrame(() => t.focus());
      }
    };
  }, [active, ref]);

  // Keydown handling — safe to re-bind on onEscape changes.
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("data-focus-trap-ignore") && el.offsetParent !== null,
      );

    // Move focus into the container so screen readers announce it.
    const initial = focusables();
    if (initial.length && !container.contains(document.activeElement)) {
      initial[0].focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscape) {
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [ref, active, onEscape]);
}

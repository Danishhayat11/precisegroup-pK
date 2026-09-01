import { Plus } from "lucide-react";
import { useNavigate, useLocation } from "@/lib/router-compat";

/**
 * Mobile-only floating action button (FAB) fixed to the bottom-right of
 * the viewport. Kicks off the most common action — "New Booking" — with
 * a single tap. Sits above the bottom tab bar so it never collides with
 * primary navigation, and honors the iPhone safe-area inset.
 *
 * Kept INSIDE the AppShell's `[data-theme="ios"]` wrapper so the shell's
 * global `:focus-visible` outline rule reaches it. The shell's root
 * `overflow-hidden` is disabled below `md` (see AppShell) so the 3px
 * outline + 2px offset + dark-mode halo paint without ancestor clip.
 *
 * Visibility rule:
 *   Hidden on routes that already surface a prominent primary CTA
 *   (Bookings "New booking", Payments "Record payment", Clients "Add
 *   client", CRM has its own inline FAB). Rendering a global FAB on
 *   those pages either duplicates the CTA or — worse — overlaps
 *   per-row action icons at the bottom-right of the visible card.
 *
 * Visual spec:
 *   - solid #007AFF circular background
 *   - white plus icon
 *   - fixed bottom-right, above the tab bar, clear of right-aligned
 *     per-card action icons
 *   - hidden on ≥ md breakpoints (desktop has explicit CTAs)
 */
const HIDE_ON_PATHS = ["/bookings", "/payments", "/clients", "/crm", "/leads"];

export function MobileFab() {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;
  const shouldHide = HIDE_ON_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (shouldHide) return null;

  return (
    <button
      type="button"
      onClick={() => navigate("/bookings?new=1")}
      aria-label="New booking"
      data-mobile-fab
      className="fixed z-40 md:hidden active:scale-90 hover:scale-105 transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] cursor-pointer text-white"
      style={{
        // Nudge slightly further from the right edge so the FAB sits
        // clear of per-card action icons (chat, print, overflow menu)
        // that live in the bottom-right corner of list cards.
        right: "max(20px, env(safe-area-inset-right, 0px))",
        // Sit clear of the 56px tab bar + its safe-area padding.
        bottom: "calc(72px + env(safe-area-inset-bottom, 0px))",
        width: 56,
        height: 56,
        borderRadius: 9999,
        backgroundColor: "var(--primary)",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--primary) 90%, white 10%) 0%, var(--primary) 100%)",
        display: "grid",
        placeItems: "center",
        boxShadow:
          "0 12px 28px -6px rgba(0, 122, 255, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.4)",
      }}
    >
      <Plus className="h-7 w-7 stroke-[2.5]" aria-hidden="true" />
    </button>
  );
}

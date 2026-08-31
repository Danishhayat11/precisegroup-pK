import { useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * Framer's reduced-motion preference is browser-only. Returning `false` until
 * after hydration keeps SSR/client markup identical, then honours the user's
 * preference for any subsequent motion (menus, filters, route transitions).
 */
export function useStableReducedMotion() {
  const prefersReducedMotion = useReducedMotion();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated && Boolean(prefersReducedMotion);
}

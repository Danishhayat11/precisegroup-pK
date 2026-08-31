import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

/**
 * User-facing motion preference. Overrides the OS-level
 * `prefers-reduced-motion` in either direction:
 *   • "reduce"        — force reduced motion even if the OS is off
 *   • "no-preference" — force full motion even if the OS is on
 *   • "system"        — defer to the OS (default)
 */
export type MotionPref = "system" | "reduce" | "no-preference";

export const THEME_STORAGE_KEY = "precise.theme";
export const MOTION_STORAGE_KEY = "precise.motion";
// "system" so the pre-hydration script and the runtime ThemeProvider agree
// when nothing is stored — both then defer to prefers-color-scheme /
// prefers-reduced-motion.
export const DEFAULT_THEME: Theme = "system";
export const DEFAULT_MOTION_PREF: MotionPref = "system";

// Literal theme-color values kept in sync with --background in styles.css.
export const THEME_COLOR_LIGHT = "#F1F5F9";
export const THEME_COLOR_DARK = "#06080C";
export const THEME_COLOR_META_ID = "app-theme-color";

// Media query strings — single source of truth for both the pre-hydration
// script and the runtime matchMedia subscribers.
const MQ_DARK = "(prefers-color-scheme: dark)";
const MQ_REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Pre-hydration script — runs synchronously in <head> before React hydrates so
 * the DOM's `class`, `color-scheme`, theme-color <meta>, and
 * `data-reduced-motion` attribute reflect the user's stored/system prefs on
 * first paint. The motion attribute reflects the *effective* pref (stored
 * override wins over OS) so the CSS attribute-selector catch-all fires on
 * first paint, avoiding a motion flash on reload.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var v=localStorage.getItem(k);var s=(v==='light'||v==='dark'||v==='system')?v:${JSON.stringify(DEFAULT_THEME)};var mk=${JSON.stringify(MOTION_STORAGE_KEY)};var mv=localStorage.getItem(mk);var mp=(mv==='reduce'||mv==='no-preference'||mv==='system')?mv:${JSON.stringify(DEFAULT_MOTION_PREF)};var mm=window.matchMedia;var d=s==='dark'||(s==='system'&&mm&&mm(${JSON.stringify(MQ_DARK)}).matches);var sysRm=!!(mm&&mm(${JSON.stringify(MQ_REDUCED_MOTION)}).matches);var rm=mp==='reduce'||(mp==='system'&&sysRm);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';r.setAttribute('data-reduced-motion',rm?'reduce':'no-preference');r.style.setProperty('--motion-scale',rm?'0':'1');var m=document.getElementById(${JSON.stringify(THEME_COLOR_META_ID)});if(m){m.setAttribute('content',d?${JSON.stringify(THEME_COLOR_DARK)}:${JSON.stringify(THEME_COLOR_LIGHT)});}}catch(e){}})();`;

// ---------- matchMedia subscription helpers ----------

function subscribeMedia(query: string) {
  return (cb: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mq = window.matchMedia(query);
    // Safari <14 uses addListener/removeListener.
    if (mq.addEventListener) {
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    }
    mq.addListener(cb);
    return () => mq.removeListener(cb);
  };
}

function readMedia(query: string) {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

const subscribeDark = subscribeMedia(MQ_DARK);
const subscribeRM = subscribeMedia(MQ_REDUCED_MOTION);

/**
 * Live prefers-reduced-motion hook. Reactive to OS-level changes without a
 * reload — the browser fires `change` on the MediaQueryList when the user
 * flips "Reduce motion" in system settings.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeRM,
    () => readMedia(MQ_REDUCED_MOTION),
    () => false,
  );
}

/** Live prefers-color-scheme (dark) hook. */
export function useSystemDark(): boolean {
  return useSyncExternalStore(
    subscribeDark,
    () => readMedia(MQ_DARK),
    () => false,
  );
}

// ---------- Storage ----------

function readStored(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function readStoredMotion(): MotionPref {
  if (typeof window === "undefined") return DEFAULT_MOTION_PREF;
  try {
    const v = window.localStorage.getItem(MOTION_STORAGE_KEY);
    return v === "reduce" || v === "no-preference" || v === "system"
      ? (v as MotionPref)
      : DEFAULT_MOTION_PREF;
  } catch {
    return DEFAULT_MOTION_PREF;
  }
}

// ---------- DOM application ----------

function applyTheme(resolved: Resolved) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  const meta = document.getElementById(THEME_COLOR_META_ID);
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
  }
}

function applyMotion(reduced: boolean) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-reduced-motion", reduced ? "reduce" : "no-preference");
  // Motion scale CSS variable — components can multiply durations by
  // var(--motion-scale) to disable JS-driven animations too.
  root.style.setProperty("--motion-scale", reduced ? "0" : "1");
}

// ---------- Context ----------

type Ctx = {
  theme: Theme;
  resolved: Resolved;
  systemDark: boolean;
  /** Raw OS-level `prefers-reduced-motion: reduce` value. */
  systemReducedMotion: boolean;
  /** User-facing preference — "system" defers to OS. */
  motionPref: MotionPref;
  /**
   * Effective reduced-motion after applying the user override. This is what
   * the DOM reflects via `[data-reduced-motion]` and what components should
   * consult when deciding whether to animate.
   */
  reducedMotion: boolean;
  setTheme: (t: Theme) => void;
  setMotionPref: (m: MotionPref) => void;
  toggle: () => void;
};
const ThemeCtx = createContext<Ctx | null>(null);

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start from DEFAULT_* on both server and client so the first React
  // render matches the SSR output. The pre-hydration script (see
  // THEME_INIT_SCRIPT) has already applied the correct class / color-scheme
  // and `data-reduced-motion` to <html> synchronously, so the initial paint
  // is right — we just delay reconciling state with localStorage until
  // after hydration.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [motionPref, setMotionPrefState] = useState<MotionPref>(DEFAULT_MOTION_PREF);

  useEffect(() => {
    const stored = readStored();
    if (stored !== DEFAULT_THEME) setThemeState(stored);
    const storedMotion = readStoredMotion();
    if (storedMotion !== DEFAULT_MOTION_PREF) setMotionPrefState(storedMotion);
  }, []);

  // Reactive OS-level signals. Manual overrides still take precedence.
  const systemDark = useSystemDark();
  const systemReducedMotion = useReducedMotion();

  const resolved: Resolved = useMemo(
    () => (theme === "system" ? (systemDark ? "dark" : "light") : theme),
    [theme, systemDark],
  );

  // Effective reduced-motion: the user override wins over the OS. When the
  // user leaves the pref at "system", we defer to `prefers-reduced-motion`.
  const reducedMotion = useMemo<boolean>(
    () =>
      motionPref === "reduce" ? true : motionPref === "no-preference" ? false : systemReducedMotion,
    [motionPref, systemReducedMotion],
  );

  // Apply DOM changes before paint so the pre-hydration script and React
  // converge without a flash. Runs on every resolved change — whether the
  // user toggled the theme or the OS switched schemes.
  useIsoLayoutEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  useIsoLayoutEffect(() => {
    applyMotion(reducedMotion);
  }, [reducedMotion]);

  // Cross-tab sync — another tab writing to localStorage fires `storage` here.
  // Keeps every open tab consistent with the user's latest manual overrides.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        const next =
          e.newValue === "light" || e.newValue === "dark" || e.newValue === "system"
            ? (e.newValue as Theme)
            : DEFAULT_THEME;
        setThemeState(next);
      } else if (e.key === MOTION_STORAGE_KEY) {
        const next =
          e.newValue === "reduce" || e.newValue === "no-preference" || e.newValue === "system"
            ? (e.newValue as MotionPref)
            : DEFAULT_MOTION_PREF;
        setMotionPrefState(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    setThemeState(t);
  }, []);

  const setMotionPref = useCallback((m: MotionPref) => {
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, m);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    setMotionPrefState(m);
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  const value = useMemo<Ctx>(
    () => ({
      theme,
      resolved,
      systemDark,
      systemReducedMotion,
      motionPref,
      reducedMotion,
      setTheme,
      setMotionPref,
      toggle,
    }),
    [
      theme,
      resolved,
      systemDark,
      systemReducedMotion,
      motionPref,
      reducedMotion,
      setTheme,
      setMotionPref,
      toggle,
    ],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

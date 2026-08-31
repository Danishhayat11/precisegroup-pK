import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from "@/lib/theme";

// ---------------- matchMedia mock ----------------
// jsdom has no matchMedia. We stand up a tiny reactive fake so tests can
// flip prefers-color-scheme / prefers-reduced-motion at runtime and drive
// the `change` listeners the theme provider subscribes to.
type Listener = (e: { matches: boolean }) => void;

interface FakeMQ {
  matches: boolean;
  media: string;
  listeners: Set<Listener>;
  addEventListener: (t: "change", cb: Listener) => void;
  removeEventListener: (t: "change", cb: Listener) => void;
  addListener: (cb: Listener) => void;
  removeListener: (cb: Listener) => void;
  dispatchEvent: (e: Event) => boolean;
  onchange: null;
}

const mediaState: Record<string, boolean> = {
  "(prefers-color-scheme: dark)": false,
  "(prefers-reduced-motion: reduce)": false,
};
const mediaRegistry = new Map<string, FakeMQ>();

function getMQ(query: string): FakeMQ {
  let mq = mediaRegistry.get(query);
  if (!mq) {
    const listeners = new Set<Listener>();
    mq = {
      matches: mediaState[query] ?? false,
      media: query,
      listeners,
      addEventListener: (_t, cb) => listeners.add(cb),
      removeEventListener: (_t, cb) => listeners.delete(cb),
      addListener: (cb) => listeners.add(cb),
      removeListener: (cb) => listeners.delete(cb),
      dispatchEvent: () => true,
      onchange: null,
    };
    mediaRegistry.set(query, mq);
  }
  return mq;
}

function setMedia(query: string, value: boolean) {
  mediaState[query] = value;
  const mq = getMQ(query);
  mq.matches = value;
  mq.listeners.forEach((cb) => cb({ matches: value }));
}

beforeEach(() => {
  mediaRegistry.clear();
  mediaState["(prefers-color-scheme: dark)"] = false;
  mediaState["(prefers-reduced-motion: reduce)"] = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => getMQ(q),
  });
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-reduced-motion");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Read-only probe component that surfaces provider state to the DOM.
function Probe() {
  const { theme, resolved, reducedMotion } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolved}</span>
      <span data-testid="rm">{reducedMotion ? "reduce" : "no-preference"}</span>
    </div>
  );
}

describe("cross-tab theme + motion propagation", () => {
  it("applies a theme change written by another tab via the storage event", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // Simulate another tab flipping the stored theme to "dark". The browser
    // fires `storage` in every OTHER tab (not the writer) with the new value.
    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          oldValue: "light",
          newValue: "dark",
          storageArea: window.localStorage,
        }),
      );
    });

    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("falls back to the default when another tab clears the stored theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("dark");

    act(() => {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          oldValue: "dark",
          newValue: null,
          storageArea: window.localStorage,
        }),
      );
    });

    // Default theme is "system"; with system-dark = false the resolved value
    // is "light" and the `dark` class is removed.
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("ignores storage events targeting unrelated keys", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "some.other.key",
          oldValue: null,
          newValue: "dark",
          storageArea: window.localStorage,
        }),
      );
    });

    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
  });

  it("propagates OS-level reduced-motion changes to every tab instantly", () => {
    // Reduced-motion is not persisted to localStorage — the OS broadcasts the
    // change via matchMedia, which fires in every open tab simultaneously.
    // This test asserts the provider is subscribed and re-applies DOM state.
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("rm").textContent).toBe("no-preference");
    expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("no-preference");

    act(() => {
      setMedia("(prefers-reduced-motion: reduce)", true);
    });

    expect(screen.getByTestId("rm").textContent).toBe("reduce");
    expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("reduce");
  });

  it("propagates OS-level color-scheme changes when theme is system", () => {
    // theme=system means every tab reacts to the OS dark-mode toggle via
    // matchMedia — the equivalent of cross-tab sync for a non-stored pref.
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("resolved").textContent).toBe("light");

    act(() => {
      setMedia("(prefers-color-scheme: dark)", true);
    });

    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

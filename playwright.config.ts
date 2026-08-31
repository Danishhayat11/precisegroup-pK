import { defineConfig } from "@playwright/test";

/**
 * Playwright config for a11y/integration tests against the running dev server.
 * Assumes Vite is already running on http://localhost:8080 inside the sandbox.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    // Snapshot-stability defaults. Applied to every `toMatchSnapshot`
    // and `toHaveScreenshot` call unless a call passes its own overrides.
    // Rationale:
    //   - `animations: 'disabled'` — Playwright freezes CSS animations
    //     and transitions on the ROOT and every subtree before it
    //     captures. Without this, snapshots taken mid-transition
    //     (e.g. a Radix popover's fade-in) produce different byte
    //     output on every run even at the same viewport.
    //   - `caret: 'hide'` — the text-input caret blinks. Focused-state
    //     screenshots would otherwise diff every ~500ms.
    //   - `scale: 'css'` — normalizes captures to CSS pixels regardless
    //     of the browser's device pixel ratio. Combined with the
    //     `deviceScaleFactor: 1` pin in `use` below, this guarantees
    //     that a 24×24 CSS icon serializes to a 24×24 raster on every
    //     runner. Without it a headless runner on a HiDPI host would
    //     produce 48×48 rasters and mismatch every committed baseline.
    //   - `maxDiffPixelRatio: 0.002` — belt-and-braces 0.2% tolerance
    //     for text sub-pixel AA and font-hinting jitter across
    //     Playwright / OS patch versions. Individual specs can pass a
    //     tighter budget in their own call site to lock down a
    //     critical surface.
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixelRatio: 0.002,
    },
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.002,
    },
  },
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    headless: true,
    viewport: { width: 1280, height: 1800 },
    // Pin device pixel ratio to 1 so raster output is identical whether
    // the runner reports a HiDPI or standard display. Every committed
    // snapshot baseline is captured at DPR=1; changing this without
    // regenerating baselines will break every screenshot assertion.
    deviceScaleFactor: 1,
    // `retain-on-failure` keeps trace/screenshot/video ONLY for attempts that
    // ultimately failed — passing retry attempts are discarded automatically.
    // Combined with per-attempt output dirs (`<test>-retry<N>/`), CI artifacts
    // always include the FINAL failing attempt's trace, screenshot, and video.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  // Auto-start the dev server in CI; locally assume it's already running.
  webServer: process.env.CI
    ? {
        command: "bun run dev",
        url: process.env.BASE_URL ?? "http://localhost:8080",
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
  projects: [
    {
      name: "chromium-reduced-motion",
      use: {
        browserName: "chromium",
        colorScheme: "light",
        reducedMotion: "reduce",
        launchOptions: {
          // In the Lovable sandbox, pin to the pre-installed Chromium so we
          // don't try to download a different revision. In CI we rely on
          // `playwright install --with-deps chromium` and let Playwright pick.
          ...(process.env.CI ? {} : { executablePath: "/chromium-1194/chrome-linux/chrome" }),
        },
      },
    },
    // Nightly cross-browser matrix uses `--project=webkit-reduced-motion` to
    // catch Safari/WebKit-only regressions (CSS, IntersectionObserver quirks,
    // fetch/streaming behavior). Only exercised in CI (webkit isn't bundled
    // in the local sandbox).
    {
      name: "webkit-reduced-motion",
      use: {
        browserName: "webkit",
        colorScheme: "light",
        reducedMotion: "reduce",
      },
    },
    // Firefox arm of the nightly cross-browser matrix — catches Gecko-only
    // focus/DOM-unmount regressions (Radix portals, focus-guard cleanup,
    // Escape close paths) that Chromium and WebKit don't reproduce. Same
    // caveat as WebKit: firefox binary isn't bundled in the local sandbox;
    // CI installs it via `playwright install --with-deps firefox`.
    {
      name: "firefox-reduced-motion",
      use: {
        browserName: "firefox",
        colorScheme: "light",
        reducedMotion: "reduce",
      },
    },
  ],
});

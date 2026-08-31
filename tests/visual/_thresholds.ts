/**
 * Per-test screenshot budget resolver.
 *
 * Every visual spec calls `screenshotOptionsFor(name)` when it invokes
 * `toHaveScreenshot`, so pixel-diff thresholds and the anti-aliasing
 * `threshold` knob live in ONE reviewable file
 * (`tests/visual/thresholds.config.json`) instead of being sprinkled
 * inline across ~100 specs.
 *
 * Resolution order (first match wins):
 *   1. `tests[<spec-relative-path>].screenshots[<glob>]`
 *   2. `tests[<spec-relative-path>].default`
 *   3. `default`
 *
 * The spec-relative path is inferred from the caller's stack, so specs
 * only pass the screenshot name:
 *
 *   await expect(fab).toHaveScreenshot('mobile-fab-mobile.png', screenshotOptionsFor('mobile-fab-mobile.png'));
 *
 * The returned object is safe to spread directly into a `toHaveScreenshot`
 * options bag. Unknown keys in the config are ignored (forward-compat).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export interface ScreenshotBudget {
  /** 0..1 — ratio of differing pixels to total. */
  maxDiffPixelRatio?: number;
  /** Absolute cap on differing pixels. */
  maxDiffPixels?: number;
  /**
   * 0..1 — per-pixel YIQ colour-distance tolerance before a pixel is
   * counted as "different". Raise (0.25–0.35) to ignore AA / font-hinting.
   */
  threshold?: number;
}

interface TestConfig {
  default?: ScreenshotBudget & { _why?: string };
  screenshots?: Record<string, ScreenshotBudget & { _why?: string }>;
}

interface ThresholdsConfig {
  default?: ScreenshotBudget & { _why?: string };
  tests?: Record<string, TestConfig>;
}

const CONFIG_PATH = path.resolve(__dirname, "thresholds.config.json");
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

let cached: ThresholdsConfig | null = null;

function loadConfig(): ThresholdsConfig {
  if (cached) return cached;
  const raw = readFileSync(CONFIG_PATH, "utf8");
  cached = JSON.parse(raw) as ThresholdsConfig;
  return cached;
}

/**
 * Minimal picomatch-style glob: `*` matches anything except `/`.
 * Sufficient for screenshot names (no nested paths).
 */
function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Walk the Error stack to find the first frame outside this file.
 * Returns the caller's spec path, normalised to project-relative.
 */
function callerSpecPath(): string | null {
  const err = new Error();
  const stack = err.stack ?? "";
  const lines = stack.split("\n").slice(1);
  for (const line of lines) {
    // Node stack frame: "    at fn (/abs/path/file.ts:12:34)"
    const m = line.match(/\((\/[^)]+):\d+:\d+\)/) ?? line.match(/at (\/[^\s]+):\d+:\d+/);
    if (!m) continue;
    const abs = m[1];
    if (abs.includes("_thresholds")) continue;
    return path.relative(PROJECT_ROOT, abs).replace(/\\/g, "/");
  }
  return null;
}

function stripMeta<T extends Record<string, unknown>>(o: T | undefined): ScreenshotBudget {
  if (!o) return {};
  const { _why: _ignored, ...rest } = o as ScreenshotBudget & { _why?: string };
  return rest;
}

/**
 * Resolve the effective budget for one screenshot. Merges layers
 * shallowly, per-screenshot overrides winning over the test default,
 * which wins over the global default.
 */
export function screenshotOptionsFor(name: string, specPath?: string): ScreenshotBudget {
  const cfg = loadConfig();
  const spec = specPath ?? callerSpecPath();
  const testCfg = spec ? cfg.tests?.[spec] : undefined;

  let matchedGlob: ScreenshotBudget | undefined;
  if (testCfg?.screenshots) {
    for (const [glob, budget] of Object.entries(testCfg.screenshots)) {
      if (globToRegex(glob).test(name)) {
        matchedGlob = stripMeta(budget);
        break;
      }
    }
  }

  return {
    ...stripMeta(cfg.default),
    ...stripMeta(testCfg?.default),
    ...(matchedGlob ?? {}),
  };
}

/** Exported for the diff-report script — same resolver, no stack walk. */
export function resolveBudget(specPath: string, screenshotName: string): ScreenshotBudget {
  return screenshotOptionsFor(screenshotName, specPath);
}

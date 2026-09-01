/**
 * Dedicated CI smoke: eagerly import EVERY report route module under
 * `src/routes/_authenticated/reports*.tsx` via `import.meta.glob`. Any
 * unresolved import, missing named export, or parse error in a report
 * route surfaces here — no Supabase session required, and new route
 * files are picked up automatically (no hand-maintained list to drift).
 *
 * Companion to `reports-routes-module-load.test.ts`, which asserts the
 * expected named exports on the shared `@/components/reports` barrel.
 */
import { describe, it, expect } from "vitest";

const routeModules = import.meta.glob("/src/routes/_authenticated/reports*.tsx", { eager: false });

const paths = Object.keys(routeModules).sort();

describe("reports routes — import-all smoke", () => {
  it("discovers at least one report route module", () => {
    expect(paths.length, "no reports.*.tsx files matched the glob").toBeGreaterThan(0);
  });

  it.each(paths.map((p) => [p] as const))(
    "%s imports cleanly and exports `Route`",
    async (path) => {
      const mod = (await routeModules[path]()) as Record<string, unknown>;
      expect(mod.Route, `${path} must export \`Route\``).toBeDefined();
    },
    15000,
  );
});

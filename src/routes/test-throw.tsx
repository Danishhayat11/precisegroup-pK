/**
 * Test-only route used by tests/a11y/default-error-retry.spec.ts to force a
 * loader throw and exercise the router's `defaultErrorComponent` retry
 * (invalidate + reset) behavior.
 *
 * The route is intentionally registered in all builds — it is harmless when
 * navigated to in production (it just renders a one-line confirmation when
 * the test control flag is flipped) and not linked from anywhere.
 *
 * Control surface (set on `window` before clicking "Try again"):
 *   window.__forceLoaderThrow === false  → loader resolves successfully
 *   otherwise                            → loader throws
 *
 * Telemetry (read after each loader run):
 *   window.__loaderInvocations  → integer, incremented every time the loader runs
 */
import { createFileRoute } from "@tanstack/react-router";

declare global {
  var __loaderInvocations: number | undefined;
  interface Window {
    __forceLoaderThrow?: boolean;
    __loaderInvocations?: number;
  }
}

export const Route = createFileRoute("/test-throw")({
  head: () => ({
    meta: [
      { title: "Throw Route — Internal Test" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "googlebot", content: "noindex, nofollow" },
    ],
  }),
  loader: async () => {
    const g = globalThis as typeof globalThis & { __loaderInvocations?: number };
    g.__loaderInvocations = (g.__loaderInvocations ?? 0) + 1;

    const allow = typeof window !== "undefined" && window.__forceLoaderThrow === false;

    if (!allow) {
      throw new Error("Forced loader throw for default-error-retry test");
    }

    return { invocations: g.__loaderInvocations };
  },
  component: TestThrowOk,
});

function TestThrowOk() {
  const { invocations } = Route.useLoaderData();
  return (
    <div data-testid="test-throw-ok" className="p-8">
      <h1>Throw route ready</h1>
      <p>
        Loader invocations: <span data-testid="invocations">{invocations}</span>
      </p>
    </div>
  );
}

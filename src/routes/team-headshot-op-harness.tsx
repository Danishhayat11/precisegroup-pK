/**
 * Dev-only test harness route for the <TeamHeadshot> `objectPosition`
 * runtime validator. Mounts a single portrait card with a deliberately
 * malformed `objectPosition` prop (`"centre 30vh"` — bad keyword AND
 * unsupported unit) so a Playwright spec can assert the DOM falls back
 * to the default `"center 30%"` and emits the `[TeamHeadshot]` warning.
 *
 * Gated to non-production builds — `throw notFound()` in prod prevents
 * this from shipping publicly. The Playwright test only ever runs
 * against the local dev server, where `import.meta.env.PROD` is false.
 */
import * as React from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { TeamHeadshot, type ObjectPosition } from "@/components/site/TeamHeadshot";

// The invalid value the harness renders. Exported so the spec and the
// component agree on the exact string being asserted / warned about.
export const BAD_OBJECT_POSITION = "centre 30vh";
export const EXPECTED_FALLBACK = "center 30%";

export const Route = createFileRoute("/team-headshot-op-harness")({
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound();
  },
  component: TestHarness,
});

function TestHarness() {
  // Force a post-hydration client-only re-mount of <TeamHeadshot>.
  //
  // SSR renders the component on the server, where the validator's
  // console.warn goes to the Node console — not to the browser DevTools
  // that Playwright's `page.on("console")` observes. The subsequent
  // client hydration reuses the SSR'd DOM without re-running effects,
  // so the warning never surfaces in the browser.
  //
  // Bumping `key` after mount unmounts the SSR'd instance and mounts a
  // fresh one entirely on the client. The validator's `useMemo` runs
  // during that client render, so the warn fires where Playwright can
  // capture it.
  const [key, setKey] = React.useState(0);
  React.useEffect(() => {
    setKey(1);
  }, []);

  return (
    <main data-testid="team-headshot-bad-op-harness" style={{ padding: 24, maxWidth: 400 }}>
      <h1>TeamHeadshot bad objectPosition harness</h1>
      <TeamHeadshot
        key={key}
        name="Harness Subject"
        alt="Harness subject portrait for objectPosition validator regression"
        // 1×1 transparent GIF data URI — decodes in every browser, so the
        // <img> reaches the "loaded" state and stays in the DOM (the
        // errored branch would unmount it). AVIF/WebP <source> entries
        // use the same URI; the mismatched `type=` makes the browser
        // skip them and fall through to the <img src=>.
        avifSrcSet="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII= 320w"
        webpSrcSet="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII= 320w"
        fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        // Cast through the strict `ObjectPosition` union — this is the ONE
        // place where we intentionally bypass the compile-time guard so the
        // runtime validator can be exercised. Any other caller passing an
        // invalid literal now fails typecheck.
        objectPosition={BAD_OBJECT_POSITION as unknown as ObjectPosition}
      />
    </main>
  );
}

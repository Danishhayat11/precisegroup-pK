import { expect, test } from "@playwright/test";

/**
 * Guardrail: the `#lovable-badge` container must NEVER render on any user-
 * facing route. This test walks every published surface and asserts that
 * neither the container element nor any of its expected inner text
 * (`Made with Lovable`, the floating close-X) is present in the DOM.
 *
 * The Lovable badge is only injected on PUBLISHED deployments (not on
 * localhost / vite dev). Point this suite at the published site via
 * `BASE_URL=https://<slug>.lovable.app bun run test:a11y:no-badge` to
 * verify a Pro-tier hide-badge setting is actually taking effect.
 * Running against localhost is still useful — it protects against a
 * regression that would inline the badge markup into the app bundle.
 */

const ROUTES = [
  "/",
  "/site",
  "/site/services",
  "/site/projects",
  "/site/contact",
  "/auth",
  "/dashboard",
] as const;

for (const route of ROUTES) {
  test(`no #lovable-badge on ${route}`, async ({ page }) => {
    // Some routes require auth and will redirect; that's fine — we only care
    // that whatever finally renders does NOT contain the badge.
    const response = await page.goto(route, { waitUntil: "networkidle" }).catch(() => null);
    // Ignore 4xx/5xx: the badge check still applies to error pages.
    if (response && response.status() >= 500) {
      test.skip(true, `server error ${response.status()} on ${route}`);
    }

    // Give any late-loading script (badge injector runs after hydration on
    // published sites) a chance to append the widget.
    await page.waitForTimeout(750);

    const findings = await page.evaluate(() => {
      const container = document.querySelector("#lovable-badge");
      const bodyText = document.body?.innerText ?? "";
      const madeWithNode = Array.from(document.querySelectorAll("a, div, span")).find((el) =>
        /made with lovable/i.test(el.textContent ?? ""),
      );
      const iframeSrcs = Array.from(document.querySelectorAll("iframe"))
        .map((f) => f.getAttribute("src") || "")
        .filter((src) => /lovable/i.test(src));
      return {
        containerHtml: container ? (container as HTMLElement).outerHTML.slice(0, 300) : null,
        containerVisible: container
          ? (() => {
              const cs = getComputedStyle(container as HTMLElement);
              return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
            })()
          : false,
        madeWithText: /made with lovable/i.test(bodyText),
        madeWithNode: madeWithNode ? (madeWithNode as HTMLElement).outerHTML.slice(0, 200) : null,
        lovableIframes: iframeSrcs,
      };
    });

    const problems: string[] = [];
    if (findings.containerHtml) {
      problems.push(
        `#lovable-badge container is present (visible=${findings.containerVisible}): ${findings.containerHtml}`,
      );
    }
    if (findings.madeWithText || findings.madeWithNode) {
      problems.push(
        `"Made with Lovable" text found in DOM: ${findings.madeWithNode ?? "(text only)"}`,
      );
    }
    if (findings.lovableIframes.length > 0) {
      problems.push(`Lovable badge iframe(s) present: ${findings.lovableIframes.join(", ")}`);
    }

    expect(
      problems,
      `Lovable badge leaked onto ${route}:\n  · ${problems.join("\n  · ")}\n\n` +
        `The badge should not render on this project's public routes. If this is a fresh ` +
        `publish and hide-badge is not yet configured, toggle it via the Publish settings.`,
    ).toEqual([]);
  });
}

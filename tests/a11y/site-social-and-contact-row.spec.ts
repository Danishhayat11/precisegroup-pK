import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility guard for two marketing-shell affordances that regress
 * silently when someone edits their JSX (an aria-label typo, a dropped
 * tabIndex, an icon that stops being aria-hidden):
 *
 *   1. Footer social icon-links (Instagram + LinkedIn) — icon-only <a>s
 *      that MUST expose an accessible name to screen readers. The <svg>
 *      itself is decorative (aria-hidden) so the name has to come from
 *      the anchor's aria-label. Without it, VoiceOver / NVDA announce
 *      "link" with no context.
 *
 *   2. ContactRow on /site/contact — three rows built from an icon +
 *      label + primary value (+ optional secondary). Each row MUST be:
 *        · announced with a single accessible name that folds label,
 *          primary and secondary together (children are aria-hidden
 *          because they'd otherwise be announced as three separate
 *          fragments); and
 *        · keyboard-reachable — the two href rows via native <a> focus,
 *          the address row via role="group" + tabIndex=0 so it isn't
 *          skipped by Tab.
 *
 * Failure modes this catches:
 *   · aria-label removed from a footer social link → icon-only <a> with
 *     no name (WCAG 2.4.4 / 4.1.2)
 *   · ContactRow href removed without adding tabIndex → row falls out of
 *     tab order
 *   · aria-hidden dropped from a ContactRow child → duplicate/verbose
 *     announcement of the composed name
 */

const CONTACT_ROWS = [
  {
    label: "Call us",
    primary: "+92 300 000 0000",
    href: "tel:+923000000000",
  },
  {
    label: "Email",
    primary: "info@preciserealtors.pk",
    href: "mailto:info@preciserealtors.pk",
  },
  {
    label: "Office",
    primary: "Lahore, Pakistan",
    secondary: "Address on request",
    href: undefined,
  },
] as const;

function accessibleName(row: (typeof CONTACT_ROWS)[number]) {
  return `${row.label}: ${row.primary}${row.secondary ? `, ${row.secondary}` : ""}`;
}

// ---- 1. Footer social icon-links have accessible names -------------------
// Runs on /site so the footer is rendered once; the same SiteChrome footer
// is emitted under every /site/* route, so covering one is sufficient.
test("footer Instagram + LinkedIn links expose accessible names", async ({ page }) => {
  await page.goto("/site", { waitUntil: "domcontentloaded" });

  const footer = page.locator("footer");
  await expect(footer, "SiteFooter should render on /site").toBeVisible();

  // Locate by role+name so the assertion fails specifically when the
  // aria-label is missing/renamed — not merely when the anchor is gone.
  const instagram = footer.getByRole("link", { name: /instagram/i });
  const linkedin = footer.getByRole("link", { name: /linkedin/i });

  await expect(instagram, "Instagram social link needs an accessible name").toHaveCount(1);
  await expect(linkedin, "LinkedIn social link needs an accessible name").toHaveCount(1);

  // aria-label carries the full brand-anchored name so screen-reader
  // users hear "Follow Precise Realtors & Builders on Instagram", not
  // just "Instagram link".
  await expect(instagram).toHaveAttribute("aria-label", /Instagram/);
  await expect(linkedin).toHaveAttribute("aria-label", /LinkedIn/);

  // The lucide <svg> inside each anchor is decorative — it MUST be
  // aria-hidden so it doesn't double-announce alongside the label.
  for (const link of [instagram, linkedin]) {
    const iconAriaHidden = await link.locator("svg").first().getAttribute("aria-hidden");
    expect(iconAriaHidden, 'social icon must be aria-hidden="true"').toBe("true");
  }
});

// ---- 2. ContactRow: announced + keyboard reachable -----------------------
test("ContactRow entries on /contact are announced and focusable", async ({ page }) => {
  await page.goto("/site/contact", { waitUntil: "domcontentloaded" });

  for (const row of CONTACT_ROWS) {
    const name = accessibleName(row);

    // Query by accessible name — passes only when the composed
    // aria-label is emitted correctly. `<a>` matches role="link";
    // the address <div role="group"> matches role="group".
    const el = page.getByRole(row.href ? "link" : "group", { name });
    await expect(el, `ContactRow "${name}" must be announced with its composed name`).toHaveCount(
      1,
    );

    // Children are aria-hidden so the accessible name is the label
    // alone (no double announcement of the visible text).
    const hiddenChildren = await el.locator('[aria-hidden="true"]').count();
    expect(
      hiddenChildren,
      `ContactRow "${row.label}" children must be aria-hidden`,
    ).toBeGreaterThanOrEqual(2);

    // Keyboard reachability — focus programmatically, then read
    // document.activeElement back through the same DOM node.
    await el.focus();
    const isFocused = await el.evaluate((node) => node === document.activeElement);
    expect(isFocused, `ContactRow "${row.label}" must accept keyboard focus`).toBe(true);
  }

  // Tab-order sanity: starting from the Enquiry form area, Tab should
  // eventually land on each ContactRow. We don't assert the exact index
  // (form fields sit between them) — only that each row is reachable
  // without a mouse, which is the real WCAG 2.1.1 requirement.
  await assertReachableByTab(
    page,
    CONTACT_ROWS.map((r) => accessibleName(r)),
  );
});

async function assertReachableByTab(page: Page, expectedNames: string[]) {
  // Start from a stable anchor above the ContactRow group so Tab walks
  // forward through the aside. Focusing the H1 gives us that anchor
  // without depending on which control initially has focus.
  await page.locator("h1").first().focus();

  const found = new Set<string>();
  // Cap the walk generously — the /contact form has ~10 focusables
  // above/between the rows. 40 is comfortably more than that but still
  // bounded so a bug can't hang the test.
  const MAX_TABS = 40;
  for (let i = 0; i < MAX_TABS && found.size < expectedNames.length; i++) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      return el.getAttribute("aria-label") ?? el.textContent?.trim() ?? null;
    });
    if (name && expectedNames.includes(name)) found.add(name);
  }

  for (const name of expectedNames) {
    expect(
      found.has(name),
      `ContactRow "${name}" must be reachable by Tab within ${MAX_TABS} presses`,
    ).toBe(true);
  }
}

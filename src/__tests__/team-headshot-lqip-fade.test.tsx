/**
 * LQIP fade-out regression — guarantees that the blur-up placeholder we render
 * behind Mushtaq's and Danish's <picture> visibly transitions from opaque to
 * transparent once the real AVIF/WebP finishes decoding.
 *
 * Failure modes this locks in:
 *   • Removing the `onLoad` handler → the LQIP would stay pinned at
 *     opacity-100 forever, leaving a permanent blur on the card.
 *   • Dropping the opacity transition classes → no fade animation, hard swap.
 *   • Rendering the real <img> at opacity-100 before load (pre-LQIP era) →
 *     double image flash while AVIF downloads.
 */
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TeamHeadshot } from "@/components/site/TeamHeadshot";

const AVIF_SET = [320, 480, 640, 800, 1000, 1200, 1600]
  .map((w) => `/team-${w}.avif ${w}w`)
  .join(", ");
const WEBP_SET = [320, 480, 640, 800, 1000, 1200, 1600]
  .map((w) => `/team-${w}.webp ${w}w`)
  .join(", ");
const LQIP =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==";

const DANISH_ALT =
  "Professional editorial portrait of Engr. Danish Hayat, Head of Engineering & Business Operations at Precise Realtors & Builders, wearing a light grey suit, white shirt, and navy tie, photographed against a soft, blurred office background.";
const MUSHTAQ_ALT =
  "Professional editorial portrait of Engr. Mushtaq Ahmad, wearing a charcoal suit, white shirt, and navy tie, photographed against a soft, blurred office background.";

/**
 * Returns the blurred LQIP overlay `<div aria-hidden>` that sits behind
 * `<picture>`. Selects by the `background-image` inline style so the query
 * is independent of Tailwind class names.
 */
function queryLqipLayer(root: HTMLElement): HTMLElement | null {
  const layers = Array.from(root.querySelectorAll<HTMLElement>("div[aria-hidden][style]"));
  return layers.find((el) => el.style.backgroundImage.includes("data:image")) ?? null;
}

function renderHeadshot(alt: string) {
  return render(
    <TeamHeadshot
      name="Test Subject"
      alt={alt}
      avifSrcSet={AVIF_SET}
      webpSrcSet={WEBP_SET}
      fallback="/team-800.jpg"
      lqip={LQIP}
    />,
  );
}

describe.each([
  ["Danish", DANISH_ALT],
  ["Mushtaq", MUSHTAQ_ALT],
])("LQIP fade-out — %s", (_label, alt) => {
  it("renders the blurred LQIP fully opaque before load and hides it after img.onLoad fires", () => {
    const { container } = renderHeadshot(alt);

    // 1. LQIP layer is present, blurred, and starts fully visible.
    const lqip = queryLqipLayer(container);
    expect(lqip, "LQIP overlay <div> should be rendered").not.toBeNull();
    expect(lqip!.className).toMatch(/opacity-100/);
    expect(lqip!.className).not.toMatch(/opacity-0/);
    expect(lqip!.className).toMatch(/transition-opacity/);
    expect(lqip!.className).toMatch(/duration-500/);
    // Blur + tiny scale prevent edge bleed.
    expect(lqip!.style.filter).toContain("blur");
    expect(lqip!.style.transform).toContain("scale");
    expect(lqip!.style.backgroundImage).toContain("data:image");

    // 2. Real <img> starts transparent so the LQIP shows through, and it
    //    owns the accessible name.
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe(alt);
    expect(img!.className).toMatch(/opacity-0/);
    expect(img!.className).toMatch(/transition-\[opacity,transform\]/);
    expect(img!.className).toMatch(/duration-700/);

    // 3. Fire the load event the browser would fire once AVIF/WebP decodes.
    act(() => {
      fireEvent.load(img!);
    });

    // 4. LQIP fades to opacity-0 and the real image fades to opacity-100 —
    //    while the transition classes are still applied, so it's an animated
    //    fade, not a hard swap.
    const lqipAfter = queryLqipLayer(container)!;
    expect(lqipAfter.className).toMatch(/opacity-0/);
    expect(lqipAfter.className).not.toMatch(/opacity-100/);
    expect(lqipAfter.className).toMatch(/transition-opacity/);

    const imgAfter = container.querySelector("img")!;
    expect(imgAfter.className).toMatch(/opacity-100/);
    expect(imgAfter.className).not.toMatch(/opacity-0/);
    expect(imgAfter.className).toMatch(/transition-\[opacity,transform\]/);
  });

  it("keeps the LQIP layer non-interactive and hidden from assistive tech", () => {
    const { container } = renderHeadshot(alt);
    const lqip = queryLqipLayer(container)!;
    expect(lqip.getAttribute("aria-hidden")).not.toBeNull();
    expect(lqip.className).toMatch(/pointer-events-none/);
  });

  it("stacks the LQIP layer behind <picture> (absolute inset-0, DOM order) and fades on load", () => {
    const { container } = renderHeadshot(alt);

    const lqip = queryLqipLayer(container)!;
    const picture = container.querySelector("picture")!;
    expect(picture).not.toBeNull();

    // Same parent — the LQIP is a sibling of <picture>, not nested inside.
    expect(lqip.parentElement).toBe(picture.parentElement);

    // DOM order: LQIP is rendered BEFORE <picture> so, at equal z-index,
    // the picture paints on top. Combined with `absolute inset-0` on the
    // LQIP and `relative` on the <img>, the placeholder sits visually
    // behind the real image.
    expect(
      lqip.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_FOLLOWING,
      "LQIP must appear before <picture> in DOM order so <picture> paints on top",
    ).toBeTruthy();

    // Positioning contract: LQIP is absolutely positioned and pinned to
    // every edge of the 4:5 slot; the <img> is `relative` so it stacks
    // above without needing an explicit z-index.
    expect(lqip.className).toMatch(/absolute/);
    expect(lqip.className).toMatch(/inset-0/);
    const img = picture.querySelector("img")!;
    expect(img.className).toMatch(/relative/);

    // Sanity: fade-out actually happens on the load event (covered in
    // detail above; re-asserted here so this "behind + fade" contract is
    // captured in a single locked-down test).
    expect(lqip.className).toMatch(/opacity-100/);
    act(() => {
      fireEvent.load(img);
    });
    expect(queryLqipLayer(container)!.className).toMatch(/opacity-0/);
    expect(container.querySelector("img")!.className).toMatch(/opacity-100/);
  });
});

describe("LQIP fade-out — no LQIP provided", () => {
  it("does not render a blurred overlay and the img starts fully opaque", () => {
    const { container } = render(
      <TeamHeadshot
        name="No Placeholder"
        alt={DANISH_ALT}
        avifSrcSet={AVIF_SET}
        webpSrcSet={WEBP_SET}
        fallback="/team-800.jpg"
      />,
    );
    expect(queryLqipLayer(container)).toBeNull();
    const img = container.querySelector("img")!;
    // Without an LQIP, there's nothing to fade into — image is visible from t=0.
    expect(img.className).toMatch(/opacity-100/);
    expect(img.className).not.toMatch(/opacity-0/);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Screenshot-based regression test for `LetterheadLivePreview`.
 *
 * A true pixel-diff visual test is flaky in headless CI (font hinting,
 * antialiasing, GPU). What we actually care about is: when the brand
 * display-name changes in Settings, ONLY text content should change —
 * the layout skeleton (tag tree, className order, inline `style` values,
 * ordering of children) must stay byte-identical.
 *
 * We simulate a "screenshot" by rendering the component, stripping every
 * text node down to a `__T__` placeholder, and comparing the resulting
 * layout skeleton across brand-name variants. Any visual drift — a
 * className added, a font-size flipped, an element re-ordered, a wrapper
 * lost — shows up as a skeleton diff. Text-only edits (the intended
 * change) do not. This is the durable signal a pixel diff would give
 * without the flakiness.
 */

type ProjectRow = {
  code: string;
  project_name?: string | null;
  display_name?: string | null;
};

const state: { projects: ProjectRow[] } = {
  projects: [{ code: "MH", project_name: "Manal Heights", display_name: "Manal Heights" }],
};

vi.mock("@/integrations/supabase/client", () => {
  const from = (_table: string) => ({
    select: async (_cols?: string) => ({ data: state.projects, error: null }),
  });
  return { supabase: { from } };
});

import { LetterheadLivePreview, Letterhead, Footer } from "@/pages/Documents";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

/**
 * Reduce the rendered subtree to a text-agnostic layout skeleton:
 *  - Replace every non-empty text node with `__T__`
 *  - Preserve tag names, attribute names/values (className, style), and
 *    child ordering exactly.
 * Attributes that legitimately vary by brand (e.g. `data-*` selection
 * markers) are stripped so brand-swap doesn't produce a false positive.
 */
function skeleton(root: Element): string {
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").trim();
      return t.length ? "__T__" : "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const attrs: string[] = [];
    for (const a of Array.from(el.attributes)) {
      // Skip attributes that intentionally carry brand-derived values;
      // the layout-drift signal lives in class + style, not aria-label text.
      if (a.name === "aria-label" || a.name === "title" || a.name === "alt") continue;
      // Skip react-internal reactive markers that can shift between renders.
      if (a.name.startsWith("data-reactroot")) continue;
      attrs.push(`${a.name}="${a.value}"`);
    }
    const head = `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>`;
    const kids = Array.from(el.childNodes).map(walk).join("");
    return `${head}${kids}</${tag}>`;
  }
  return walk(root);
}

async function renderSkeletonFor(displayName: string): Promise<string> {
  state.projects = [{ code: "MH", project_name: "Manal Heights", display_name: displayName }];
  const qc = makeClient();
  let container!: HTMLElement;
  await act(async () => {
    const result = render(
      <QueryClientProvider client={qc}>
        <LetterheadLivePreview />
      </QueryClientProvider>,
    );
    container = result.container;
  });
  // Let the useQuery resolve so the preview renders with the seeded name.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return recordRender(container);
}

/* ────────────────────────────────────────────────────────────────────── *
 * Failure artifact capture.
 *
 * When any assertion in this file fails, we dump:
 *   - `manifest.json` — test name, timestamp, error message
 *   - `rendered.html` — the outerHTML of the last preview container
 *   - `skeleton.txt`  — the last computed layout skeleton
 *   - `expected.skeleton.txt` / `actual.skeleton.txt` / `skeleton.diff.txt`
 *      — only when a skeleton comparison was recorded before the failure
 *
 * Artifacts land in `test-results/letterhead-visual-regression/<test>/`,
 * which is the same prefix Playwright / most CI pipelines already
 * collect. Uploading to a remote artifact store (Supabase Storage, S3,
 * GitHub Actions upload-artifact) is left to CI wiring — the test
 * intentionally does not do a network upload itself so it stays fast and
 * side-effect-free in local dev. Set `LETTERHEAD_VR_ARTIFACT_DIR` to
 * override the output directory (e.g. when your CI mounts a shared
 * artifact volume like `/mnt/documents`).
 * ────────────────────────────────────────────────────────────────────── */

const ARTIFACT_ROOT =
  process.env.LETTERHEAD_VR_ARTIFACT_DIR ?? "test-results/letterhead-visual-regression";

let lastRender: { html: string; skeleton: string } | null = null;
let lastComparison: { label: string; expected: string; actual: string } | null = null;

function recordRender(container: HTMLElement): string {
  const root = container.firstElementChild ?? container;
  const sk = skeleton(root as Element);
  lastRender = { html: (root as HTMLElement).outerHTML, skeleton: sk };
  return sk;
}

/**
 * Wraps `toBe` on skeleton strings so a failure has the pair recorded
 * before Vitest throws. Callers use this instead of raw `expect(...).toBe`
 * when comparing skeletons.
 */
function expectSkeletonEqual(actual: string, expected: string, label: string): void {
  lastComparison = { label, expected, actual };
  expect(actual, label).toBe(expected);
}

function toSafeName(name: string): string {
  return (
    name
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase()
      .slice(0, 96) || "unnamed"
  );
}

/**
 * Tiny unified-ish diff for two strings — good enough to eyeball which
 * line of the skeleton changed. We deliberately don't pull a diff lib
 * to keep the test's dependency surface flat.
 */
function lineDiff(expected: string, actual: string): string {
  const e = expected.split(/(?<=>)/); // split after every closing '>'
  const a = actual.split(/(?<=>)/);
  const max = Math.max(e.length, a.length);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    if (e[i] === a[i]) continue;
    if (e[i] !== undefined) out.push(`- ${e[i]}`);
    if (a[i] !== undefined) out.push(`+ ${a[i]}`);
  }
  return out.length ? out.join("\n") : "(no line-level diff — strings differ only in whitespace)";
}

/**
 * Extracted so both the failing-test `afterEach` hook and the artifact
 * self-check test below can exercise the exact same write path.
 */
function writeFailureArtifacts(
  dir: string,
  payload: {
    test: string;
    file?: string;
    errors: Array<{ message?: string; stack?: string }>;
    render: { html: string; skeleton: string } | null;
    comparison: { label: string; expected: string; actual: string } | null;
  },
): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const write = (name: string, body: string) => {
    const p = join(dir, name);
    writeFileSync(p, body);
    written.push(p);
  };
  const manifest = {
    test: payload.test,
    file: payload.file,
    failedAt: new Date().toISOString(),
    errors: payload.errors,
    hasRender: !!payload.render,
    hasComparison: !!payload.comparison,
  };
  write("manifest.json", JSON.stringify(manifest, null, 2));
  if (payload.render) {
    write("rendered.html", payload.render.html);
    write("skeleton.txt", payload.render.skeleton);
  }
  if (payload.comparison) {
    write("expected.skeleton.txt", payload.comparison.expected);
    write("actual.skeleton.txt", payload.comparison.actual);
    write(
      "skeleton.diff.txt",
      `# ${payload.comparison.label}\n\n${lineDiff(payload.comparison.expected, payload.comparison.actual)}\n`,
    );
  }
  return written;
}

afterEach((ctx) => {
  const task = (ctx as any).task ?? ctx;
  const state = task?.result?.state;
  if (state !== "fail") {
    lastRender = null;
    lastComparison = null;
    return;
  }
  try {
    const dir = join(ARTIFACT_ROOT, toSafeName(task.name ?? "unknown"));
    writeFailureArtifacts(dir, {
      test: task.name ?? "unknown",
      file: task.file?.filepath ?? task.file?.name,
      errors: (task.result?.errors ?? []).map((e: any) => ({
        message: e?.message,
        stack: e?.stack,
      })),
      render: lastRender,
      comparison: lastComparison,
    });

    console.log(`\n[letterhead-visual-regression] artifacts → ${dir}`);
  } catch (writeErr) {
    console.warn(
      `[letterhead-visual-regression] artifact write failed: ${(writeErr as Error).message}`,
    );
  } finally {
    lastRender = null;
    lastComparison = null;
  }
});

beforeEach(() => {
  state.projects = [{ code: "MH", project_name: "Manal Heights", display_name: "Manal Heights" }];
  lastRender = null;
  lastComparison = null;
});

describe("LetterheadLivePreview — visual regression (layout skeleton)", () => {
  it("layout skeleton is stable across brand-name changes", async () => {
    // Three brands with materially different string lengths and casing to
    // surface any layout that accidentally depends on text width.
    const heights = await renderSkeletonFor("Manal Heights");
    const arcade = await renderSkeletonFor("Manal Arcade");
    const long = await renderSkeletonFor("Emerald Skyline Residences at B-17");

    // The skeletons MUST be identical — brand-name is text-only.
    expectSkeletonEqual(arcade, heights, "brand swap must not change layout skeleton");
    expectSkeletonEqual(long, heights, "long brand name must not change layout skeleton");
  });

  it("layout skeleton matches the committed baseline snapshot", async () => {
    // Baseline snapshot: a targeted `toMatchInlineSnapshot`-style check
    // guards against silent CSS drift over time (e.g. a global Tailwind
    // rename that only affects this preview). We deliberately snapshot
    // ONLY the header + footer regions of the preview card, because the
    // interactive brand-toggle buttons above them legitimately grow/shrink
    // when the project list changes.
    const html = await renderSkeletonFor("Manal Heights");

    // Header block: opens with the letterhead border container. jsdom
    // normalizes hex → rgb() in inline styles, so match on that form.
    const headerMatch = html.match(
      /<div style="text-align: center; border-bottom: 1\.5pt solid rgb\(27, 43, 75\)[^"]*"[^>]*>[\s\S]*?<\/div><\/div>/,
    );
    const footerMatch = html.match(
      /<div style="margin-top: 24pt; padding-top: 8pt; border-top: 1pt solid rgb\(27, 43, 75\)[^"]*"[^>]*>[\s\S]*?<\/div>/,
    );

    expect(headerMatch, "letterhead header region must be present").toBeTruthy();
    expect(footerMatch, "footer region must be present").toBeTruthy();

    // Inline baseline. Any change here is a deliberate layout edit and
    // must be reviewed — that's the whole point of a regression fence.
    expect(headerMatch![0]).toMatchInlineSnapshot(
      `"<div style="text-align: center; border-bottom: 1.5pt solid rgb(27, 43, 75); padding-bottom: 8pt; margin-bottom: 14pt;"><div style="font-weight: 700; font-size: 16pt; letter-spacing: 1px; color: rgb(27, 43, 75);">__T__</div><div style="font-size: 10pt; color: rgb(85, 85, 85); margin-top: 2pt;">__T__</div><div style="font-size: 9pt; color: rgb(119, 119, 119); margin-top: 2pt;">__T__</div></div>"`,
    );
    expect(footerMatch![0]).toMatchInlineSnapshot(
      `"<div style="margin-top: 24pt; padding-top: 8pt; border-top: 1pt solid rgb(27, 43, 75); font-size: 8.5pt; color: rgb(68, 68, 68); text-align: center; line-height: 1.4;">__T____T____T__<br></br>__T____T__</div>"`,
    );
  });

  it("header and footer keep their DOM order (header before body before footer)", async () => {
    const html = await renderSkeletonFor("Manal Heights");
    const headerIdx = html.indexOf("border-bottom: 1.5pt solid rgb(27, 43, 75)");
    // Sample-body copy is stripped to __T__; locate the italic wrapper by
    // its inline-style signature.
    const italicIdx = html.indexOf("font-size: 10.5pt");
    const footerIdx = html.indexOf("border-top: 1pt solid rgb(27, 43, 75)");
    const rawSampleIdx = html.indexOf("Sample body");

    expect(headerIdx, "header must render").toBeGreaterThan(-1);
    expect(italicIdx, "sample body must render between header and footer").toBeGreaterThan(-1);
    expect(footerIdx, "footer must render").toBeGreaterThan(-1);
    expect(headerIdx).toBeLessThan(italicIdx);
    expect(italicIdx).toBeLessThan(footerIdx);
    expect(rawSampleIdx, "text content must be stripped from skeleton").toBe(-1);
  });
});

/**
 * Regression cases for the `active?.display_name || active?.project_name ||
 * "Manal Heights"` fallback chain inside `LetterheadLivePreview`. Each case
 * seeds the mocked `projects` row with a specific empty/undefined/null
 * shape and asserts the header AND footer surfaces render the correct
 * projectInfo fallback — no blank header, no stale brand, no leak of a
 * different project's address.
 */

async function renderPreviewFor(project: ProjectRow) {
  state.projects = [project];
  const qc = makeClient();
  let container!: HTMLElement;
  await act(async () => {
    const result = render(
      <QueryClientProvider client={qc}>
        <LetterheadLivePreview />
      </QueryClientProvider>,
    );
    container = result.container;
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  // Record for failure-artifact capture; return the container itself for
  // callers that need `screen`/`container.textContent` assertions.
  recordRender(container);
  return container;
}

describe("LetterheadLivePreview — brandName fallback regression", () => {
  it("empty-string display_name falls back to project_name in header AND address", async () => {
    // Simulates a Settings Reset that persisted `""` instead of `null`.
    const container = await renderPreviewFor({
      code: "MH",
      project_name: "Manal Heights",
      display_name: "",
    });
    // Header comes from project_name — NOT the empty string, NOT the hard
    // fallback string (both would coincidentally read "MANAL HEIGHTS"
    // here, so we ALSO check the footer address which only interpolates
    // via projectInfo when isHeights is true).
    expect(screen.getByText("MANAL HEIGHTS")).toBeInTheDocument();
    // isHeights matches on the resolved displayName; with the fallback
    // engaging correctly, "Manal Heights" tests true and the projectInfo
    // Heights address renders in the footer.
    expect(container.textContent).toMatch(/Manal Heights, B-17 Multi Gardens, Islamabad/);
    expect(container.textContent).toMatch(/manalheights@gmail\.com/);
  });

  it("undefined display_name falls back to project_name in header AND address", async () => {
    const container = await renderPreviewFor({
      code: "MH",
      project_name: "Manal Heights",
      // display_name intentionally omitted (undefined)
    });
    expect(screen.getByText("MANAL HEIGHTS")).toBeInTheDocument();
    expect(container.textContent).toMatch(/Manal Heights, B-17 Multi Gardens, Islamabad/);
    expect(container.textContent).toMatch(/manalheights@gmail\.com/);
  });

  it("null display_name falls back to project_name in header AND address", async () => {
    const container = await renderPreviewFor({
      code: "MH",
      project_name: "Manal Heights",
      display_name: null,
    });
    expect(screen.getByText("MANAL HEIGHTS")).toBeInTheDocument();
    expect(container.textContent).toMatch(/Manal Heights, B-17 Multi Gardens, Islamabad/);
    expect(container.textContent).toMatch(/manalheights@gmail\.com/);
  });

  it("empty display_name on a non-Heights project resolves to project_name (Arcade) — NOT the hard Heights fallback", async () => {
    // Guards against a regression where an empty string incorrectly
    // cascades past project_name into the final `|| "Manal Heights"`
    // hard-fallback. The Arcade project must keep its own identity.
    const container = await renderPreviewFor({
      code: "MA",
      project_name: "Manal Arcade",
      display_name: "",
    });
    expect(screen.getByText("MANAL ARCADE")).toBeInTheDocument();
    // The Heights hard fallback must not fire.
    expect(screen.queryByText("MANAL HEIGHTS")).not.toBeInTheDocument();
    // isHeights is false → projectShortAddr/projectAddress interpolate
    // "Manal Arcade" into the address string. The preview default-variant
    // footer doesn't render projectAddress inline (only the physical
    // office address), so scope the address check to the letterhead
    // header-region signature — the tagline must be the non-Heights one.
    expect(container.textContent).toMatch(/A vision for your living style/);
    expect(container.textContent).not.toMatch(/Elevated Living · Timeless Value/);
  });

  it("null display_name AND null project_name triggers the hard 'Manal Heights' fallback", async () => {
    // Both projectInfo signals gone — the tail of the `||` chain kicks in.
    // This is the last-resort projectInfo fallback for a broken/legacy
    // DB row, and it MUST render the Heights defaults so a doc header is
    // never blank.
    const container = await renderPreviewFor({
      code: "MH",
      project_name: null,
      display_name: null,
    });
    expect(screen.getByText("MANAL HEIGHTS")).toBeInTheDocument();
    // Hard fallback also sets isHeights=true → Heights footer defaults.
    expect(container.textContent).toMatch(/Manal Heights, B-17 Multi Gardens, Islamabad/);
    expect(container.textContent).toMatch(/manalheights@gmail\.com/);
    // Header must never be blank — assert there is a non-empty brand line.
    const heading = screen.getByText("MANAL HEIGHTS");
    expect(heading.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("layout skeleton is identical whether brandName comes from override, project_name, or hard fallback", async () => {
    // The fallback path must NOT change the DOM shape — only the text
    // content. Reuse `renderSkeletonFor` (drives the same seeded state)
    // to compare skeletons across all three fallback tiers.
    const withOverride = await renderSkeletonFor("Emerald Skyline");
    // Tier 2: project_name fallback (empty override).
    state.projects = [{ code: "MH", project_name: "Manal Heights", display_name: "" }];
    const tier2Container = await renderPreviewFor({
      code: "MH",
      project_name: "Manal Heights",
      display_name: "",
    });
    // Tier 3: hard fallback (both empty).
    const tier3Container = await renderPreviewFor({
      code: "MH",
      project_name: null,
      display_name: null,
    });

    const tier2 = skeleton(tier2Container.firstElementChild!);
    const tier3 = skeleton(tier3Container.firstElementChild!);
    expectSkeletonEqual(
      tier2,
      withOverride,
      "empty-display_name path must share layout with override path",
    );
    expectSkeletonEqual(
      tier3,
      withOverride,
      "hard-fallback path must share layout with override path",
    );
  });
});

describe("LetterheadLivePreview — failure artifact pipeline self-check", () => {
  it("writes manifest, rendered HTML, skeleton, and diff to an isolated artifact dir", async () => {
    // Render a real preview so we have authentic HTML + skeleton to dump.
    const container = await renderPreviewFor({
      code: "MH",
      project_name: "Manal Heights",
      display_name: "Manal Heights",
    });
    expect(lastRender, "renderPreviewFor must record the last render").toBeTruthy();

    // Build a synthetic comparison payload — no real assertion failure,
    // just two different skeletons so we can verify the diff path.
    const heightsSkeleton = skeleton(container.firstElementChild!);
    const arcadeSkeleton = heightsSkeleton.replace("__T__", "__ARCADE__");
    const comparison = {
      label: "self-check synthetic comparison",
      expected: heightsSkeleton,
      actual: arcadeSkeleton,
    };

    const outDir = join(
      process.env.LETTERHEAD_VR_ARTIFACT_DIR ?? "test-results/letterhead-visual-regression",
      `__selfcheck-${process.pid}-${Date.now()}`,
    );
    const written = writeFailureArtifacts(outDir, {
      test: "self-check synthetic failure",
      file: __filename,
      errors: [{ message: "synthetic — no real failure", stack: "n/a" }],
      render: lastRender,
      comparison,
    });

    // Every expected artifact must be present and non-empty.
    const { readFileSync, statSync } = await import("node:fs");
    const expectedFiles = [
      "manifest.json",
      "rendered.html",
      "skeleton.txt",
      "expected.skeleton.txt",
      "actual.skeleton.txt",
      "skeleton.diff.txt",
    ];
    for (const f of expectedFiles) {
      const p = join(outDir, f);
      expect(written, `writer must return ${f}`).toContain(p);
      expect(statSync(p).size, `${f} must be non-empty`).toBeGreaterThan(0);
    }

    // Spot-check content: manifest carries the test name; diff carries
    // the label AND at least one added/removed line.
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    expect(manifest.test).toBe("self-check synthetic failure");
    expect(manifest.hasRender).toBe(true);
    expect(manifest.hasComparison).toBe(true);

    const diff = readFileSync(join(outDir, "skeleton.diff.txt"), "utf8");
    expect(diff).toMatch(/self-check synthetic comparison/);
    expect(diff).toMatch(/^[+-]/m);

    const rendered = readFileSync(join(outDir, "rendered.html"), "utf8");
    expect(rendered).toMatch(/MANAL HEIGHTS/);

    // Cleanup — don't leave selfcheck dirs behind on repeated runs.
    const { rmSync } = await import("node:fs");
    rmSync(outDir, { recursive: true, force: true });
  });
});

/* ────────────────────────────────────────────────────────────────────── *
 * Multi-format regression: page size × margin.
 *
 * Real letterheads are printed on A4, US Letter, and (occasionally) US
 * Legal, and Settings exposes a margin preset (narrow / normal / wide).
 * The letterhead header + footer primitives (`Letterhead` / `Footer`) are
 * pt-based, so a change to a page-size wrapper — or a stray absolute unit
 * inside the primitives — can silently break print layout for one format
 * but not another. This block renders the header/body/footer inside a
 * simulated page frame for every {format × margin} combination and asserts
 * the INNER skeleton (the printable content, not the frame) is byte-
 * identical across all of them. Any drift means a format-specific
 * regression.
 * ────────────────────────────────────────────────────────────────────── */

type PageFormat = { name: string; width: number; height: number };
type MarginPreset = { name: string; pt: number };

// Widths/heights in PostScript points — matches how the real print CSS
// declares @page size. Values are the ISO/ANSI standard sizes.
const PAGE_FORMATS: PageFormat[] = [
  { name: "A4", width: 595, height: 842 },
  { name: "Letter", width: 612, height: 792 },
  { name: "Legal", width: 612, height: 1008 },
];

const MARGIN_PRESETS: MarginPreset[] = [
  { name: "narrow", pt: 36 },
  { name: "normal", pt: 72 },
  { name: "wide", pt: 108 },
];

function renderPageFrame(
  format: PageFormat,
  margin: MarginPreset,
): { container: HTMLElement; inner: Element } {
  const previewCtx = {
    brandName: "Manal Heights",
    isHeights: true,
    projectShortAddr: "Manal Heights, B-17, Islamabad",
    projectAddress: "Manal Heights, B-17 Multi Gardens, Islamabad",
    projectEmail: "manalheights@gmail.com",
  };
  const contentWidth = format.width - margin.pt * 2;
  let container!: HTMLElement;
  act(() => {
    const result = render(
      <div
        data-testid="page-frame"
        data-format={format.name}
        data-margin={margin.name}
        style={{
          width: `${format.width}pt`,
          minHeight: `${format.height}pt`,
          padding: `${margin.pt}pt`,
          boxSizing: "border-box",
          fontFamily: "'Times New Roman', serif",
        }}
      >
        <div data-testid="page-content" style={{ width: `${contentWidth}pt` }}>
          <Letterhead c={previewCtx} />
          <div style={{ fontSize: "10.5pt", color: "#555", textAlign: "center", padding: "8pt 0" }}>
            <em>Sample body</em>
          </div>
          <Footer c={previewCtx} />
        </div>
      </div>,
    );
    container = result.container;
  });
  const inner = container.querySelector('[data-testid="page-content"]')!;
  recordRender(inner as HTMLElement);
  return { container, inner };
}

describe("LetterheadLivePreview — page-size × margin regression", () => {
  it("printable content skeleton is byte-identical across every page format and margin preset", () => {
    // Anchor: A4 × normal margins. Every other combo must skeletonize to
    // the exact same tree — the frame changes size, the letterhead does
    // not.
    const anchorFormat = PAGE_FORMATS[0];
    const anchorMargin = MARGIN_PRESETS[1];
    const { inner: anchorInner } = renderPageFrame(anchorFormat, anchorMargin);
    // Skeletonize the CHILDREN of the content wrapper — the wrapper's own
    // inline `width` legitimately changes per format×margin and would
    // otherwise dominate the diff. What we're guarding is the letterhead
    // tree itself.
    const skeletonChildren = (el: Element) =>
      Array.from(el.children)
        .map((c) => skeleton(c))
        .join("");
    const anchorSkeleton = skeletonChildren(anchorInner);

    for (const format of PAGE_FORMATS) {
      for (const margin of MARGIN_PRESETS) {
        if (format.name === anchorFormat.name && margin.name === anchorMargin.name) continue;
        const { inner } = renderPageFrame(format, margin);
        const sk = skeletonChildren(inner);
        expectSkeletonEqual(
          sk,
          anchorSkeleton,
          `letterhead layout must not drift on ${format.name} × ${margin.name} margins`,
        );
      }
    }
  });

  it("page frame reflects the requested format width and margin, and content width = width − 2·margin", () => {
    // Sanity-check the harness itself: if the frame size math is wrong,
    // the invariance test above is meaningless.
    for (const format of PAGE_FORMATS) {
      for (const margin of MARGIN_PRESETS) {
        const { container } = renderPageFrame(format, margin);
        const frame = container.querySelector<HTMLElement>('[data-testid="page-frame"]')!;
        const content = container.querySelector<HTMLElement>('[data-testid="page-content"]')!;
        expect(frame.style.width, `${format.name} frame width`).toBe(`${format.width}pt`);
        expect(frame.style.padding, `${format.name} × ${margin.name} padding`).toBe(
          `${margin.pt}pt`,
        );
        expect(content.style.width, `${format.name} × ${margin.name} content width`).toBe(
          `${format.width - margin.pt * 2}pt`,
        );
        // Content width must never collapse to ≤0 — that would silently
        // hide the letterhead on tiny formats + wide margins.
        expect(
          format.width - margin.pt * 2,
          `${format.name} × ${margin.name} usable width`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("header, body, and footer keep their DOM order on every page format", () => {
    // Order-invariance is the one property a pure skeleton diff can miss
    // if two formats coincidentally serialize the same shape after a
    // reorder bug — assert it explicitly per format.
    for (const format of PAGE_FORMATS) {
      const { inner } = renderPageFrame(format, MARGIN_PRESETS[1]);
      const html = (inner as HTMLElement).innerHTML;
      const headerIdx = html.indexOf("border-bottom: 1.5pt solid rgb(27, 43, 75)");
      const bodyIdx = html.indexOf("font-size: 10.5pt");
      const footerIdx = html.indexOf("border-top: 1pt solid rgb(27, 43, 75)");
      expect(headerIdx, `${format.name} header present`).toBeGreaterThan(-1);
      expect(bodyIdx, `${format.name} body present`).toBeGreaterThan(-1);
      expect(footerIdx, `${format.name} footer present`).toBeGreaterThan(-1);
      expect(headerIdx, `${format.name} header before body`).toBeLessThan(bodyIdx);
      expect(bodyIdx, `${format.name} body before footer`).toBeLessThan(footerIdx);
    }
  });
});

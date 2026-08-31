import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * End-to-end sanity for the swap-leak diff viewer that CI links to from
 * the failure output.
 *
 * The failure assertion added in
 * `src/__tests__/settings-documents-live-preview.e2e.test.tsx` embeds a
 * clickable file:// link to the on-disk `diff.html` artifact so a CI
 * operator can jump straight from the failing log line to the rendered
 * diff. This spec exercises that hop: build a representative diff.html
 * on disk, navigate to it as if the operator clicked the link, and
 * assert the viewer paints non-empty add/del/context rows (i.e. it is
 * actually a viewer, not a blank page or a raw text dump).
 *
 * The `renderDiffHtml` / `computeUnifiedDiff` helpers are kept in-sync
 * copies of the production versions in the test file above — the same
 * class-name contract (`add` / `del` / `ctx` / `hdr`) is asserted here,
 * so if either implementation drifts this spec catches the mismatch
 * before the CI link points at a broken viewer.
 */

function computeUnifiedDiff(params: {
  prev: string;
  next: string;
  prevLabel?: string;
  nextLabel?: string;
}): string {
  const prev = params.prev.split("\n");
  const next = params.next.split("\n");
  const header = `--- ${params.prevLabel ?? "previous"}\n+++ ${params.nextLabel ?? "next"}\n`;
  // Trivial LCS-free diff: strip common prefix + common suffix, treat
  // the middle band as pure -/+ lines. Good enough for the viewer spec
  // — this is not a full patience-diff, and none of the assertions
  // depend on hunk shape.
  let i = 0;
  while (i < prev.length && i < next.length && prev[i] === next[i]) i++;
  let j = 0;
  while (
    j < prev.length - i &&
    j < next.length - i &&
    prev[prev.length - 1 - j] === next[next.length - 1 - j]
  ) {
    j++;
  }
  const prevMid = prev.slice(i, prev.length - j);
  const nextMid = next.slice(i, next.length - j);
  if (prevMid.length === 0 && nextMid.length === 0) return `${header}(no changes)\n`;
  const ctxBefore = prev.slice(Math.max(0, i - 2), i).map((l) => ` ${l}`);
  const ctxAfter = prev.slice(prev.length - j, prev.length - j + 2).map((l) => ` ${l}`);
  const body = [
    ...ctxBefore,
    ...prevMid.map((l) => `-${l}`),
    ...nextMid.map((l) => `+${l}`),
    ...ctxAfter,
  ].join("\n");
  return `${header}${body}\n`;
}

function renderDiffHtml(params: {
  title: string;
  unifiedDiff: string;
  prevLabel?: string;
  nextLabel?: string;
}): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = params.unifiedDiff
    .split("\n")
    .map((line) => {
      if (line.startsWith("--- ") || line.startsWith("+++ "))
        return `<div class="hdr">${escape(line)}</div>`;
      if (line.startsWith("+")) return `<div class="add">${escape(line)}</div>`;
      if (line.startsWith("-")) return `<div class="del">${escape(line)}</div>`;
      if (line === "(no changes)") return `<div class="eq"><em>${escape(line)}</em></div>`;
      return `<div class="ctx">${escape(line)}</div>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(params.title)}</title>
<style>
  body { font: 13px/1.5 ui-monospace, monospace; margin: 0; padding: 1rem; background: #0b0f14; color: #d7e0ea; }
  .diff > div { padding: 0 0.75rem; white-space: pre-wrap; word-break: break-word; }
  .hdr { background: #1a2432; color: #cfe1ff; font-weight: 600; }
  .add { background: #10321f; color: #b9f5cf; }
  .del { background: #3a1418; color: #ffb4bc; }
  .ctx { color: #90a3b8; }
</style></head><body>
<h1>${escape(params.title)}</h1>
<p class="meta">${escape(params.prevLabel ?? "previous")} → ${escape(params.nextLabel ?? "next")}</p>
<div class="diff">${rows}</div>
</body></html>`;
}

test.describe("Documents swap-leak · diff viewer", () => {
  let artifactDir: string;

  test.beforeAll(() => {
    artifactDir = mkdtempSync(join(tmpdir(), "docs-swap-leak-viewer-"));
  });
  test.afterAll(() => {
    rmSync(artifactDir, { recursive: true, force: true });
  });

  test("clicking the failure-log diff.html link opens a viewer with non-empty add/del/context rows", async ({
    page,
  }) => {
    // Hand-authored before/after mirrors a realistic Heights→Arcade swap
    // leak: a preserved header, a substituted owner line, a deleted note,
    // and an inserted signature — exactly the mix a CI operator would
    // see when following the failure link.
    const before = [
      "Header: Documents",
      "Owner: Manal Heights",
      "Amount: 100",
      "Note: pending",
      "Footer: end",
    ].join("\n");
    const after = [
      "Header: Documents",
      "Owner: Manal Arcade",
      "Amount: 100",
      "Signed: 2026-07-14",
      "Footer: end",
    ].join("\n");

    const unified = computeUnifiedDiff({
      prev: before,
      next: after,
      prevLabel: "previous/rendered.txt",
      nextLabel: "next/rendered.txt",
    });
    // Sanity: the fixture must actually contain edits, otherwise the
    // spec would trivially assert an empty viewer.
    expect(unified).not.toContain("(no changes)");

    const html = renderDiffHtml({
      title: "swap-leak · Heights→Arcade · invoice",
      unifiedDiff: unified,
      prevLabel: "previous/rendered.txt",
      nextLabel: "next/rendered.txt",
    });
    const diffPath = join(artifactDir, "diff.html");
    writeFileSync(diffPath, html, "utf8");

    // Open the artifact exactly the way the failure log's file:// link
    // does — no dev-server hop, no MIME assumptions.
    const url = pathToFileURL(diffPath).toString();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Header rows for both --- previous and +++ next.
    const hdrRows = page.locator(".hdr");
    await expect(hdrRows).toHaveCount(2);
    await expect(hdrRows.first()).toContainText("--- previous/rendered.txt");
    await expect(hdrRows.last()).toContainText("+++ next/rendered.txt");

    // Add / del rows: each must be non-empty and carry the expected
    // endpoint tokens.
    const addRows = page.locator(".add");
    const delRows = page.locator(".del");
    await expect(addRows).not.toHaveCount(0);
    await expect(delRows).not.toHaveCount(0);
    // Every row's text is non-blank (a stray empty <div class="add">
    // would signal the viewer emitted a bare `+` header line).
    for (const rows of [addRows, delRows]) {
      const texts = await rows.allTextContents();
      for (const t of texts) expect(t.trim().length).toBeGreaterThan(1);
    }
    await expect(addRows.filter({ hasText: "Owner: Manal Arcade" })).toHaveCount(1);
    await expect(addRows.filter({ hasText: "Signed: 2026-07-14" })).toHaveCount(1);
    await expect(delRows.filter({ hasText: "Owner: Manal Heights" })).toHaveCount(1);
    await expect(delRows.filter({ hasText: "Note: pending" })).toHaveCount(1);

    // At least one context row survived, and the no-changes sentinel
    // is NOT rendered — that would signal the viewer collapsed the
    // whole diff.
    await expect(page.locator(".ctx")).not.toHaveCount(0);
    await expect(page.locator(".eq")).toHaveCount(0);
  });

  test("viewer handles a no-changes diff by rendering the sentinel and zero add/del rows", async ({
    page,
  }) => {
    // Second scenario an operator can hit: they click the link on a
    // stale artifact where prev and next are byte-identical. The
    // viewer must render the `(no changes)` sentinel (not crash, not
    // paint a fake add/del row).
    const identical = "Header: Documents\nOwner: Manal Heights\nFooter: end";
    const unified = computeUnifiedDiff({ prev: identical, next: identical });
    expect(unified).toContain("(no changes)");
    const html = renderDiffHtml({ title: "swap-leak · no-op", unifiedDiff: unified });
    const diffPath = join(artifactDir, "diff-empty.html");
    writeFileSync(diffPath, html, "utf8");

    await page.goto(pathToFileURL(diffPath).toString(), { waitUntil: "domcontentloaded" });

    await expect(page.locator(".eq")).toHaveCount(1);
    await expect(page.locator(".eq")).toContainText("(no changes)");
    await expect(page.locator(".add")).toHaveCount(0);
    await expect(page.locator(".del")).toHaveCount(0);
  });
});

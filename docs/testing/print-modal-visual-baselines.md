# Approving visual-diff baseline changes

The print-modal visual spec
(`tests/a11y/print-modal-zoom-dpi-visual.spec.ts`) diffs every rendered
`.pp-sheet` against a committed PNG baseline. When you intentionally
change receipt layout — new column, tweaked spacing, different
letterhead — the diff fails until you regenerate and commit the new
baselines.

Baselines live under:

```
tests/a11y/print-modal-zoom-dpi-visual.spec.ts-snapshots/
  short-receipt-<slug>-page-1-<project>-linux.png
  long-receipt-<slug>-page-<n>-of-<N>-<project>-linux.png
```

`<slug>` is the zoom/DPR case (`zoom-090`, `dpr-2`, …). `<project>` is
the Playwright project (`chromium-reduced-motion`,
`firefox-reduced-motion`, `webkit-reduced-motion`). **Every browser has
its own baselines** — rasters differ across engines.

---

## Recommended flow: regenerate in CI

Local baselines usually fail on CI (different font hinting, GPU path,
headless-shell version), and you probably don't have Firefox + WebKit
installed locally anyway. The dispatch workflow regenerates on the
same Ubuntu image PRs run on.

1. **GitHub → Actions → "Print modal visual baselines (regenerate)" →
   Run workflow.** Pick `chromium`, `firefox`, `webkit`, or `all`.
2. Wait for the run to finish.
3. Open the run summary. It lists every added / removed / changed
   baseline with short SHAs — use it to sanity-check the scope. If a
   layout tweak was supposed to touch one page and the summary shows
   30 files changed across every case, something is wrong; investigate
   before proceeding.
4. Download the `print-modal-visual-baselines-<browser>` artifact.
5. Unzip it into `tests/a11y/print-modal-zoom-dpi-visual.spec.ts-snapshots/`
   (overwriting existing PNGs).
6. **Eyeball each changed PNG.** Compare against the previous version
   in the PR diff view. Reject any change that isn't the intended
   layout tweak — a regression will look like a "baseline update" and
   sneak into main otherwise.
7. Commit the updated PNGs in the same PR as the layout change with a
   commit message like `test(visual): refresh print-modal baselines
after <change>`. **Never commit baselines in a PR that doesn't also
   contain the code change that caused them.**
8. Re-run the PR checks — the `Print modal zoom / DPI` and cross-browser
   workflows should now pass against the new baselines.

Repeat steps 1–7 per browser you regenerated.

---

## Alternative: regenerate locally (chromium only)

Only reliable for chromium; Firefox / WebKit baselines still need the
dispatch workflow.

```sh
bunx playwright test \
  tests/a11y/print-modal-zoom-dpi-visual.spec.ts \
  --project=chromium-reduced-motion \
  --update-snapshots
```

Then re-run without the flag to confirm the fresh baselines are
stable:

```sh
bunx playwright test \
  tests/a11y/print-modal-zoom-dpi-visual.spec.ts \
  --project=chromium-reduced-motion
```

If a flake shows up, `toHaveScreenshot` retries once by default —
re-run once more before assuming the baseline is wrong.

Continue with steps 6–8 from the CI flow to review and commit.

---

## Sanity checks before approving

Ask these of every baseline change:

- **Does the diff match the layout change I made?** A padding tweak
  should shift content by a few pixels, not repaint half the sheet.
- **Are page counts still correct?** A new baseline named
  `long-receipt-…-page-8-of-8.png` when the previous set stopped at
  `page-7-of-7` means the receipt now overflows into an extra page —
  intentional or a regression?
- **Did the fitted width change?** All pages within a case share one
  fitted width. If long-receipt page 3 got wider but page 1 didn't,
  that's a bug the numeric spec
  (`print-modal-zoom-dpi-layout-metrics.spec.ts`) should have caught.
- **Are only the cases you expected touched?** A short-receipt change
  usually shouldn't move long-receipt page 5. If it does, the layout
  change has cross-effects worth understanding.

---

## Common failure modes

- **Only WebKit / Firefox baselines diff after a Chromium-only regen.**
  Expected. You must regenerate per browser you want to update.
- **Local baselines pass locally but fail in CI.** Use the dispatch
  workflow instead of committing local rasters.
- **Every case changed by ~1 %.** Usually a Playwright / Chromium
  version bump. Verify via `bun outdated @playwright/test`; if that's
  the cause, regenerating all browsers in one PR is the right move.
- **A baseline PNG grew huge (e.g. 800 KB → 4 MB).** The screenshot is
  probably capturing at hi-DPI instead of CSS pixels. Check that
  `playwright.config.ts` still pins `scale: "css"` and
  `deviceScaleFactor: 1` at the project level.

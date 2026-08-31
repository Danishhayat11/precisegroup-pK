# Playwright apt dependency lockfiles

Files in this directory pin the exact system apt packages that a
Playwright browser binary transitively depends on for a given CI runner
image (Ubuntu on `ubuntu-latest`).

## What's here

- `chromium.txt` — packages required by `~/.cache/ms-playwright/chromium-*/chrome-linux/{chrome,headless_shell}`
- `firefox.txt` — packages required by `~/.cache/ms-playwright/firefox-*/firefox/firefox`
- `webkit.txt` — packages required by `~/.cache/ms-playwright/webkit-*/…/MiniBrowser` plus `libWPEWebKit*.so`

Each line is `package=version`, sorted (`LC_ALL=C sort`), no comments.

## How lock validation works

`.github/scripts/validate-playwright-apt-deps.sh <browser>` is invoked by
CI immediately after `playwright install-deps`. It:

1. Runs `ldd` on the actual installed browser binary to derive the true
   runtime dependency set (not Playwright's opinion of it).
2. Resolves each shared object to its providing apt package via
   `dpkg -S`.
3. Fails if `ldd` reports any `not found` library, or if any package
   listed in this lockfile is not installed on the runner.
4. **Warns (does not fail)** on version drift, since Ubuntu rotates apt
   patch versions frequently and a hard version pin would make CI red
   on every apt refresh unrelated to Playwright.

## Regenerating a lockfile

After a Playwright upgrade or a runner image bump, the transitive apt
set can change. Regenerate the affected lockfile(s) in CI:

```yaml
- run: PLAYWRIGHT_APT_LOCK_UPDATE=1 bash .github/scripts/validate-playwright-apt-deps.sh chromium webkit firefox
```

…then commit the updated `.txt` files. The next CI run will validate
against the fresh pin.

## Why lockfiles may be absent

When a lockfile is missing for a browser, validation runs in
**report-only** mode: `ldd` still guards against missing shared
libraries (so a broken install still fails hard), but no
package-set enforcement happens. This is the safe default until a
maintainer commits the initial pin from a green CI run.

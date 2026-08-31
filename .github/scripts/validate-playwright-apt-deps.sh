#!/usr/bin/env bash
# Validate the system apt packages Playwright browsers actually depend on.
#
# For each browser argument (chromium | webkit | firefox):
#   1. Locate the installed browser binary under ~/.cache/ms-playwright.
#   2. Run `ldd` on the binary to enumerate every runtime .so dependency.
#   3. Resolve each shared object back to its providing apt package via
#      `dpkg -S`, and capture the installed version via `dpkg-query`.
#   4. Fail hard if `ldd` reports any "not found" library — that guarantees
#      the browser will crash at launch, regardless of what Playwright's
#      `install-deps` thinks it installed.
#   5. If a lockfile exists at .github/playwright-apt-lock/<browser>.txt,
#      diff its `package=version` lines against the current set and:
#        - FAIL when a locked package is missing on the runner
#        - WARN (not fail) when a locked version drifted, since Ubuntu
#          apt repos rotate patch versions and blocking on that would make
#          CI red on unrelated apt refreshes.
#      When PLAYWRIGHT_APT_LOCK_UPDATE=1 is set, the lockfile is
#      (re)written from the current set instead of being validated —
#      that's how you regenerate the pin after a Playwright upgrade.
#
# Exit codes: 0 = OK, 1 = missing libs / missing locked packages, 2 = usage.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <browser> [<browser> ...]" >&2
  echo "       browser ∈ {chromium, webkit, firefox}" >&2
  exit 2
fi

BASE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
LOCK_DIR="${GITHUB_WORKSPACE:-$(pwd)}/.github/playwright-apt-lock"
mkdir -p "$LOCK_DIR"

SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
overall_rc=0

resolve_bins() {
  local browser="$1"
  local dir
  dir=$(ls -d "$BASE"/${browser}-* 2>/dev/null | sort -V | tail -1 || true)
  if [[ -z "$dir" || ! -d "$dir" ]]; then
    echo "ERROR: no installed browser directory for '$browser' under $BASE" >&2
    return 1
  fi
  case "$browser" in
    chromium)
      # Playwright ships both the full chrome binary and the headless shell.
      ls -1 "$dir"/chrome-linux/chrome "$dir"/chrome-linux/headless_shell 2>/dev/null || true
      ;;
    firefox)
      ls -1 "$dir"/firefox/firefox 2>/dev/null || true
      ;;
    webkit)
      # WebKit's launcher pulls MiniBrowser plus a stack of gstreamer libs.
      ls -1 "$dir"/minibrowser-*/MiniBrowser "$dir"/pw_run.sh 2>/dev/null || true
      # Also probe any WebKit shared libs directly — they carry the bulk
      # of the transitive gstreamer/enchant deps that `ldd MiniBrowser`
      # doesn't always surface on its own.
      find "$dir" -maxdepth 3 -name 'libWPEWebKit*.so*' 2>/dev/null | head -3 || true
      find "$dir" -maxdepth 3 -name 'libjavascriptcoregtk*.so*' 2>/dev/null | head -1 || true
      ;;
  esac
}

validate_browser() {
  local browser="$1"
  echo "::group::Validate apt deps — $browser"

  local bins
  mapfile -t bins < <(resolve_bins "$browser")
  if [[ ${#bins[@]} -eq 0 ]]; then
    echo "no launchable binaries found for $browser" >&2
    echo "::endgroup::"
    return 1
  fi
  printf 'inspecting %d binaries:\n' "${#bins[@]}"
  printf '  %s\n' "${bins[@]}"

  local -A pkg_vers=()
  local -a missing_libs=()

  for bin in "${bins[@]}"; do
    [[ -e "$bin" ]] || continue
    while IFS= read -r line; do
      # ldd output shapes we care about:
      #   libfoo.so => /usr/lib/.../libfoo.so.1 (0x...)
      #   libfoo.so => not found
      local lib path
      lib=$(awk '{print $1}' <<<"$line")
      if grep -q 'not found' <<<"$line"; then
        missing_libs+=("${bin##*/}:$lib")
        continue
      fi
      path=$(awk '{print $3}' <<<"$line")
      [[ -n "$path" && "$path" != "not" ]] || continue
      # Resolve symlinks to canonical path for a stable dpkg lookup.
      local canonical
      canonical=$(readlink -f "$path" 2>/dev/null || echo "$path")
      local pkg
      pkg=$(dpkg -S "$canonical" 2>/dev/null | head -1 | awk -F: '{print $1}' | awk '{print $1}') || true
      if [[ -z "$pkg" ]]; then
        # Some libraries live in dirs owned by multiple packages; fall
        # back to the original (pre-readlink) path lookup.
        pkg=$(dpkg -S "$path" 2>/dev/null | head -1 | awk -F: '{print $1}' | awk '{print $1}') || true
      fi
      if [[ -n "$pkg" ]]; then
        local ver
        ver=$(dpkg-query -W -f='${Version}' "$pkg" 2>/dev/null || echo "?")
        pkg_vers["$pkg"]="$ver"
      fi
    done < <(ldd "$bin" 2>/dev/null | grep -E '=>|not found' || true)
  done

  # Emit the resolved package=version set (sorted, deterministic).
  local current_lock="$LOCK_DIR/$browser.txt"
  local tmp_current
  tmp_current=$(mktemp)
  for pkg in "${!pkg_vers[@]}"; do
    printf '%s=%s\n' "$pkg" "${pkg_vers[$pkg]}"
  done | LC_ALL=C sort > "$tmp_current"

  echo "resolved packages (${browser}):"
  sed 's/^/  /' "$tmp_current"

  {
    echo "### Playwright apt deps — \`$browser\`"
    echo ""
    echo "| Package | Version |"
    echo "| --- | --- |"
    awk -F= '{printf "| `%s` | `%s` |\n", $1, $2}' "$tmp_current"
    echo ""
  } >> "$SUMMARY"

  local rc=0

  if [[ ${#missing_libs[@]} -gt 0 ]]; then
    echo "FAIL: shared libraries reported by ldd as 'not found':" >&2
    printf '  %s\n' "${missing_libs[@]}" >&2
    {
      echo "**❌ Missing shared libraries for \`$browser\`:**"
      echo ""
      printf -- '- `%s`\n' "${missing_libs[@]}"
      echo ""
    } >> "$SUMMARY"
    rc=1
  fi

  if [[ "${PLAYWRIGHT_APT_LOCK_UPDATE:-0}" = "1" ]]; then
    cp "$tmp_current" "$current_lock"
    echo "updated lockfile: $current_lock"
    {
      echo "**🔄 Lockfile regenerated:** \`$current_lock\`"
      echo ""
    } >> "$SUMMARY"
  elif [[ -f "$current_lock" ]]; then
    # Compare package NAME set (missing pkg = fail) and version set (drift = warn).
    local -A locked_vers=()
    while IFS='=' read -r pkg ver; do
      [[ -z "$pkg" || "$pkg" =~ ^# ]] && continue
      locked_vers["$pkg"]="$ver"
    done < "$current_lock"

    local -a pkg_missing=() pkg_drifted=() pkg_added=()
    for pkg in "${!locked_vers[@]}"; do
      if [[ -z "${pkg_vers[$pkg]:-}" ]]; then
        pkg_missing+=("$pkg (locked=${locked_vers[$pkg]})")
      elif [[ "${pkg_vers[$pkg]}" != "${locked_vers[$pkg]}" ]]; then
        pkg_drifted+=("$pkg: locked=${locked_vers[$pkg]} installed=${pkg_vers[$pkg]}")
      fi
    done
    for pkg in "${!pkg_vers[@]}"; do
      [[ -z "${locked_vers[$pkg]:-}" ]] && pkg_added+=("$pkg=${pkg_vers[$pkg]}")
    done

    if [[ ${#pkg_missing[@]} -gt 0 ]]; then
      echo "FAIL: locked apt packages are NOT installed on this runner:" >&2
      printf '  %s\n' "${pkg_missing[@]}" >&2
      {
        echo "**❌ Locked packages missing on runner (\`$browser\`):**"
        echo ""
        printf -- '- `%s`\n' "${pkg_missing[@]}"
        echo ""
      } >> "$SUMMARY"
      rc=1
    fi
    if [[ ${#pkg_drifted[@]} -gt 0 ]]; then
      echo "WARN: apt version drift vs lockfile (informational, not fatal):"
      printf '  %s\n' "${pkg_drifted[@]}"
      {
        echo "**⚠️ Version drift vs lockfile (\`$browser\`):**"
        echo ""
        printf -- '- `%s`\n' "${pkg_drifted[@]}"
        echo ""
      } >> "$SUMMARY"
    fi
    if [[ ${#pkg_added[@]} -gt 0 ]]; then
      echo "INFO: packages present on runner but not in lockfile:"
      printf '  %s\n' "${pkg_added[@]}"
    fi
    if [[ ${#pkg_missing[@]} -eq 0 && ${#pkg_drifted[@]} -eq 0 ]]; then
      echo "lockfile OK — all ${#locked_vers[@]} locked packages match installed versions."
    fi
  else
    echo "no lockfile at $current_lock — validation ran in report-only mode."
    echo "  to pin the current set:  PLAYWRIGHT_APT_LOCK_UPDATE=1 $0 $browser"
    {
      echo "> ℹ️ No lockfile at \`.github/playwright-apt-lock/$browser.txt\` — pin the current set with \`PLAYWRIGHT_APT_LOCK_UPDATE=1 .github/scripts/validate-playwright-apt-deps.sh $browser\`."
      echo ""
    } >> "$SUMMARY"
  fi

  rm -f "$tmp_current"
  echo "::endgroup::"
  return "$rc"
}

for browser in "$@"; do
  case "$browser" in
    chromium|webkit|firefox) ;;
    *) echo "unknown browser: $browser" >&2; exit 2 ;;
  esac
  if ! validate_browser "$browser"; then
    overall_rc=1
  fi
done

exit "$overall_rc"

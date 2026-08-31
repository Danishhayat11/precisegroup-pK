#!/usr/bin/env bash
# Shared suite-discovery rules for audit test tooling.
#
# WHY THIS EXISTS
# ---------------
# Multiple tools need to answer the same question — "which files under
# scripts/audit/tests/ are real test suites?" — and they MUST answer it
# the same way, or a suite that's enforced by one tool can be silently
# skipped by another. Today the callers are:
#
#   • scripts/audit/tests/summary-format.sh  → Layer 2 auto-discovery
#   • (future) scripts/audit/tests/run-all.sh, ad-hoc CI greps, etc.
#
# Centralising the rules here means:
#   1. The "what counts as a suite" definition lives in one file.
#   2. Built-in exemptions (this helper, _lib/, summary-format.sh itself,
#      the run-all.sh orchestrator) can't drift between callers.
#   3. Callers add their own per-tool exemptions explicitly, so the
#      reason for every skip is auditable.
#
# CONTRACT
# --------
# After sourcing this file:
#
#   discover_suites [<flag> ...] [--] [<extra-exempt-relpath> ...]
#       Print every test-suite shell script, one per line, as a path
#       relative to the repo root (e.g. "scripts/audit/tests/foo.sh").
#       Output is sorted in LC_ALL=C order for stable CI logs.
#
#       Flags (all repeatable, all optional, may appear in any order):
#         --suite <name>      Include only the named suite. <name> may
#                             be a basename ("foo.sh"), a basename
#                             without extension ("foo"), or a full
#                             repo-relative path
#                             ("scripts/audit/tests/foo.sh"). Multiple
#                             --suite flags union.
#         --pattern <glob>    Include only suites whose basename OR
#                             repo-relative path matches the bash
#                             glob (e.g. "cli-*", "*contract*"). Quote
#                             to prevent the calling shell from
#                             expanding it. Multiple --pattern flags
#                             union with each other and with --suite.
#         --exempt <relpath>  Add a repo-relative path to the
#                             exemption set. Equivalent to passing
#                             the same path positionally; provided so
#                             flag-style call sites read clearly.
#         --                  End-of-flags marker. Everything after is
#                             treated as a positional exempt path,
#                             even if it starts with "--".
#
#       After flags, any remaining positional args are treated as
#       repo-relative exempt paths (backward compatible with the
#       pre-flag call sites). Unknown flags write a diagnostic to
#       stderr and return exit code 2.
#
#       Filter semantics:
#         • If no --suite / --pattern given, the candidate set is
#           "every *.sh directly under scripts/audit/tests/".
#         • If any --suite or --pattern is given, the candidate set
#           is narrowed to the UNION of everything that matches at
#           least one filter. Filters can only narrow, never expand —
#           a --suite or --pattern that resolves to no real suite is
#           a silent no-op (matches nothing, doesn't error).
#         • Built-in exemptions and explicit exempts ALWAYS subtract,
#           even when the same path was named by --suite. (Asking for
#           summary-format.sh by name does not unhide it; the
#           self-recursion guard wins.)
#
# Built-in exemptions (never returned):
#   • Anything under scripts/audit/tests/_lib/ (helpers, not suites).
#   • scripts/audit/tests/summary-format.sh (the format guard itself).
#   • scripts/audit/tests/run-all.sh (orchestrator — invokes the suites
#     it would otherwise auto-discover; including it would self-recurse).
#
# IMPLEMENTATION NOTES
# --------------------
# - Uses `find -maxdepth 1` so helpers under _lib/ are excluded by
#   construction, not by name-matching (defence in depth: if someone
#   later renames _lib/foo.sh to look like a suite, the maxdepth rule
#   still keeps it out).
# - Sorts output so CI logs and exit-summary buckets are deterministic.
# - Pure stdout, no globals leaked: callers consume via `while read`.
# - Flag parsing keeps everything in `local`/`declare` vars; no shell
#   options are mutated, so callers running under `set -euo pipefail`
#   stay safe.

# Resolve the tests dir once, regardless of the caller's CWD.
_AUDIT_TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_AUDIT_REPO_ROOT="$(cd "$_AUDIT_TESTS_DIR/../../.." && pwd)"

# Built-in exemptions — keyed by repo-relative path. Anything added here
# applies to EVERY caller of discover_suites; per-tool exemptions are
# passed as positional args (or --exempt) and merged on top.
_audit_suite_builtin_exempt() {
  cat <<'EOF'
scripts/audit/tests/summary-format.sh
scripts/audit/tests/run-all.sh
EOF
}

# Normalise a --suite NAME into the repo-relative shape the rest of the
# pipeline uses. Accepts "foo", "foo.sh", or "scripts/audit/tests/foo.sh"
# and always returns "scripts/audit/tests/<basename>.sh".
_audit_suite_normalise_name() {
  local name="$1"
  name="${name##*/}"
  case "$name" in
    *.sh) ;;
    *)    name="${name}.sh" ;;
  esac
  printf 'scripts/audit/tests/%s\n' "$name"
}

discover_suites() {
  declare -A _exempt=()
  declare -a _include_paths=()
  declare -a _include_patterns=()
  local _have_filter=0
  local p

  # Seed exemption set with built-ins.
  while IFS= read -r p; do
    [ -n "$p" ] && _exempt["$p"]=1
  done < <(_audit_suite_builtin_exempt)

  # ── Flag parsing ────────────────────────────────────────────────────
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --suite)
        if [ "$#" -lt 2 ]; then
          printf 'discover_suites: --suite requires a value\n' >&2
          return 2
        fi
        _include_paths+=("$(_audit_suite_normalise_name "$2")")
        _have_filter=1
        shift 2
        ;;
      --suite=*)
        _include_paths+=("$(_audit_suite_normalise_name "${1#--suite=}")")
        _have_filter=1
        shift
        ;;
      --pattern)
        if [ "$#" -lt 2 ]; then
          printf 'discover_suites: --pattern requires a value\n' >&2
          return 2
        fi
        _include_patterns+=("$2")
        _have_filter=1
        shift 2
        ;;
      --pattern=*)
        _include_patterns+=("${1#--pattern=}")
        _have_filter=1
        shift
        ;;
      --exempt)
        if [ "$#" -lt 2 ]; then
          printf 'discover_suites: --exempt requires a value\n' >&2
          return 2
        fi
        [ -n "$2" ] && _exempt["$2"]=1
        shift 2
        ;;
      --exempt=*)
        p="${1#--exempt=}"
        [ -n "$p" ] && _exempt["$p"]=1
        shift
        ;;
      --)
        shift
        break
        ;;
      --*)
        printf 'discover_suites: unknown flag: %s\n' "$1" >&2
        return 2
        ;;
      *)
        # First non-flag positional — stop flag parsing and treat the
        # rest as exempt paths (backward-compatible positional API).
        break
        ;;
    esac
  done

  # Remaining positionals = explicit exempt paths.
  for p in "$@"; do
    [ -n "$p" ] && _exempt["$p"]=1
  done

  # ── Enumerate + filter ──────────────────────────────────────────────
  local abs rel base inc pat matched
  while IFS= read -r abs; do
    base="$(basename "$abs")"
    rel="scripts/audit/tests/$base"

    # Exemptions ALWAYS subtract, even if the caller named the suite
    # via --suite (built-in self-recursion guards win).
    [ -n "${_exempt[$rel]:-}" ] && continue

    if [ "$_have_filter" -eq 1 ]; then
      matched=0
      for inc in "${_include_paths[@]+"${_include_paths[@]}"}"; do
        if [ "$inc" = "$rel" ]; then
          matched=1
          break
        fi
      done
      if [ "$matched" -eq 0 ]; then
        for pat in "${_include_patterns[@]+"${_include_patterns[@]}"}"; do
          # Match against basename OR repo-relative path so callers
          # can write either "cli-*" or "scripts/audit/tests/cli-*".
          # shellcheck disable=SC2053
          if [[ $base == $pat ]] || [[ $rel == $pat ]]; then
            matched=1
            break
          fi
        done
      fi
      [ "$matched" -eq 0 ] && continue
    fi

    printf '%s\n' "$rel"
  done < <(find "$_AUDIT_TESTS_DIR" -maxdepth 1 -type f -name '*.sh' | sort)
}


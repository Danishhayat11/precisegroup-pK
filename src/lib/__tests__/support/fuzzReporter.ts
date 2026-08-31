/**
 * Shared failure reporter for fast-check fuzz properties.
 *
 * Wraps `fc.check` and, on failure, throws an Error whose message contains
 *   • the property name,
 *   • the *minimal* (post-shrink) counterexample rendered with visible
 *     escapes for control characters (so `\r`, `\n`, `\t`, `\0`, `\x7f`
 *     stay readable in CI logs instead of corrupting them),
 *   • run/shrink counts, the fast-check seed, and the counterexample path,
 *   • a copy-pasteable `fc.assert(..., { seed, path, endOnFailure: true })`
 *     line for local reproduction,
 *   • the original predicate error (first 8 stack lines).
 *
 * Sync only by design — every fuzz property in this repo is synchronous.
 * If we ever add async properties, add `assertPropertyAsync` alongside;
 * do not silently `await` a possibly-Promise result here (fast-check's
 * `check` returns a Promise iff the property is async, and losing that
 * branch produces confusing "failed=undefined" reports).
 */
import fc from "fast-check";

/**
 * Named escapes for the "everyone recognises this" characters. Kept in a
 * single table so CSV and JSON fuzz callers render the same input the
 * same way — matters when the counterexample is a shared string that
 * flows through both encoders.
 */
const CTRL_MAP: Record<string, string> = {
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\0": "\\0",
  "\x08": "\\b",
  "\x0b": "\\v",
  "\x0c": "\\f",
};

/**
 * Characters that must be rendered visibly but aren't C0/C1 controls:
 *   • U+00A0 NBSP — visually identical to space, common CSV corruption
 *   • U+2028/U+2029 — line/paragraph separators; valid in JSON, invisible
 *   • U+200B–U+200D, U+2060 — zero-width space/joiner/no-break, invisible
 *   • U+FEFF BOM — invisible, breaks column headers
 *   • U+200E/U+200F — LRM/RLM, flip visible display order
 *
 * Grouped in a Set for cheap lookup and rendered as `\uXXXX` for
 * cross-encoding consistency with JSON's own escape syntax.
 */
const INVISIBLE_UNICODE = new Set<string>([
  "\u00a0",
  "\u200b",
  "\u200c",
  "\u200d",
  "\u200e",
  "\u200f",
  "\u2028",
  "\u2029",
  "\u2060",
  "\ufeff",
]);

// Single sweep: C0 (0x00-0x1f), DEL (0x7f), plus the invisible-unicode
// set above. Kept as one regex so a caller can't accidentally escape
// half the alphabet by calling the CSV variant vs the JSON variant.
const ESCAPE_RX = /[\x00-\x1f\x7f\u00a0\u200b-\u200f\u2028\u2029\u2060\ufeff]/g;

function hex4(code: number): string {
  return code.toString(16).padStart(4, "0");
}

/**
 * Render every non-printable / ambiguous character in `s` as a readable
 * escape. Named mappings win over generic hex so `\n` stays `\n` (not
 * `\x0a`). Unpaired surrogates are rendered as `\uD8xx`/`\uDCxx` too,
 * since they otherwise print as U+FFFD or crash downstream JSON parsers.
 *
 * NOT idempotent — a single call escapes ONCE. `renderValue` guarantees
 * we only pass a raw counterexample through this once per string.
 */
export function escapeControlChars(s: string): string {
  // Pass 1: named/invisible chars via lookup.
  const primary = s.replace(ESCAPE_RX, (c) => {
    const named = CTRL_MAP[c];
    if (named) return named;
    if (INVISIBLE_UNICODE.has(c)) return `\\u${hex4(c.charCodeAt(0))}`;
    return `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
  // Pass 2: unpaired surrogates. We can't fold this into ESCAPE_RX
  // without also matching well-formed surrogate pairs (emoji etc.),
  // which we want to leave alone so people can read the actual chars.
  let out = "";
  for (let i = 0; i < primary.length; i++) {
    const code = primary.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = primary.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        // Well-formed pair — keep both code units verbatim.
        out += primary[i] + primary[i + 1];
        i++;
        continue;
      }
      out += `\\u${hex4(code)}`;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      // Lone low surrogate.
      out += `\\u${hex4(code)}`;
      continue;
    }
    out += primary[i];
  }
  return out;
}

export function renderValue(v: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") {
    // Order matters: escape backslashes first so the `\` sequences that
    // `escapeControlChars` later inserts (`\n`, `\uXXXX`, …) aren't
    // doubled. Then escape the wrapping quote. Then apply the shared
    // control-char / invisible-unicode / surrogate pass so CSV and JSON
    // fuzz banners render the same input identically.
    const escaped = escapeControlChars(v.replace(/\\/g, "\\\\").replace(/"/g, '\\"'));
    return `"${escaped}"`;
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : `Number(${String(v)})`;
  if (typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (typeof v === "symbol") return v.toString();
  if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
  if (typeof v === "object") {
    const obj = v as object;
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);
    if (Array.isArray(v)) {
      return `[${v.map((x) => renderValue(x, seen)).join(", ")}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `${JSON.stringify(k)}: ${renderValue(val, seen)}`,
    );
    return `{ ${entries.join(", ")} }`;
  }
  return String(v);
}

// Public for unit-testing.
export interface FailureContext {
  /**
   * Ordered labels for each positional argument produced by the fast-check
   * arbitrary tuple. Used to render `headerColumns` / `rowValues` /
   * `explicitKeys` instead of `[0] / [1] / [2]` in the failure banner so
   * a reader can tell at a glance which sub-field of the input triggered
   * the invariant break.
   */
  argNames?: readonly string[];
  /**
   * One-line, plain-English restatement of the invariant that was
   * violated (e.g. "explicit column keys must survive JSON round-trip
   * byte-for-byte"). Printed verbatim on the first line of the failure
   * banner and stored in the JSON artifact as `invariant`.
   */
  invariant?: string;
  /**
   * Optional caller-supplied hook: given the shrunk counterexample
   * (whatever the property predicate received), return a
   * `{ filename → rendered text }` map describing what the CSV / JSON /
   * envelope the property would have exercised looks like. Each entry
   * is written to disk beside the failure banner as `<base>.<filename>`
   * so CI reviewers can open the exact CSV or JSON that broke the
   * property WITHOUT reconstructing it from the seed.
   *
   * Called inside a try/catch — a throwing renderer never masks the
   * real assertion failure.
   */
  renderInputs?: (counterexample: unknown) => Record<string, string>;
}

/**
 * Best-effort classifier: given the labelled args, guess which field
 * "broke" the invariant. Heuristic and purely for the banner — the raw
 * counterexample is always persisted in full for authoritative debugging.
 * Rules:
 *   • First non-empty string / non-empty array arg with a label wins.
 *   • Prefer arrays over scalars (a row of values is more likely the
 *     offender than a single header string when both are present).
 *   • Returns `null` when nothing labelled is available.
 */
function guessOffendingField(cx: unknown, argNames: readonly string[] | undefined): string | null {
  if (!argNames?.length || !Array.isArray(cx)) return null;
  const args = cx as unknown[];
  let arrayCandidate: string | null = null;
  let scalarCandidate: string | null = null;
  for (let i = 0; i < args.length && i < argNames.length; i++) {
    const v = args[i];
    const name = argNames[i];
    if (Array.isArray(v) && v.length > 0 && arrayCandidate === null) arrayCandidate = name;
    else if (typeof v === "string" && v.length > 0 && scalarCandidate === null)
      scalarCandidate = name;
    else if (v && typeof v === "object" && !Array.isArray(v) && arrayCandidate === null) {
      arrayCandidate = name;
    }
  }
  return arrayCandidate ?? scalarCandidate;
}

/**
 * Walk a captured stack and return the first frame that belongs to a
 * test file outside this reporter, converted to a repo-relative POSIX
 * path. Used to build a copy-pasteable `vitest run <file> -t "<name>"`
 * command so a reader can rerun the exact failing property with one
 * click. Best-effort — returns `null` when the stack can't be parsed
 * (unknown runtime, minified frames).
 */
export function extractCallerTestFile(stack: string | undefined): string | null {
  const abs = extractCallerTestFileAbsolute(stack);
  if (!abs) return null;
  const cwd = (() => {
    try {
      return typeof process !== "undefined" ? process.cwd() : "";
    } catch {
      return "";
    }
  })();
  if (cwd && abs.startsWith(cwd.replace(/\\/g, "/") + "/")) {
    return abs.slice(cwd.length + 1);
  }
  return abs;
}

/**
 * Same walk as {@link extractCallerTestFile} but returns the FULL
 * resolved absolute path (POSIX-style separators). Used in the human
 * failure banner so a reader can copy the reproduce command from any
 * working directory — CI logs, editor terminal, remote SSH — without
 * having to `cd` into the repo root first.
 */
export function extractCallerTestFileAbsolute(stack: string | undefined): string | null {
  if (!stack) return null;
  const lines = stack.split("\n");
  const frameRx =
    /\(?(?:file:\/\/)?((?:\/|[A-Za-z]:[\\/])[^)\s:]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)):\d+:\d+\)?/;
  for (const line of lines) {
    const m = frameRx.exec(line);
    if (!m) continue;
    const abs = m[1].replace(/\\/g, "/");
    if (abs.includes("/support/fuzzReporter.")) continue;
    if (abs.includes("/node_modules/")) continue;
    if (!/\.test\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(abs)) continue;
    return abs;
  }
  return null;
}

/**
 * Shell-quote a string for a POSIX single-line command. Wraps in single
 * quotes and escapes embedded single quotes via the `'\''` idiom so a
 * user can paste the emitted command verbatim into bash/zsh.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Cross-platform quoting for a single argv token that must survive both
 * POSIX shells (bash/zsh) AND Windows shells (cmd.exe, PowerShell).
 *
 * Strategy: wrap in double quotes and escape embedded `"` / `\` / `$` /
 * backtick. Empty strings become `""` (both shells accept this as an
 * empty argv token). Simple tokens made only of `[A-Za-z0-9_./=:-]` pass
 * through unquoted — those are the common case (test names, file paths,
 * fast-check `path` values like `0:3:1`, seed integers), keeping the
 * banner readable.
 *
 * NOTE: this is intended for arguments to a real argv-based program
 * (e.g. `node scripts/ci/fuzz-replay.mjs ...`), NOT for bash `VAR=val cmd`
 * env prefixes — that syntax is not portable to cmd/PowerShell, so the
 * reproduce banner uses the fuzz-replay CLI instead.
 */
export function crossShellQuote(s: string): string {
  if (s === "") return `""`;
  if (/^[A-Za-z0-9_.\/=:\-]+$/.test(s)) return s;
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
  return `"${escaped}"`;
}

/**
 * Classify a failed `RunDetails` into one of three modes. fast-check's
 * `failed: true` is a union of "the property returned false / threw",
 * "too many `fc.pre` filter skips", and "run was interrupted" (timeout,
 * abort signal). The reporter must render each differently — the
 * counterexample field is `null` for the latter two, so the default
 * "Minimal counterexample" block collapses to "null" and hides useful
 * signal (numSkips, last-seen sample from verbose logs).
 */
export type FailureMode = "property" | "tooManySkips" | "interrupted";

export function classifyFailure<Ts>(details: fc.RunDetails<Ts>): FailureMode {
  if ((details as { interrupted?: boolean }).interrupted) return "interrupted";
  // fast-check sets `counterexample === null` when the run failed without
  // ever producing a real counterexample. In practice this is the
  // too-many-skips path (fc.pre rejected every generated sample).
  if (details.failed && details.counterexample === null) return "tooManySkips";
  return "property";
}

/**
 * Pull the last emitted values from a verbose `RunDetails.failures`
 * array. fast-check only populates this when the property was called
 * with `{ verbose: fc.VerbosityLevel.Verbose }` (or higher). For skip /
 * interrupt failures we treat these as "minimal-ish inputs" — they are
 * not shrunk, but they are the actual last-tested inputs and are
 * strictly better than emitting `null`.
 */
function renderLastSamples<Ts>(
  details: fc.RunDetails<Ts>,
  argNames?: readonly string[],
): string | null {
  const failures = (details as { failures?: unknown[] }).failures;
  if (!Array.isArray(failures) || failures.length === 0) return null;
  // Take up to the last 3 — enough to spot a pattern, short enough to
  // stay readable in a CI log.
  const tail = failures.slice(-3);
  return tail
    .map((f, i) => {
      const args = Array.isArray(f) ? f : [f];
      const rendered = args
        .map((a, j) => {
          const label = argNames?.[j];
          return label
            ? `      ${label} (arg ${j}): ${renderValue(a)}`
            : `      [${j}] ${renderValue(a)}`;
        })
        .join("\n");
      return `    sample ${tail.length - i} back:\n${rendered}`;
    })
    .join("\n");
}

export function formatFailure<Ts>(
  name: string,
  details: fc.RunDetails<Ts>,
  ctx: FailureContext = {},
  callerStack?: string,
): string {
  if (!details.failed && !(details as { interrupted?: boolean }).interrupted) return "";
  const mode = classifyFailure(details);
  const cx = details.counterexample;
  const { argNames, invariant } = ctx;
  const rawErr = (details as { errorInstance?: unknown }).errorInstance;
  const errText = rawErr
    ? (rawErr instanceof Error ? (rawErr.stack ?? rawErr.message) : String(rawErr))
        .split("\n")
        .slice(0, 8)
        .join("\n")
    : "";
  const path = details.counterexamplePath ?? "";
  const offender = mode === "property" ? guessOffendingField(cx, argNames) : null;
  const testFile = extractCallerTestFile(callerStack);
  // Use the fully-resolved absolute path in the reproduce command so it
  // pastes cleanly from CI logs / editor terminals / remote shells with
  // no `cd <repo root>` prerequisite.
  const testFileForCmd = extractCallerTestFileAbsolute(callerStack) ?? testFile;
  const numSkips = (details as { numSkips?: number }).numSkips ?? 0;

  const lines = [`Property "${name}" failed (mode: ${mode}).`];
  if (invariant) lines.push(`  invariant: ${invariant}`);
  if (offender) lines.push(`  likely offending field: ${offender}`);
  lines.push(
    `  runs=${details.numRuns}  shrinks=${details.numShrinks}  skips=${numSkips}  seed=${details.seed}  path="${path}"`,
  );

  if (mode === "property") {
    const argsRendered = Array.isArray(cx)
      ? (cx as unknown[])
          .map((a, i) => {
            const label = argNames?.[i];
            return label
              ? `  ${label} (arg ${i}): ${renderValue(a)}`
              : `  [${i}] ${renderValue(a)}`;
          })
          .join("\n")
      : `  ${renderValue(cx)}`;
    lines.push(`Minimal counterexample (control chars escaped):`, argsRendered);
  } else if (mode === "tooManySkips") {
    // No counterexample exists — every generated sample was rejected by
    // `fc.pre(...)`. Surface the last few samples if verbose captured
    // them, otherwise tell the reader how to enable verbose mode.
    lines.push(
      `No counterexample: fast-check gave up after ${numSkips} skipped samples`,
      `(fc.pre / fc.assume rejected too much of the arbitrary's output).`,
    );
    const samples = renderLastSamples(details, argNames);
    if (samples) {
      lines.push("Last skipped samples (control chars escaped):", samples);
    } else {
      lines.push(
        "  (no per-sample data — rerun with { verbose: fc.VerbosityLevel.Verbose } to capture last inputs)",
      );
    }
  } else {
    // interrupted
    lines.push(
      `Run interrupted after ${details.numRuns} sample(s) (timeout, abort signal, or explicit fc.stop).`,
    );
    const samples = renderLastSamples(details, argNames);
    if (samples) {
      lines.push("Last sampled inputs before interrupt (control chars escaped):", samples);
    } else if (Array.isArray(cx)) {
      // Some interrupt paths still carry a partial counterexample; show
      // it under a clearly different heading than the "minimal" one so
      // a reader doesn't confuse it with a shrunk failure.
      lines.push(
        "Last input seen before interrupt (NOT shrunk, control chars escaped):",
        (cx as unknown[])
          .map((a, i) => {
            const label = argNames?.[i];
            return label
              ? `  ${label} (arg ${i}): ${renderValue(a)}`
              : `  [${i}] ${renderValue(a)}`;
          })
          .join("\n"),
      );
    } else {
      lines.push(
        "  (no last-input data — rerun with { verbose: fc.VerbosityLevel.Verbose } to capture)",
      );
    }
  }

  // Inline the caller-supplied renderInputs (typically the exact CSV
  // header + metadata block + body, or the JSON envelope) so a reviewer
  // can copy-paste directly from the CI log to reproduce the collision
  // WITHOUT opening a sibling artifact. Bounded per entry to keep the
  // banner readable in log viewers; the full text is still on disk via
  // persistFailure's renderInputs sibling files.
  if (typeof ctx.renderInputs === "function" && cx !== undefined && mode === "property") {
    try {
      const rendered = ctx.renderInputs(cx);
      const entries = Object.entries(rendered).filter(([, v]) => typeof v === "string");
      if (entries.length > 0) {
        lines.push("Rendered inputs (exact bytes the property saw):");
        for (const [name, text] of entries) {
          const capped =
            text.length > BANNER_RENDERED_INPUT_CAP
              ? `${text.slice(0, BANNER_RENDERED_INPUT_CAP)}\n… [truncated ${text.length - BANNER_RENDERED_INPUT_CAP} bytes — full text in the sibling artifact file]`
              : text;
          // Fence with a name marker so grep/scripts can carve blocks
          // back out of a copy-pasted banner. Uses `----` fences
          // instead of triple-backticks so CSV bodies containing
          // backticks stay unambiguous.
          lines.push(
            `----- BEGIN ${name} (${text.length} bytes) -----`,
            capped,
            `----- END ${name} -----`,
          );
        }
      }
    } catch (err) {
      lines.push(
        `Rendered inputs unavailable (renderInputs threw): ${
          err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        }`,
      );
    }
  }

  lines.push(`Reproduce locally:`);
  if (testFile) {
    // Invoked via the fuzz-replay CLI so the command is portable across
    // bash/zsh, cmd.exe and PowerShell — the script sets FC_REPLAY_SEED
    // / FC_REPLAY_PATH in Node before spawning the test runner, so no
    // shell-specific `VAR=val cmd` env-prefix syntax is needed.
    lines.push(
      `  node scripts/ci/fuzz-replay.mjs --seed ${crossShellQuote(String(details.seed))} --path ${crossShellQuote(path)} --file ${crossShellQuote(testFileForCmd ?? testFile)} --name ${crossShellQuote(name)}`,
    );
  }
  lines.push(
    `  fc.assert(<property>, { seed: ${details.seed}, path: "${path}", endOnFailure: true })`,
  );
  if (errText) {
    lines.push("Original error:", errText);
  }
  return lines.join("\n");
}

/**
 * Max bytes per rendered-input entry inlined into the human-readable
 * failure banner. The JSON artifact keeps a separate (larger) 2 KB
 * per-entry preview and the full text is written as a sibling file, so
 * this cap is purely about keeping the CI stdout block readable — a
 * typical CSV metadata header + a few rows fits comfortably.
 */
const BANNER_RENDERED_INPUT_CAP = 4096;

export interface AssertPropertyOptions<Ts> extends fc.Parameters<Ts>, FailureContext {
  /**
   * Optional override for the property name shown in the failure banner.
   * Defaults to the `name` argument passed to `assertProperty`.
   */
  displayName?: string;
}

/**
 * Directory (relative to CWD) where fuzz failures are persisted for CI
 * artifact upload. Override with `FUZZ_FAILURE_DIR=""` to disable, or
 * with a custom path to redirect. Default matches the
 * `test-results/**` glob in `.github/workflows/full-test-suite.yml`.
 */
const DEFAULT_FUZZ_FAILURE_DIR = "test-results/fuzz-failures";

function sanitizeForFilename(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "property"
  );
}

/**
 * Persist a minimal failing counterexample to disk so CI can upload it
 * as an artifact. Two files per failure:
 *   • `<name>-<ts>.txt`  — the human-readable banner (same as the thrown
 *                          error message; searchable in the artifact bundle).
 *   • `<name>-<ts>.json` — machine-readable: seed, path, counterexample
 *                          (JSON-safe rendering), run/shrink counts, plus
 *                          the labelled sub-fields (`argFields`) and the
 *                          `invariant` string so a replay/bisect tool can
 *                          group failures by which input field broke.
 *
 * Best-effort: any FS error is swallowed and reported to stderr so a
 * transient write failure doesn't mask the real assertion error. Skipped
 * in non-Node environments (browser test runners) where `node:fs` won't
 * resolve.
 */
function persistFailure<Ts>(
  name: string,
  details: fc.RunDetails<Ts>,
  banner: string,
  ctx: FailureContext,
  callerStack: string | undefined,
): void {
  const dir = process.env.FUZZ_FAILURE_DIR ?? DEFAULT_FUZZ_FAILURE_DIR;
  if (!dir) return;
  // Guard: only run under Node. `require` is not defined in browser bundlers,
  // and dynamic `import()` would be async — we need this sync so the throw
  // below still happens on the current tick.
  if (typeof process === "undefined" || !process.versions?.node) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `${sanitizeForFilename(name)}-${stamp}-${process.pid}`;
    fs.writeFileSync(path.join(dir, `${base}.txt`), banner + "\n", "utf8");
    const cx = details.counterexample;
    const rawErr = (details as { errorInstance?: unknown }).errorInstance;
    // Build a `{ label: value }` view of the counterexample when arg names
    // are provided, so JSON consumers can grep by field (e.g. every failure
    // with a non-empty `explicitKeys`) without re-parsing positional arrays.
    const argFields: Record<string, unknown> | null =
      ctx.argNames && Array.isArray(cx)
        ? Object.fromEntries((cx as unknown[]).map((v, i) => [ctx.argNames?.[i] ?? `arg${i}`, v]))
        : null;
    const testFile = extractCallerTestFile(callerStack);
    const testFileAbs = extractCallerTestFileAbsolute(callerStack);
    const shellReproduce = testFile
      ? `node scripts/ci/fuzz-replay.mjs --seed ${crossShellQuote(String(details.seed))} --path ${crossShellQuote(details.counterexamplePath ?? "")} --file ${crossShellQuote(testFileAbs ?? testFile)} --name ${crossShellQuote(name)}`
      : null;

    // Caller-supplied rendered inputs (CSV / JSON / envelope text the
    // property would have exercised). Written as sibling files so a CI
    // reviewer can `cat` the exact broken input without re-running
    // fast-check. Guarded so a throwing renderer never masks the real
    // assertion failure.
    const renderedInputs: Record<string, string> = {};
    const renderedFilenames: string[] = [];
    if (typeof ctx.renderInputs === "function" && cx !== undefined) {
      try {
        const rendered = ctx.renderInputs(cx);
        for (const [k, v] of Object.entries(rendered)) {
          if (typeof v !== "string") continue;
          const safeName = sanitizeForFilename(k) || "input";
          renderedInputs[safeName] = v;
          const filename = `${base}.${safeName}`;
          fs.writeFileSync(path.join(dir, filename), v, "utf8");
          renderedFilenames.push(filename);
        }
      } catch (err) {
        // Renderer failure captured in the preview under a reserved
        // key — NOT written as a sibling file, so `renderedInputFiles`
        // stays a truthful list of what's actually on disk.
        renderedInputs["__renderer_error__"] =
          err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);
      }
    }
    const payload = {
      property: name,
      mode: classifyFailure(details),
      invariant: ctx.invariant ?? null,
      failed: details.failed,
      interrupted: (details as { interrupted?: boolean }).interrupted ?? false,
      numRuns: details.numRuns,
      numShrinks: details.numShrinks,
      numSkips: (details as { numSkips?: number }).numSkips ?? 0,
      seed: details.seed,
      counterexamplePath: details.counterexamplePath ?? null,
      argNames: ctx.argNames ?? null,
      argFields,
      offendingField: guessOffendingField(cx, ctx.argNames),
      counterexamplePretty: Array.isArray(cx)
        ? (cx as unknown[]).map((a) => renderValue(a))
        : renderValue(cx),
      counterexampleRaw: cx,
      // Verbose per-sample log if the caller opted in; useful for
      // tooManySkips / interrupted cases where there is no shrunk cx.
      lastSamples: (details as { failures?: unknown[] }).failures ?? null,
      errorMessage: rawErr instanceof Error ? rawErr.message : rawErr ? String(rawErr) : null,
      testFile,
      shellReproduce,
      reproduce: `fc.assert(<property>, { seed: ${details.seed}, path: "${details.counterexamplePath ?? ""}", endOnFailure: true })`,
      writtenAt: new Date().toISOString(),
      // Filenames (relative to `dir`) written by the caller's
      // `renderInputs` hook. Empty when the hook is absent, threw, or
      // returned no string entries.
      renderedInputFiles: renderedFilenames,
      // Truncated inline preview so a triage tool can eyeball the
      // rendered input without opening a second file. First 2 KB per
      // entry — enough for a CSV header + a few rows or a small JSON
      // envelope, but bounded so a large payload doesn't bloat the
      // JSON artifact.
      renderedInputsPreview: Object.fromEntries(
        Object.entries(renderedInputs).map(([k, v]) => [
          k,
          v.length > 2048 ? `${v.slice(0, 2048)}\n… [truncated ${v.length - 2048} bytes]` : v,
        ]),
      ),
    };
    fs.writeFileSync(
      path.join(dir, `${base}.json`),
      JSON.stringify(
        payload,
        (_k, v) => {
          if (typeof v === "bigint") return `bigint:${v.toString()}`;
          if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
          if (typeof v === "symbol") return v.toString();
          if (typeof v === "undefined") return "__undefined__";
          return v;
        },
        2,
      ) + "\n",
      "utf8",
    );
  } catch (err) {
    // Never let artifact persistence mask the real fuzz failure.

    console.error(`[fuzzReporter] failed to persist counterexample for "${name}":`, err);
  }
}

import { clearSeed, readEnvOverride, readSeed, writeSeed } from "./fuzzSeedStore";

/**
 * Common tail shared by `assertProperty` (sync) and `assertPropertyAsync`.
 * Given a completed `RunDetails`, formats the failure banner, persists
 * the artifact + seed store, and throws with a decorated Error. When
 * the run passed, clears any stale entry from the seed store (the
 * regression is fixed and stale seeds waste a run per invocation).
 *
 * `replayLabel` distinguishes "the auto-replay of a stored seed failed"
 * from "a fresh run failed" in the banner — critical for triage: a
 * replay failure means the previously-captured regression is STILL
 * broken; a fresh failure means a NEW input broke a previously-green
 * property.
 */
function handleRunDetails<Ts>(
  displayName: string,
  details: fc.RunDetails<Ts>,
  ctx: FailureContext,
  callerStack: string | undefined,
  replayLabel: "fresh" | "replay",
): void {
  const failedOrInterrupted =
    details.failed || (details as { interrupted?: boolean }).interrupted === true;
  if (!failedOrInterrupted) {
    // Successful run — remove any stale stored seed for this property.
    // Only clears on a FRESH run (replay-only passes don't imply the
    // main property is stable, only that this exact seed no longer
    // triggers it — but we still want to clear because keeping the
    // seed would force a replay every run forever).
    clearSeed(displayName);
    return;
  }
  const bannerName =
    replayLabel === "replay" ? `${displayName} [auto-replay of stored seed]` : displayName;
  const banner = formatFailure(bannerName, details, ctx, callerStack);
  persistFailure(displayName, details, banner, ctx, callerStack);
  emitCiAnnotation(displayName, details, ctx, callerStack, replayLabel);
  // Persist to the auto-replay store so the NEXT run reproduces this
  // failure deterministically before doing any random exploration.
  writeSeed({
    property: displayName,
    seed: details.seed,
    path: String(details.counterexamplePath ?? ""),
    capturedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || process.env.GIT_COMMIT || undefined,
    invariant: ctx.invariant,
  });
  const err = new Error(banner);
  (err as Error & { fastCheckDetails?: fc.RunDetails<Ts> }).fastCheckDetails = details;
  throw err;
}

/**
 * Emit a one-line GitHub Actions workflow-command annotation for a fuzz
 * failure so the seed + shrunk counterexample surface in the "Annotations"
 * pane at the top of the run, without scrolling the raw test log.
 *
 * Format (see docs):
 *   ::error file={file},line=1,title={title}::{message}
 *
 * Message body must escape `%`, `\r`, `\n` per the workflow-command
 * encoding rules. We embed the full multi-line banner so a reviewer sees
 * seed, path, counterexample, and reproduce line together — GitHub
 * renders %0A as visible newlines inside the annotation panel.
 *
 * Modes (env `FUZZ_CI_ANNOTATIONS`):
 *   • `auto` (default) — emit iff `GITHUB_ACTIONS=true`.
 *   • `github`        — force GitHub-style output (useful for local demos).
 *   • `off`           — never emit.
 *
 * Never throws — annotation failures must not mask the underlying assertion.
 */
function emitCiAnnotation<Ts>(
  displayName: string,
  details: fc.RunDetails<Ts>,
  ctx: FailureContext,
  callerStack: string | undefined,
  replayLabel: "fresh" | "replay",
): void {
  try {
    const mode = (process.env.FUZZ_CI_ANNOTATIONS ?? "auto").toLowerCase();
    if (mode === "off") return;
    const isGha = process.env.GITHUB_ACTIONS === "true";
    if (mode === "auto" && !isGha) return;
    if (mode !== "auto" && mode !== "github") return;

    const bannerName =
      replayLabel === "replay" ? `${displayName} [auto-replay of stored seed]` : displayName;
    const body = formatFailure(bannerName, details, ctx, callerStack);
    const testFile = extractCallerTestFile(callerStack) ?? "";
    const classified = classifyFailure(details);
    const title =
      `fuzz: ${bannerName} (${classified}, seed=${details.seed}` +
      (details.counterexamplePath ? `, path=${details.counterexamplePath}` : "") +
      `)`;

    // Workflow-command message encoding: %25 must go first, then CR/LF.
    const encode = (s: string) =>
      s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

    const props = [
      testFile ? `file=${encode(testFile)}` : "",
      testFile ? `line=1` : "",
      `title=${encode(title)}`,
    ]
      .filter(Boolean)
      .join(",");

    // Direct write to stdout so vitest's reporter buffering doesn't
    // reorder it out of the failing-test block. GitHub parses the line
    // regardless of surrounding log noise.
    process.stdout.write(`::error ${props}::${encode(body)}\n`);
  } catch (err) {
    console.error(`[fuzzReporter] failed to emit CI annotation for "${displayName}":`, err);
  }
}

/**
 * Compute the replay params for this call, in priority order:
 *   1. `FC_REPLAY_SEED` env override (manual bisect from a failure banner).
 *   2. Persisted seed under `.fuzz-seed-store/<hash>.json`.
 *   3. None — skip replay, go straight to fresh run.
 *
 * Returned as fast-check parameters overlay; caller merges it on top of
 * the user's params with `endOnFailure: true` and `numRuns: 1` so the
 * replay is a single shrunk-back reproduction, not a full exploration.
 */
function resolveReplayParams(displayName: string): { seed: number; path: string } | null {
  const env = readEnvOverride();
  if (env) return env;
  const stored = readSeed(displayName);
  if (stored) return { seed: stored.seed, path: stored.path };
  return null;
}

/**
 * Drop-in replacement for `fc.assert(fc.property(...))` that produces
 * a readable, reproducible failure message AND auto-replays any
 * previously-captured counterexample seed before doing fresh random
 * exploration. Sync properties only — use `assertPropertyAsync` for
 * `fc.asyncProperty`.
 */
export function assertProperty<Ts>(
  name: string,
  property: fc.IRawProperty<Ts, false>,
  params: AssertPropertyOptions<Ts> = {},
): void {
  const callerStack = new Error().stack;
  const displayName = params.displayName ?? name;
  const ctx: FailureContext = {
    argNames: params.argNames,
    invariant: params.invariant,
    renderInputs: params.renderInputs,
  };

  const replay = resolveReplayParams(displayName);
  if (replay) {
    // Auto-replay: use the stored seed/path FIRST. If it still fails,
    // surface that as the deterministic reproduction and skip the
    // fresh run — the caller is chasing a specific regression, not
    // hunting new bugs.
    const replayResult = fc.check(property, {
      ...params,
      seed: replay.seed,
      path: replay.path,
      endOnFailure: true,
      numRuns: 1,
    }) as fc.RunDetails<Ts>;
    if (replayResult.failed || (replayResult as { interrupted?: boolean }).interrupted) {
      handleRunDetails(displayName, replayResult, ctx, callerStack, "replay");
      return; // handleRunDetails throws on failure — unreachable, but explicit.
    }
    // Replay passed — the previously-captured seed no longer reproduces.
    // Drop it from the store and fall through to a fresh run.
    clearSeed(displayName);
  }

  const result = fc.check(property, params) as fc.RunDetails<Ts>;
  handleRunDetails(displayName, result, ctx, callerStack, "fresh");
}

/**
 * Async counterpart to `assertProperty`. Required for properties built
 * with `fc.asyncProperty(...)` — `fc.check` returns a Promise there
 * and awaiting it in `assertProperty` would break the sync throw
 * semantics that the sync overload guarantees.
 *
 * Same auto-replay + seed-capture contract as the sync version.
 */
export async function assertPropertyAsync<Ts>(
  name: string,
  property: fc.IRawProperty<Ts, true>,
  params: AssertPropertyOptions<Ts> = {},
): Promise<void> {
  const callerStack = new Error().stack;
  const displayName = params.displayName ?? name;
  const ctx: FailureContext = {
    argNames: params.argNames,
    invariant: params.invariant,
    renderInputs: params.renderInputs,
  };

  const replay = resolveReplayParams(displayName);
  if (replay) {
    const replayResult = (await fc.check(property, {
      ...params,
      seed: replay.seed,
      path: replay.path,
      endOnFailure: true,
      numRuns: 1,
    })) as fc.RunDetails<Ts>;
    if (replayResult.failed || (replayResult as { interrupted?: boolean }).interrupted) {
      handleRunDetails(displayName, replayResult, ctx, callerStack, "replay");
      return;
    }
    clearSeed(displayName);
  }

  const result = (await fc.check(property, params)) as fc.RunDetails<Ts>;
  handleRunDetails(displayName, result, ctx, callerStack, "fresh");
}

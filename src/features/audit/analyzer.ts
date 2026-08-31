import type { Issue, Language } from "./types";

/**
 * Heuristic static analyzer. Not a full compiler — pattern-matches the
 * most common syntax slips, logic anti-patterns, and perf footguns per
 * language so the Auditor can offer deterministic one-click fixes.
 *
 * Each rule returns an Issue with a `match` + `replacement` pair the UI
 * applies verbatim to the source; if `match` cannot be found the fix
 * silently no-ops instead of guessing.
 */
type Rule = (source: string) => Issue[];

let counter = 0;
const uid = () => `iss-${++counter}`;

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function pushMatches(
  source: string,
  re: RegExp,
  build: (m: RegExpExecArray) => Omit<Issue, "id" | "line"> & { line?: number },
): Issue[] {
  const out: Issue[] = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(source)) !== null) {
    const built = build(m);
    out.push({ id: uid(), line: built.line ?? lineOf(source, m.index), ...built });
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}

/* ------------------------------------------------------- JS / TS rules */

const jsRules: Rule[] = [
  (src) =>
    pushMatches(src, /([^=!<>])==([^=])/g, (m) => ({
      severity: "warning",
      category: "logic",
      title: "Loose equality (==) — prefer strict (===)",
      rootCause:
        "`==` performs type coercion (`0 == '0'` is true, `null == undefined` is true). Strict equality (`===`) compares value AND type, avoiding a whole class of hard-to-trace bugs.",
      match: `${m[1]}==${m[2]}`,
      replacement: `${m[1]}===${m[2]}`,
      fixLabel: "Replace with ===",
    })),
  (src) =>
    pushMatches(src, /([^=!<>])!=([^=])/g, (m) => ({
      severity: "warning",
      category: "logic",
      title: "Loose inequality (!=) — prefer strict (!==)",
      rootCause: "`!=` coerces types before comparing; `!==` is the safe form.",
      match: `${m[1]}!=${m[2]}`,
      replacement: `${m[1]}!==${m[2]}`,
      fixLabel: "Replace with !==",
    })),
  (src) =>
    pushMatches(src, /\bvar\s+([a-zA-Z_$][\w$]*)\b/g, (m) => ({
      severity: "warning",
      category: "style",
      title: `\`var ${m[1]}\` — use \`let\` or \`const\``,
      rootCause:
        "`var` is function-scoped and hoisted, which causes unexpected shadowing. `const` (or `let` when reassignment is needed) is block-scoped and safer.",
      match: m[0],
      replacement: `const ${m[1]}`,
      fixLabel: "Convert to const",
    })),
  (src) =>
    pushMatches(src, /^[ \t]*console\.log\(/gm, (m) => ({
      severity: "info",
      category: "style",
      title: "Stray console.log()",
      rootCause: "Leftover debug logging ships to production and leaks state.",
      match: m[0],
      replacement: `// ${m[0].trimStart()}`,
      fixLabel: "Comment out",
    })),
  (src) =>
    pushMatches(
      src,
      /for\s*\(\s*var\s+(\w+)\s*=\s*(\d+)\s*;\s*\1\s*<\s*(\w+)\.length\s*;\s*\1\+\+\s*\)/g,
      (m) => ({
        severity: "warning",
        category: "performance",
        title: `Re-evaluates \`${m[3]}.length\` every iteration`,
        rootCause:
          "Reading `.length` inside the condition forces a property lookup on every pass. Cache it once and switch `var` to `let` for block scope.",
        match: m[0],
        replacement: `for (let ${m[1]} = ${m[2]}, len = ${m[3]}.length; ${m[1]} < len; ${m[1]}++)`,
        fixLabel: "Cache length + use let",
      }),
    ),
  (src) =>
    pushMatches(src, /setTimeout\(\s*(['"])(.+?)\1\s*,/g, (m) => ({
      severity: "error",
      category: "logic",
      title: "setTimeout() called with a string — implicit eval",
      rootCause:
        "Passing a string to setTimeout invokes the JS parser at runtime (like `eval`). It is slow, breaks CSP, and drops the surrounding lexical scope.",
      match: m[0],
      replacement: `setTimeout(() => { ${m[2]} },`,
      fixLabel: "Wrap in arrow function",
    })),
  (src) =>
    pushMatches(src, /JSON\.parse\(\s*(['"])([^'"]*?,\s*[\]}])\1\s*\)/g, (m) => ({
      severity: "error",
      category: "syntax",
      title: "Trailing comma inside JSON.parse() input",
      rootCause:
        "JSON does not allow trailing commas. `JSON.parse` will throw `SyntaxError` at runtime.",
      match: m[0],
      replacement: `JSON.parse(${m[1]}${m[2].replace(/,(\s*[\]}])/g, "$1")}${m[1]})`,
      fixLabel: "Remove trailing comma",
    })),
];

/* ---------------------------------------------------------- Python rules */

const pyRules: Rule[] = [
  (src) =>
    pushMatches(src, /^[ \t]*print\s+([^(\n][^\n]*)$/gm, (m) => ({
      severity: "error",
      category: "syntax",
      title: "Python 2 `print` statement",
      rootCause: "`print` is a function in Python 3; the statement form raises SyntaxError.",
      match: m[0],
      replacement: m[0].replace(/print\s+(.*)$/, "print($1)"),
      fixLabel: "Wrap in print(...)",
    })),
  (src) =>
    pushMatches(src, /==\s*None\b/g, () => ({
      severity: "warning",
      category: "style",
      title: "Comparison to None with ==",
      rootCause:
        "PEP 8 requires `is None` / `is not None`. `==` invokes `__eq__` and can be overridden on custom classes.",
      match: "== None",
      replacement: "is None",
      fixLabel: "Use `is None`",
    })),
  (src) =>
    pushMatches(src, /def\s+(\w+)\s*\(([^)]*=\s*(?:\[\]|\{\}))[^)]*\)\s*:/g, (m) => ({
      severity: "error",
      category: "logic",
      title: `Mutable default argument in \`${m[1]}()\``,
      rootCause:
        "Default arguments are evaluated ONCE at function definition. A mutable default (`[]`, `{}`) is shared across every call — a classic source of accidental state leaks.",
      match: m[0],
      replacement: m[0].replace(/=\s*\[\]/g, "=None").replace(/=\s*\{\}/g, "=None"),
      fixLabel: "Default to None",
    })),
];

/* ------------------------------------------------------------ Java rules */

const javaRules: Rule[] = [
  (src) =>
    pushMatches(src, /(\w+)\s*==\s*"([^"\n]*)"/g, (m) => ({
      severity: "error",
      category: "logic",
      title: "String comparison with `==` — use `.equals()`",
      rootCause:
        "`==` compares object references in Java. Two strings with the same characters can be different instances (e.g. from user input) and `==` returns false. `.equals()` compares content.",
      match: m[0],
      replacement: `"${m[2]}".equals(${m[1]})`,
      fixLabel: "Use .equals()",
    })),
  (src) =>
    pushMatches(src, /catch\s*\(\s*Exception\s+(\w+)\s*\)/g, (m) => ({
      severity: "warning",
      category: "style",
      title: "Catching bare `Exception`",
      rootCause:
        "Catching `Exception` swallows every checked and runtime exception including `NullPointerException`. Catch the specific type you can actually recover from.",
      match: m[0],
      replacement: `catch (RuntimeException ${m[1]})`,
      fixLabel: "Narrow to RuntimeException",
    })),
  (src) =>
    pushMatches(src, /^[ \t]*System\.out\.println\(/gm, (m) => ({
      severity: "info",
      category: "style",
      title: "Stray System.out.println()",
      rootCause: "Debug prints ship to production and bypass structured logging.",
      match: m[0],
      replacement: `// ${m[0].trimStart()}`,
      fixLabel: "Comment out",
    })),
];

/* ------------------------------------------------------------- C# rules */

const csharpRules: Rule[] = [
  (src) =>
    pushMatches(src, /(\w+)\s*==\s*null\b/g, (m) => ({
      severity: "info",
      category: "style",
      title: "`== null` — prefer pattern `is null`",
      rootCause:
        "`is null` cannot be overridden by an `==` operator overload, so it always tests reference identity. Modern C# style guides recommend it.",
      match: m[0],
      replacement: `${m[1]} is null`,
      fixLabel: "Use `is null`",
    })),
  (src) =>
    pushMatches(src, /^[ \t]*Console\.WriteLine\(/gm, (m) => ({
      severity: "info",
      category: "style",
      title: "Stray Console.WriteLine()",
      rootCause: "Debug prints ship to production and bypass ILogger.",
      match: m[0],
      replacement: `// ${m[0].trimStart()}`,
      fixLabel: "Comment out",
    })),
  (src) =>
    pushMatches(src, /new\s+System\.Collections\.ArrayList\s*\(\s*\)/g, (m) => ({
      severity: "warning",
      category: "performance",
      title: "Non-generic `ArrayList` — use `List<T>`",
      rootCause:
        "`ArrayList` boxes value types and loses compile-time type safety. `List<T>` is generic, faster, and checked at compile time.",
      match: m[0],
      replacement: "new System.Collections.Generic.List<object>()",
      fixLabel: "Convert to List<object>",
    })),
];

/* --------------------------------------------------------------- Go rules */

const goRules: Rule[] = [
  (src) =>
    pushMatches(src, /\binterface\{\}/g, () => ({
      severity: "info",
      category: "style",
      title: "`interface{}` — use `any` alias (Go 1.18+)",
      rootCause:
        "`any` is a built-in alias for `interface{}` since Go 1.18 and is now the idiomatic spelling.",
      match: "interface{}",
      replacement: "any",
      fixLabel: "Replace with any",
    })),
  (src) =>
    pushMatches(
      src,
      /for\s+(\w+)\s*:=\s*0\s*;\s*\1\s*<\s*len\((\w+)\)\s*;\s*\1\+\+\s*\{/g,
      (m) => ({
        severity: "info",
        category: "style",
        title: "C-style loop over a slice — use `for range`",
        rootCause:
          "`for i, v := range xs` is the idiomatic Go form and avoids repeated `len()` calls.",
        match: m[0],
        replacement: `for ${m[1]}, v := range ${m[2]} {`,
        fixLabel: "Convert to for-range",
      }),
    ),
  (src) =>
    pushMatches(src, /^[ \t]*fmt\.Println\(/gm, (m) => ({
      severity: "info",
      category: "style",
      title: "Stray fmt.Println()",
      rootCause: "Debug prints ship to production and bypass structured logging (log/slog).",
      match: m[0],
      replacement: `// ${m[0].trimStart()}`,
      fixLabel: "Comment out",
    })),
];

/* ------------------------------------------------------------- Rust rules */

const rustRules: Rule[] = [
  (src) =>
    pushMatches(src, /\.unwrap\(\)/g, () => ({
      severity: "warning",
      category: "logic",
      title: "`.unwrap()` panics on `Err`/`None`",
      rootCause:
        '`.unwrap()` aborts the process on failure. Prefer `?` to propagate the error, or `.expect("reason")` if you truly cannot fail here — future readers will thank you.',
      match: ".unwrap()",
      replacement: '.expect("TODO: describe the invariant")',
      fixLabel: "Convert to .expect(...)",
    })),
  (src) =>
    pushMatches(src, /^[ \t]*println!\(/gm, (m) => ({
      severity: "info",
      category: "style",
      title: "Stray println!()",
      rootCause: "Debug prints ship to production; prefer the `log` or `tracing` crate.",
      match: m[0],
      replacement: `// ${m[0].trimStart()}`,
      fixLabel: "Comment out",
    })),
];

/* ------------------------------------------------------------- Ruby rules */

const rubyRules: Rule[] = [
  (src) =>
    pushMatches(src, /(\w+)\s*==\s*nil\b/g, (m) => ({
      severity: "info",
      category: "style",
      title: "`== nil` — use `.nil?`",
      rootCause:
        "`.nil?` is the idiomatic Ruby nil check and cannot be shadowed by a custom `==` implementation.",
      match: m[0],
      replacement: `${m[1]}.nil?`,
      fixLabel: "Use .nil?",
    })),
  (src) =>
    pushMatches(src, /rescue\s+Exception\b/g, () => ({
      severity: "error",
      category: "logic",
      title: "`rescue Exception` — swallows SystemExit / Interrupt",
      rootCause:
        "`Exception` is the root of Ruby's exception hierarchy and includes `SystemExit`, `Interrupt`, and `NoMemoryError`. Rescue `StandardError` (the default when omitted) instead.",
      match: "rescue Exception",
      replacement: "rescue StandardError",
      fixLabel: "Narrow to StandardError",
    })),
  (src) =>
    pushMatches(src, /^[ \t]*puts\s+/gm, (m) => ({
      severity: "info",
      category: "style",
      title: "Stray `puts`",
      rootCause: "Debug output belongs in a logger, not stdout, once the code ships.",
      match: m[0],
      replacement: `# ${m[0].trimStart()}`,
      fixLabel: "Comment out",
    })),
];

/* --------------------------------------------------------------- PHP rules */

const phpRules: Rule[] = [
  (src) =>
    pushMatches(src, /(\$\w+)\s*==\s*("([^"\n]*)"|'([^'\n]*)')/g, (m) => ({
      severity: "warning",
      category: "logic",
      title: "Loose equality (==) — prefer strict (===)",
      rootCause:
        'PHP\'s `==` type-juggles (`"0" == false` is true, `"abc" == 0` was true before PHP 8). `===` compares value AND type.',
      match: m[0],
      replacement: `${m[1]} === ${m[2]}`,
      fixLabel: "Replace with ===",
    })),
  (src) =>
    pushMatches(src, /\bmysql_query\s*\(/g, () => ({
      severity: "error",
      category: "syntax",
      title: "`mysql_*` removed in PHP 7",
      rootCause:
        "The `mysql_*` extension was deprecated in PHP 5.5 and removed in 7.0. Use `mysqli_query` (procedural) or PDO with prepared statements.",
      match: "mysql_query(",
      replacement: "mysqli_query($conn, ",
      fixLabel: "Convert to mysqli_query",
    })),
  (src) =>
    pushMatches(src, /^[ \t]*var_dump\(/gm, (m) => ({
      severity: "info",
      category: "style",
      title: "Stray var_dump()",
      rootCause: "Debug output ships to production and can leak secrets.",
      match: m[0],
      replacement: `// ${m[0].trimStart()}`,
      fixLabel: "Comment out",
    })),
];

/* --------------------------------------------------------------- SQL rules */

const sqlRules: Rule[] = [
  (src) =>
    pushMatches(src, /SELECT\s+\*\s+FROM\s+(\w+)/gi, (m) => ({
      severity: "warning",
      category: "performance",
      title: "`SELECT *` — enumerate columns instead",
      rootCause:
        "`SELECT *` pulls every column, wastes I/O, and breaks silently when the schema changes. List the columns you actually need.",
      match: m[0],
      replacement: `SELECT /* columns */ FROM ${m[1]}`,
      fixLabel: "List columns",
    })),
  (src) =>
    pushMatches(src, /UPDATE\s+(\w+)\s+SET\s+([^;\n]+?)(;|$)/gi, (m) => {
      if (/\bWHERE\b/i.test(m[2]))
        return {
          severity: "info" as const,
          category: "style" as const,
          title: "",
          rootCause: "",
          match: "",
          replacement: "",
        };
      return {
        severity: "error",
        category: "logic",
        title: `UPDATE on \`${m[1]}\` without WHERE — rewrites every row`,
        rootCause:
          "An UPDATE with no WHERE clause modifies every row in the table. Almost always a bug; add a WHERE clause or wrap in a transaction and use LIMIT.",
        match: m[0],
        replacement: `UPDATE ${m[1]} SET ${m[2].trim()} WHERE /* condition */${m[3]}`,
        fixLabel: "Add WHERE clause",
      };
    }).filter((i) => i.title !== ""),
  (src) =>
    pushMatches(src, /DELETE\s+FROM\s+(\w+)\s*(;|$)/gi, (m) => ({
      severity: "error",
      category: "logic",
      title: `DELETE from \`${m[1]}\` without WHERE — empties the table`,
      rootCause:
        "A DELETE with no WHERE clause removes every row. Add a WHERE clause, or use TRUNCATE explicitly if that is intended.",
      match: m[0],
      replacement: `DELETE FROM ${m[1]} WHERE /* condition */${m[2]}`,
      fixLabel: "Add WHERE clause",
    })),
];

const RULES: Record<Language, Rule[]> = {
  javascript: jsRules,
  typescript: jsRules,
  python: pyRules,
  java: javaRules,
  csharp: csharpRules,
  go: goRules,
  rust: rustRules,
  ruby: rubyRules,
  php: phpRules,
  sql: sqlRules,
};

export function analyze(source: string, language: Language): Issue[] {
  counter = 0;
  const rules = RULES[language] ?? [];
  const found = rules.flatMap((r) => r(source));
  const rank: Record<Issue["severity"], number> = { error: 0, warning: 1, info: 2 };
  return found.sort((a, b) => rank[a.severity] - rank[b.severity] || a.line - b.line);
}

export function applyFix(source: string, issue: Issue): string {
  const idx = source.indexOf(issue.match);
  if (idx === -1) return source;
  return source.slice(0, idx) + issue.replacement + source.slice(idx + issue.match.length);
}

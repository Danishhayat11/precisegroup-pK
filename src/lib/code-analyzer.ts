// Lightweight heuristic code analyzer for JavaScript / TypeScript.
// Not a real parser — pattern-based checks that catch common bugs,
// bad practices, and perf smells. Returns findings + a refactored version.

export type Severity = "error" | "warning" | "perf";

export interface Finding {
  id: string;
  line: number;
  severity: Severity;
  category: "Syntax" | "Logic" | "Performance" | "Style";
  problem: string;
  solution: string;
}

export interface AnalysisResult {
  findings: Finding[];
  refactored: string;
  stats: { errors: number; warnings: number; perf: number };
}

interface Rule {
  id: string;
  category: Finding["category"];
  severity: Severity;
  test: (line: string) => boolean;
  problem: string;
  solution: string;
  fix?: (line: string) => string;
}

const RULES: Rule[] = [
  {
    id: "loose-equality",
    category: "Logic",
    severity: "warning",
    test: (l) => /[^=!<>]==[^=]/.test(l) || /[^=!<>]!=[^=]/.test(l),
    problem: "Loose equality (== / !=) performs type coercion and can hide bugs.",
    solution: "Use strict equality (=== / !==) for predictable comparisons.",
    fix: (l) => l.replace(/([^=!<>])==([^=])/g, "$1===$2").replace(/([^=!<>])!=([^=])/g, "$1!==$2"),
  },
  {
    id: "var-decl",
    category: "Style",
    severity: "warning",
    test: (l) => /^\s*var\s+/.test(l),
    problem: "`var` is function-scoped and leaks out of blocks.",
    solution: "Prefer `const`, or `let` when reassignment is needed.",
    fix: (l) => l.replace(/^(\s*)var(\s+)/, "$1let$2"),
  },
  {
    id: "console-log",
    category: "Style",
    severity: "warning",
    test: (l) => /console\.log\(/.test(l) && !/\/\//.test(l.split("console.log")[0] ?? ""),
    problem: "Debug `console.log` left in production code.",
    solution: "Remove the log or gate it behind a logger.",
    fix: (l) =>
      `// ${l.trimStart()}`.padStart(
        l.length - l.trimStart().length + `// ${l.trimStart()}`.length,
      ),
  },
  {
    id: "eval",
    category: "Logic",
    severity: "error",
    test: (l) => /\beval\s*\(/.test(l),
    problem: "`eval()` executes arbitrary code and is a critical security risk.",
    solution: "Replace with a safe parser (JSON.parse, Function map, etc.).",
  },
  {
    id: "assign-in-if",
    category: "Logic",
    severity: "error",
    test: (l) => /\bif\s*\([^)]*[^=!<>]=[^=][^)]*\)/.test(l),
    problem: "Assignment inside an `if` condition — likely a typo for `===`.",
    solution: "Use `===` to compare instead of `=` to assign.",
    fix: (l) => l.replace(/(\bif\s*\([^)]*[^=!<>])=([^=])/, "$1===$2"),
  },
  {
    id: "missing-semicolon",
    category: "Syntax",
    severity: "warning",
    test: (l) => {
      const t = l.trim();
      if (!t) return false;
      if (/^(if|else|for|while|switch|function|class|try|catch|finally|do)\b/.test(t)) return false;
      if (/[;{}:,]\s*$/.test(t)) return false;
      if (/^(\/\/|\/\*|\*)/.test(t)) return false;
      if (/^[)\]}]/.test(t)) return false;
      return /^(const|let|var|return|throw|import|export)\b/.test(t);
    },
    problem: "Statement is missing a trailing semicolon.",
    solution: "Append `;` to make statement boundaries explicit.",
    fix: (l) => l.replace(/\s*$/, ";"),
  },
  {
    id: "length-in-for",
    category: "Performance",
    severity: "perf",
    test: (l) => /for\s*\([^;]*;\s*[^;]*\.length\s*;/.test(l),
    problem: "`.length` is recomputed on every iteration of the loop.",
    solution: "Cache `.length` in a local variable before the loop.",
  },
  {
    id: "array-in-render",
    category: "Performance",
    severity: "perf",
    test: (l) => /\.map\([^)]*\)\.filter\(/.test(l) || /\.filter\([^)]*\)\.map\(/.test(l),
    problem: "Chained `.map().filter()` walks the array twice.",
    solution: "Combine into a single `.reduce()` or reorder to filter first.",
  },
  {
    id: "double-equals-null",
    category: "Logic",
    severity: "warning",
    test: (l) => /===\s*undefined\b/.test(l),
    problem: "Explicit `=== undefined` misses `null`.",
    solution: "Use `== null` to catch both `null` and `undefined`.",
    fix: (l) => l.replace(/===\s*undefined/g, "== null"),
  },
  {
    id: "trailing-whitespace",
    category: "Style",
    severity: "warning",
    test: (l) => /\s+$/.test(l) && l.trim().length > 0,
    problem: "Trailing whitespace at end of line.",
    solution: "Trim trailing spaces.",
    fix: (l) => l.replace(/\s+$/, ""),
  },
];

export function analyze(source: string): AnalysisResult {
  const lines = source.split("\n");
  const findings: Finding[] = [];
  const fixedLines = [...lines];

  lines.forEach((line, idx) => {
    RULES.forEach((rule) => {
      if (rule.test(line)) {
        findings.push({
          id: `${rule.id}-${idx}`,
          line: idx + 1,
          severity: rule.severity,
          category: rule.category,
          problem: rule.problem,
          solution: rule.solution,
        });
        if (rule.fix) {
          fixedLines[idx] = rule.fix(fixedLines[idx]);
        }
      }
    });
  });

  // Bracket balance check
  const openC = (source.match(/\{/g) ?? []).length;
  const closeC = (source.match(/\}/g) ?? []).length;
  if (openC !== closeC) {
    findings.push({
      id: "brace-mismatch",
      line: lines.length,
      severity: "error",
      category: "Syntax",
      problem: `Unbalanced braces — ${openC} \`{\` vs ${closeC} \`}\`.`,
      solution: "Close every opened block; check nested functions and objects.",
    });
  }
  const openP = (source.match(/\(/g) ?? []).length;
  const closeP = (source.match(/\)/g) ?? []).length;
  if (openP !== closeP) {
    findings.push({
      id: "paren-mismatch",
      line: lines.length,
      severity: "error",
      category: "Syntax",
      problem: `Unbalanced parentheses — ${openP} \`(\` vs ${closeP} \`)\`.`,
      solution: "Balance opening and closing parentheses.",
    });
  }

  const stats = {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    perf: findings.filter((f) => f.severity === "perf").length,
  };

  return { findings, refactored: fixedLines.join("\n"), stats };
}

// Minimal JS/TS syntax highlighter → HTML string.
// Order matters: comments/strings first, then keywords/numbers.
const KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "new",
  "this",
  "class",
  "extends",
  "super",
  "import",
  "export",
  "from",
  "as",
  "default",
  "try",
  "catch",
  "finally",
  "throw",
  "typeof",
  "instanceof",
  "in",
  "of",
  "await",
  "async",
  "yield",
  "static",
  "true",
  "false",
  "null",
  "undefined",
  "void",
]);

export function highlight(source: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const tokens: string[] = [];
  const re =
    /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`)|('(?:\\.|[^'\\])*')|("(?:\\.|[^"\\])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+)|([^\w\s])/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const [full, lc, bc, tpl, sq, dq, num, ident, ws, punct] = m;
    if (lc || bc) tokens.push(`<span class="tok-com">${esc(full)}</span>`);
    else if (tpl || sq || dq) tokens.push(`<span class="tok-str">${esc(full)}</span>`);
    else if (num) tokens.push(`<span class="tok-num">${esc(full)}</span>`);
    else if (ident) {
      if (KEYWORDS.has(ident)) tokens.push(`<span class="tok-kw">${esc(ident)}</span>`);
      else tokens.push(esc(ident));
    } else if (ws) tokens.push(full);
    else if (punct) tokens.push(`<span class="tok-pun">${esc(full)}</span>`);
    else tokens.push(esc(full));
  }
  return tokens.join("");
}

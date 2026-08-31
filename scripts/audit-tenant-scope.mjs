#!/usr/bin/env node
/**
 * Tenant-Scope Audit
 *
 * Defence-in-depth check that every CLIENT-SIDE Supabase query against a
 * tenant-scoped table (any table with a `company_id` column) is filtered by
 * `company_id`. RLS already enforces isolation on the server; this audit
 * catches accidental cross-tenant reads before they ship.
 *
 * A call site passes if any of the following is true within its statement:
 *   - `.eq('company_id', ...)` / `.eq("company_id", ...)`
 *   - `.in('company_id', ...)` / `.match({ company_id: ... })`
 *   - `.filter('company_id', ...)`
 *   - the row inserted/upserted has a `company_id` property
 *   - the call is a Realtime channel filter that pins `company_id=`
 *   - explicit opt-out marker comment `// tenant-scope-audit: ignore` on
 *     the previous line (used for admin-only reads that intentionally span
 *     tenants)
 *
 * Exits with code 1 if any offending call site is found — wire into CI.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

// Tables with a company_id column. Kept in sync with the DB via the migration
// that adds/removes company_id. The full list is duplicated here so this
// script needs no DB connection to run in CI.
const TENANT_TABLES = new Set([
  "adjustments",
  "ai_tool_call_log",
  "app_settings",
  "assistant_messages",
  "audit_logs",
  "audit_reviewed_issues",
  "booking_documents",
  "bookings",
  "clients",
  "company_invitations",
  "construction_costs",
  "construction_project_budgets",
  "crm_leads",
  "dealers",
  "erp_action_log",
  "hr_attendance",
  "hr_employees",
  "hr_final_settlements",
  "hr_payroll_runs",
  "hr_payslips",
  "import_validation_audit",
  "installment_ledger",
  "maintenance_charges",
  "maintenance_expenses",
  "maintenance_payments",
  "maintenance_schedules",
  "office_expenses",
  "payment_allocations",
  "payment_comments",
  "payment_edit_history",
  "payments",
  "plan_restructure_history",
  "profiles",
  "projects",
  "tenant_scope_logs",
  "units",
  "user_roles",
]);

// Files/paths that run server-side and are exempt (RLS runs as the user OR as
// service role with an explicit admin check — both handled elsewhere).
const SERVER_SUFFIXES = [".server.ts", ".server.tsx", ".functions.ts", ".functions.tsx"];
const SKIP_DIRS = new Set(["__tests__", "node_modules", "integrations"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full, out);
    } else if (/\.(t|j)sx?$/.test(entry)) {
      if (SERVER_SUFFIXES.some((s) => entry.endsWith(s))) continue;
      // Server-route files under src/routes/api/** are server-only.
      if (full.includes(`${join("routes", "api")}${join("/")}`)) continue;
      out.push(full);
    }
  }
  return out;
}

const IGNORE_MARKER = /tenant-scope-audit:\s*ignore/;

/**
 * Extract the "statement" starting at `.from(table)` — everything up to the
 * next top-level `;`. Naive but sufficient for the chain-style Supabase
 * builder pattern we use.
 */
function statementAfter(src, startIdx) {
  let depth = 0;
  let inStr = null;
  let end = src.length;
  for (let i = startIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === ";" && depth <= 0) {
      end = i;
      break;
    } else if (c === "\n" && depth <= 0) {
      // Peek — if next non-space char is not a chain `.`, treat newline as end.
      let j = i + 1;
      while (j < src.length && /[ \t]/.test(src[j])) j++;
      if (src[j] !== "." && src[j] !== "," && src[j] !== ")" && src[j] !== "}") {
        // still might continue if we're inside brackets; already handled.
      }
    }
  }
  return src.slice(startIdx, end);
}

function hasCompanyIdFilter(stmt) {
  if (/\.(eq|in|filter|match)\(\s*["'`]company_id["'`]/.test(stmt)) return true;
  if (/\bcompany_id\s*:\s*/.test(stmt)) return true; // insert/update payload
  if (/\.match\(\s*\{\s*[^}]*company_id/.test(stmt)) return true;
  if (/company_id=eq\./.test(stmt)) return true; // realtime channel filter
  return false;
}

const CHANNEL_INTENT = /\.channel\(|postgres_changes/;

const results = { ok: [], violations: [], byTable: {} };
const files = walk(SRC);

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const re = /supabase\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const table = m[1];
    if (!TENANT_TABLES.has(table)) continue;
    const beforeIdx = src.lastIndexOf("\n", m.index);
    const lineNo = src.slice(0, m.index).split("\n").length;
    const prevLine = lines[lineNo - 2] ?? "";
    if (IGNORE_MARKER.test(prevLine)) continue;

    const stmt = statementAfter(src, beforeIdx);
    const passed =
      hasCompanyIdFilter(stmt) || CHANNEL_INTENT.test(stmt) === false
        ? hasCompanyIdFilter(stmt)
        : hasCompanyIdFilter(stmt);
    const record = {
      file: relative(ROOT, file),
      line: lineNo,
      table,
      snippet: lines[lineNo - 1].trim().slice(0, 160),
    };
    (passed ? results.ok : results.violations).push(record);
    results.byTable[table] = results.byTable[table] || { ok: 0, bad: 0 };
    results.byTable[table][passed ? "ok" : "bad"]++;
  }
}

const totalOk = results.ok.length;
const totalBad = results.violations.length;

// Baseline: today's known violations are grandfathered so CI can enforce the
// rule against NEW code without a big-bang rewrite. Run with `--update-baseline`
// after intentionally migrating a call site.
const BASELINE_PATH = join(ROOT, ".tenant-scope-audit-baseline.json");
const key = (v) => `${v.file}:${v.table}`;
let baseline = new Set();
try {
  const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  baseline = new Set(raw.violations ?? []);
} catch {
  /* no baseline yet */
}

if (process.argv.includes("--update-baseline")) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        note: "Grandfathered tenant-scope violations. Delete an entry after adding a company_id filter to that file's queries on that table.",
        updatedAt: new Date().toISOString(),
        violations: [...new Set(results.violations.map(key))].sort(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Wrote baseline with ${results.violations.length} entries to ${relative(ROOT, BASELINE_PATH)}`,
  );
  process.exit(0);
}

const newViolations = results.violations.filter((v) => !baseline.has(key(v)));
const grandfathered = results.violations.length - newViolations.length;

console.log(`\nTenant-Scope Audit — ${totalOk + totalBad} client-side queries on tenant tables`);
console.log(`  ✓ ${totalOk} include company_id filter`);
console.log(`  · ${grandfathered} pre-existing (grandfathered by baseline)`);
console.log(`  ✗ ${newViolations.length} NEW violations without company_id filter\n`);

if (newViolations.length > 0) {
  console.log(
    "New violations — add a .eq('company_id', companyId) filter, use tenantFrom(), or ignore with `// tenant-scope-audit: ignore`:",
  );
  for (const v of newViolations) {
    console.log(`  ${v.file}:${v.line}  [${v.table}]  ${v.snippet}`);
  }
}

mkdirSync(join(ROOT, "reports"), { recursive: true });
writeFileSync(
  join(ROOT, "reports", "tenant-scope-audit.json"),
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      totalOk,
      totalBad,
      grandfathered,
      newViolations: newViolations.length,
      ...results,
    },
    null,
    2,
  ),
);

process.exit(newViolations.length === 0 ? 0 : 1);

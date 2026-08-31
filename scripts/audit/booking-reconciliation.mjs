#!/usr/bin/env node
/**
 * Generic live cross-check for a booking's reconciled snapshot.
 *
 * Compares three sources of truth for the booking:
 *   1. Pinned expectations  — scripts/audit/expectations/<BOOKING>.json
 *   2. Live `installment_ledger` rows (sum of dues / paid, overdue recompute)
 *   3. Cached `bookings` row (cash_received, remaining_balance, overdue)
 *
 * Exits non-zero with a diff table if any source disagrees. When
 * $GITHUB_STEP_SUMMARY is set, also writes a markdown job summary.
 *
 * Usage:
 *   node scripts/audit/booking-reconciliation.mjs <BOOKING_ID>
 *   node scripts/audit/booking-reconciliation.mjs --booking BK-MA-00014
 *   node scripts/audit/booking-reconciliation.mjs --expectations path/to/file.json
 */
import { appendFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateExpectations } from "./expectations-schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPECTATIONS_DIR = join(__dirname, "expectations");

export function listPinnedBookings(dir = EXPECTATIONS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => {
      const path = join(dir, f);
      const id = f.replace(/\.json$/, "");
      let label = "";
      let valid = true;
      try {
        const doc = JSON.parse(readFileSync(path, "utf8"));
        label = doc.label || "";
        if (doc.booking_id && doc.booking_id !== id) valid = false;
      } catch {
        valid = false;
      }
      return { id, label, path, valid };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

const BOOKING_ID_RE = /^[A-Z]{2,6}-[A-Z0-9]{1,8}-\d{3,8}$/;

function printHelp(stream = process.stdout) {
  const lines = [
    "Usage: node scripts/audit/booking-reconciliation.mjs <BOOKING_ID> [options]",
    "",
    "Cross-checks a booking's cached `bookings` row and `installment_ledger`",
    "rows against pinned expectations in scripts/audit/expectations/<ID>.json.",
    "Exits non-zero (with a diff table) on any mismatch.",
    "",
    "Arguments:",
    "  <BOOKING_ID>                  Booking ID, e.g. BK-MA-00014. Looks up",
    "                                scripts/audit/expectations/<BOOKING_ID>.json.",
    "",
    "Options:",
    "  -b, --booking <ID>            Same as positional <BOOKING_ID>.",
    "  -e, --expectations <path>     Use an explicit expectations JSON file",
    "                                instead of the default lookup.",
    "  -l, --list                    List every pinned booking under",
    "                                scripts/audit/expectations/*.json and exit.",
    "      --strict                  Treat a missing expectations file as a hard",
    "                                failure (exit 2). This is the default.",
    "      --no-strict               Treat a missing expectations file as a",
    "                                non-blocking warning (exit 0, prints",
    "                                `::warning`). Useful for feature branches.",
    "  -h, --help                    Show this help and exit.",
    "",
    "Environment:",
    "  AUDIT_STRICT=0|false|no       Same effect as --no-strict. Explicit",
    "                                --strict / --no-strict on the CLI wins.",
    "  AUDIT_STRICT=1|true|yes       Same effect as --strict (default).",
    "",
    "Examples:",
    "  node scripts/audit/booking-reconciliation.mjs BK-MA-00014",
    "  node scripts/audit/booking-reconciliation.mjs --list",
    "  node scripts/audit/booking-reconciliation.mjs --booking BK-MA-00015",
    "  node scripts/audit/booking-reconciliation.mjs -e ./my-snapshot.json",
    "  AUDIT_STRICT=0 node scripts/audit/booking-reconciliation.mjs BK-XX-99999",
    "",
    "Exit codes:",
    "  0  ok, help/list printed, or missing expectations under --no-strict",
    "  1  live data drifted from the pinned expectations (diff printed)",
    "  2  usage error, invalid ID, malformed expectations, or missing file",
    "     (the missing-file case is downgraded to 0 under --no-strict; all",
    "     other exit-2 cases ignore strict mode and always hard-fail).",
    "  3  infrastructure failure — psql missing or DB unreachable. Set",
    "     SUPABASE_DB_URL / PGHOST and retry; not a data or config bug.",
  ];
  stream.write(lines.join("\n") + "\n");
}

function parseStrictEnv(val) {
  if (val == null || val === "") return null;
  const v = String(val).trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(v)) return false;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  return null;
}

function parseArgs(argv) {
  const args = {
    booking: null,
    expectations: null,
    help: false,
    list: false,
    strict: null, // null = unset (env / default applies)
    _unknown: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") args.help = true;
    else if (a === "-l" || a === "--list") args.list = true;
    else if (a === "--strict") args.strict = true;
    else if (a === "--no-strict") args.strict = false;
    else if (a === "--booking" || a === "-b") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) return { ...args, _error: `${a} requires a value` };
      args.booking = v;
    } else if (a === "--expectations" || a === "-e") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) return { ...args, _error: `${a} requires a value` };
      args.expectations = v;
    } else if (!a.startsWith("-") && !args.booking) {
      args.booking = a;
    } else {
      args._unknown.push(a);
    }
  }
  return args;
}

function resolveStrict(cliStrict) {
  if (cliStrict !== null) return cliStrict; // explicit flag wins
  const envStrict = parseStrictEnv(process.env.AUDIT_STRICT);
  if (envStrict !== null) return envStrict;
  return true; // default: strict
}

export function runAudit({ booking, expectationsPath, strict = true } = {}) {
  if (!booking && !expectationsPath) {
    throw new Error("booking id (or expectations path) is required");
  }
  if (booking && !BOOKING_ID_RE.test(booking)) {
    console.error(
      `✗ invalid booking id: ${JSON.stringify(booking)} (expected pattern like BK-MA-00014)`,
    );
    printHelp(process.stderr);
    process.exit(2);
  }

  const expPath = expectationsPath || join(__dirname, "expectations", `${booking}.json`);
  if (!existsSync(expPath)) {
    if (!strict && !expectationsPath) {
      // Non-strict mode: surface as a GitHub-style warning and exit 0 so
      // CI feature-branch runs don't block on un-pinned contracts.
      console.warn(
        `::warning title=Audit not pinned::${booking} has no expectations file at ${expPath} (--no-strict, treating as warning)`,
      );
      process.exit(0);
    }
    console.error(`✗ expectations file not found: ${expPath}`);
    if (!expectationsPath) {
      console.error(
        `  Create scripts/audit/expectations/${booking}.json or pass --expectations <path>.`,
      );
      console.error(`  Pass --no-strict (or AUDIT_STRICT=0) to downgrade this to a warning.`);
      console.error(`  Run with --help for usage and an example snapshot path.`);
    }
    process.exit(2);
  }

  let expDoc;
  try {
    expDoc = JSON.parse(readFileSync(expPath, "utf8"));
  } catch (e) {
    console.error(`✗ expectations file is not valid JSON: ${expPath}\n  ${e.message}`);
    process.exit(2);
  }

  // Fail fast with a precise list of schema errors before we touch the DB.
  const { valid, errors } = validateExpectations(expDoc, {
    source: expPath,
    expectedBookingId: booking || undefined,
  });
  if (!valid) {
    console.error(`✗ expectations schema validation failed for ${expPath}:`);
    for (const e of errors) console.error(`    • ${e}`);
    process.exit(2);
  }

  const BK = booking || expDoc.booking_id;
  const EXPECTED = expDoc.expected || {};
  const LABEL = expDoc.label || "";

  function psql(sql) {
    const flat = sql.replace(/\s+/g, " ").trim();
    let out;
    try {
      out = execSync(`psql -At -F"|" -c ${JSON.stringify(flat)}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const stderr = (err.stderr || "").toString().trim();
      const status = typeof err.status === "number" ? err.status : "?";
      console.error(
        `✗ database connection failed (psql exit ${status}). ` +
          `Set SUPABASE_DB_URL / PGHOST and ensure psql is on PATH.`,
      );
      if (stderr) console.error(`  psql: ${stderr.split("\n")[0]}`);
      // Exit 3 = infrastructure failure. Distinct from 1 (drift) and 2 (config)
      // so CI can route it to "retry / fix runner" instead of "fix data" or
      // "fix the pin". See scripts/audit/README.md → CI interpretation.
      process.exit(3);
    }
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("|"));
  }

  const [bk] = psql(
    `SELECT cash_received, remaining_balance, total_contract_value,
            current_overdue_count, total_overdue_amount
       FROM bookings WHERE booking_id='${BK}'`,
  );
  if (!bk) {
    console.error(`✗ booking ${BK} not found`);
    process.exit(2);
  }
  const cached = {
    cash_received: Number(bk[0]),
    remaining_balance: Number(bk[1]),
    total_contract_value: Number(bk[2]),
    current_overdue_count: Number(bk[3]),
    total_overdue_amount: Number(bk[4]),
  };

  const ledger = psql(
    `SELECT particulars, due_amount, paid_amount, due_date
       FROM installment_ledger WHERE booking_id='${BK}' ORDER BY term_no`,
  ).map(([p, d, pd, dt]) => ({
    particulars: p,
    due: Number(d),
    paid: Number(pd),
    due_date: dt || null,
  }));

  const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
  const live = {
    installments_paid: sum(
      ledger.filter((r) => /^installment/i.test(r.particulars)),
      "paid",
    ),
    possession_paid: sum(
      ledger.filter((r) => /possession/i.test(r.particulars)),
      "paid",
    ),
    down_payment_paid: sum(
      ledger.filter((r) => /down payment/i.test(r.particulars)),
      "paid",
    ),
    cash_received: sum(ledger, "paid"),
    total_contract_value: sum(ledger, "due"),
    remaining_balance: sum(ledger, "due") - sum(ledger, "paid"),
  };
  const today = new Date().toISOString().slice(0, 10);
  const overdueRows = ledger.filter(
    (r) =>
      !/down payment|possession/i.test(r.particulars) &&
      r.due_date &&
      r.due_date < today &&
      Math.max(r.due - r.paid, 0) > 0,
  );
  live.current_overdue_count = overdueRows.length;
  live.total_overdue_amount = overdueRows.reduce((s, r) => s + Math.max(r.due - r.paid, 0), 0);

  // Only compare fields the expectations file actually pins.
  const fields = Object.keys(EXPECTED);

  const diffs = [];
  for (const f of fields) {
    const exp = EXPECTED[f];
    const liveV = live[f];
    const cacheV = cached[f];
    const row = { field: f, expected: exp, live: liveV, cached: cacheV ?? "—" };
    if (liveV !== exp) diffs.push({ ...row, reason: "live ≠ expected" });
    else if (cacheV !== undefined && cacheV !== exp)
      diffs.push({ ...row, reason: "cached ≠ expected" });
  }

  const PKR = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : String(n));
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  function writeSummary(md) {
    if (!summaryPath) return;
    try {
      appendFileSync(summaryPath, md + "\n");
    } catch {
      /* ignore */
    }
  }

  const status = diffs.length === 0 ? `✅ OK` : `❌ FAILED — ${diffs.length} mismatch(es)`;
  // Slug + HTML anchor so each booking's block is independently linkable and
  // never visually bleeds into the next audit's section.
  const slug = `audit-${BK.toLowerCase()}`;
  const subtitle = LABEL || "—";

  const headerTable = [
    "| Field | Value (PKR) |",
    "| --- | ---: |",
    `| cash_received | ${PKR(live.cash_received)} |`,
    `| possession_advance | ${PKR(live.possession_paid)} |`,
    `| remaining_balance | ${PKR(live.remaining_balance)} |`,
    `| total_contract_value | ${PKR(live.total_contract_value)} |`,
    `| installments_paid | ${PKR(live.installments_paid)} |`,
    `| down_payment_paid | ${PKR(live.down_payment_paid)} |`,
    `| current_overdue_count | ${live.current_overdue_count} |`,
    `| total_overdue_amount | ${PKR(live.total_overdue_amount)} |`,
  ].join("\n");

  // Per-booking section: leading `---` rule + anchored H2 with the booking
  // ID badge, label subtitle, and all tables nested underneath. A trailing
  // HTML marker `<!-- /audit:BK -->` keeps multi-booking summaries
  // structurally separated when they share one $GITHUB_STEP_SUMMARY file.
  let md = "";
  md += `\n---\n`;
  md += `<a id="${slug}"></a>\n`;
  md += `## 🧾 Booking \`${BK}\` — ${status}\n\n`;
  md += `_${subtitle}_\n\n`;
  md += `### Live totals — \`${BK}\`\n\n${headerTable}\n`;

  if (diffs.length) {
    const diffTable = [
      "",
      `### Diff — expected vs live vs cached — \`${BK}\``,
      "",
      "| Field | Expected | Live | Cached | Reason |",
      "| --- | ---: | ---: | ---: | --- |",
      ...diffs.map(
        (d) =>
          `| ${d.field} | ${PKR(d.expected)} | ${PKR(d.live)} | ${PKR(d.cached)} | ${d.reason} |`,
      ),
    ].join("\n");
    md += `\n${diffTable}\n`;
  }
  md += `\n<!-- /audit:${BK} -->\n`;
  writeSummary(md);

  if (diffs.length) {
    console.error(`\n✗ ${BK} cross-check FAILED — ${diffs.length} mismatch(es):\n`);
    console.table(diffs);
    process.exit(1);
  }
  console.log(
    `✓ ${BK} cross-check OK — ledger, cached booking fields, and KPIs all match the pinned reconciliation.`,
  );
  console.table(
    fields.map((f) => ({
      field: f,
      expected: EXPECTED[f],
      live: live[f],
      cached: cached[f] ?? "—",
    })),
  );
}

// CLI entry — only when invoked directly as the generic script.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp(process.stdout);
    process.exit(0);
  }
  if (parsed.list) {
    const entries = listPinnedBookings();
    if (!entries.length) {
      console.error(`✗ no pinned bookings found in ${EXPECTATIONS_DIR}`);
      console.error(
        `  Copy scripts/audit/expectations/_template.json to <BOOKING_ID>.json to pin one.`,
      );
      process.exit(2);
    }
    const idWidth = Math.max(10, ...entries.map((e) => e.id.length));
    console.log(`Pinned bookings (${entries.length}) under scripts/audit/expectations/:`);
    for (const e of entries) {
      const flag = e.valid ? " " : "!";
      console.log(`  ${flag} ${e.id.padEnd(idWidth)}  ${e.label || "—"}`);
    }
    const broken = entries.filter((e) => !e.valid);
    if (broken.length) {
      console.error(
        `\n✗ ${broken.length} file(s) failed to parse or have mismatched booking_id — marked with '!'.`,
      );
      process.exit(1);
    }
    process.exit(0);
  }
  if (parsed._error) {
    console.error(`✗ ${parsed._error}`);
    printHelp(process.stderr);
    process.exit(2);
  }
  if (parsed._unknown.length) {
    console.error(`✗ unknown argument(s): ${parsed._unknown.join(" ")}`);
    printHelp(process.stderr);
    process.exit(2);
  }
  if (!parsed.booking && !parsed.expectations) {
    console.error("✗ missing booking id");
    printHelp(process.stderr);
    process.exit(2);
  }
  runAudit({
    booking: parsed.booking,
    expectationsPath: parsed.expectations ? resolve(parsed.expectations) : null,
    strict: resolveStrict(parsed.strict),
  });
}

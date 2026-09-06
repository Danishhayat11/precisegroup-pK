import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = "https://kynszktuilxjqeurgzkm.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5bnN6a3R1aWx4anFldXJnemttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTQzMzE4MCwiZXhwIjoyMTAxMDA5MTgwfQ.9hodfEQxd0zucT20Do8odCPc2SrBtC4Q0bytiHJ2wI8";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Columns that exist in old DB but NOT in new DB — strip these
const STRIP_COLUMNS = ["tenant_id"];

// Tables that don't exist in the new DB — skip entirely
const SKIP_TABLES = ["ledger_transactions", "profiles", "user_roles"];

// Tables with FK to auth.users that we can't satisfy — strip those FK columns
const STRIP_FK_COLUMNS = {
  payment_edit_history: ["edited_by"],
  company_invitations: ["invited_by"],
  booking_documents: ["uploaded_by"],
};

function parseValues(valuesStr) {
  const result = [];
  let i = 0;
  while (i < valuesStr.length) {
    while (i < valuesStr.length && (valuesStr[i] === ' ' || valuesStr[i] === ',')) i++;
    if (i >= valuesStr.length) break;
    if (valuesStr[i] === "'") {
      i++;
      let val = "";
      while (i < valuesStr.length) {
        if (valuesStr[i] === "'" && valuesStr[i + 1] === "'") { val += "'"; i += 2; }
        else if (valuesStr[i] === "'") { i++; break; }
        else { val += valuesStr[i]; i++; }
      }
      result.push(val);
    } else if (valuesStr.substring(i, i + 4) === "NULL") {
      result.push(null); i += 4;
    } else if (valuesStr.substring(i, i + 4) === "true") {
      result.push(true); i += 4;
    } else if (valuesStr.substring(i, i + 5) === "false") {
      result.push(false); i += 5;
    } else {
      let val = "";
      while (i < valuesStr.length && valuesStr[i] !== ',' && valuesStr[i] !== ')') { val += valuesStr[i]; i++; }
      val = val.trim();
      const num = Number(val);
      result.push(isNaN(num) ? val : num);
    }
  }
  return result;
}

function parseColumns(colStr) {
  return colStr.match(/"([^"]+)"/g).map(c => c.replace(/"/g, ''));
}

async function run() {
  console.log("=== FULL DATA IMPORT (v2 - with fixes) ===\n");

  const sql = readFileSync("/Users/danishhayat/Downloads/02_data.sql", "utf-8");
  const lines = sql.split("\n");

  const tableData = {};
  const insertRegex = /^INSERT INTO public\."([^"]+)"\s*\(([^)]+)\)\s*VALUES\s*\((.+)\)\s*ON CONFLICT/;

  for (const line of lines) {
    const match = line.match(insertRegex);
    if (!match) continue;
    const table = match[1];
    const columns = parseColumns(match[2]);
    const values = parseValues(match[3]);
    if (!tableData[table]) tableData[table] = { columns, rows: [] };
    const row = {};
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      // Strip columns that don't exist in new DB
      if (STRIP_COLUMNS.includes(col)) continue;
      // Strip FK columns that reference auth.users
      if (STRIP_FK_COLUMNS[table] && STRIP_FK_COLUMNS[table].includes(col)) continue;
      row[col] = i < values.length ? values[i] : null;
    }
    tableData[table].rows.push(row);
  }

  console.log("Tables found:");
  for (const [t, d] of Object.entries(tableData)) {
    const skip = SKIP_TABLES.includes(t) ? " (SKIP)" : "";
    console.log(`  ${t}: ${d.rows.length} rows${skip}`);
  }

  // Ordered import — parents before children
  const importOrder = [
    "companies",
    "projects", "_seed_projects",
    "clients", "_seed_clients",
    "dealers", "_seed_dealers",
    "units", "_seed_units",
    "bookings", "_seed_bookings",
    "booking_documents",
    "payments", "_seed_payments",
    "payment_allocations",
    "payment_edit_history",
    "adjustments", "_seed_adjustments",
    "installment_ledger", "_seed_installment_ledger",
    "maintenance_schedules", "maintenance_charges",
    "marketing_controls",
    "office_expenses",
    "plan_restructure_history",
    "crm_leads",
    "hr_employees", "hr_attendance", "hr_payroll_runs", "hr_payslips",
    "ssr_alert_config",
    "company_invitations",
  ];

  // Add anything we missed
  for (const t of Object.keys(tableData)) {
    if (!importOrder.includes(t) && !SKIP_TABLES.includes(t)) importOrder.push(t);
  }

  console.log("\n--- Importing ---\n");
  let grandTotal = 0, grandFailed = 0;

  for (const table of importOrder) {
    if (!tableData[table]) continue;
    if (SKIP_TABLES.includes(table)) {
      console.log(`⏭️  SKIP ${table}`);
      continue;
    }

    const rows = tableData[table].rows;
    console.log(`📦 ${table} (${rows.length} rows)...`);

    let ok = 0, fail = 0;
    // Insert one by one to handle duplicates gracefully
    for (const row of rows) {
      const { error } = await supabase.from(table).insert(row);
      if (error) {
        if (error.message.includes("duplicate") || error.message.includes("already exists") || error.code === "23505") {
          ok++; // already exists = success
        } else {
          fail++;
          if (fail <= 2) console.log(`  ❌ ${error.message.substring(0, 150)}`);
        }
      } else {
        ok++;
      }
    }
    console.log(`  ✅ ${ok} ok, ${fail} failed`);
    grandTotal += ok;
    grandFailed += fail;
  }

  console.log(`\n=== DONE ===`);
  console.log(`Total OK: ${grandTotal}, Total Failed: ${grandFailed}`);

  // Quick verification
  console.log("\n--- Verification ---");
  for (const t of ["companies","projects","clients","bookings","payments","units","dealers","adjustments","installment_ledger"]) {
    const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
    console.log(`  ${t}: ${count} rows`);
  }

  console.log("\n🎉 Import complete!");
}

run().catch(e => console.error("Fatal:", e));

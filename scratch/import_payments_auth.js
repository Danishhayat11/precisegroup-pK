import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = "https://kynszktuilxjqeurgzkm.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5bnN6a3R1aWx4anFldXJnemttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MzMxODAsImV4cCI6MjEwMTAwOTE4MH0.kX-Ij6ZiE3ogpU2o8iWvX6tPO3ypNCQPciFXFwvm3W0";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5bnN6a3R1aWx4anFldXJnemttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTQzMzE4MCwiZXhwIjoyMTAxMDA5MTgwfQ.9hodfEQxd0zucT20Do8odCPc2SrBtC4Q0bytiHJ2wI8";

const STRIP_COLUMNS = ["tenant_id"];

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
  console.log("=== IMPORT PAYMENTS (as authenticated admin) ===\n");

  // Step 1: Sign in as admin to get a proper auth session
  const authClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
    email: "danishhayat706@gmail.com",
    password: "Precise@2024!",
  });

  if (authError) {
    console.error("❌ Login failed:", authError.message);
    return;
  }

  const accessToken = authData.session.access_token;
  console.log("✅ Logged in as admin. Got access token.");

  // Step 2: Parse payments from SQL
  const sql = readFileSync("/Users/danishhayat/Downloads/02_data.sql", "utf-8");
  const lines = sql.split("\n");
  const insertRegex = /^INSERT INTO public\."([^"]+)"\s*\(([^)]+)\)\s*VALUES\s*\((.+)\)\s*ON CONFLICT/;

  const paymentRows = [];
  const allocationRows = [];

  for (const line of lines) {
    const match = line.match(insertRegex);
    if (!match) continue;
    const table = match[1];
    if (table !== "payments" && table !== "payment_allocations") continue;

    const columns = parseColumns(match[2]);
    const values = parseValues(match[3]);
    const row = {};
    for (let i = 0; i < columns.length; i++) {
      if (STRIP_COLUMNS.includes(columns[i])) continue;
      row[columns[i]] = i < values.length ? values[i] : null;
    }
    if (table === "payments") paymentRows.push(row);
    else allocationRows.push(row);
  }

  // Step 3: Insert payments using authenticated session (with auth.uid() set)
  console.log(`\n📦 Inserting ${paymentRows.length} payments as authenticated admin...`);
  let ok = 0, fail = 0;

  for (const row of paymentRows) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: "POST",
      headers: {
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(row),
    });

    if (!res.ok) {
      const text = await res.text();
      if (text.includes("duplicate") || text.includes("already exists")) {
        ok++;
      } else {
        fail++;
        if (fail <= 5) console.log(`  ❌ ${text.substring(0, 150)}`);
      }
    } else {
      ok++;
    }
  }
  console.log(`  ✅ ${ok} ok, ${fail} failed`);

  // Step 4: Insert payment_allocations
  console.log(`\n📦 Inserting ${allocationRows.length} payment_allocations...`);
  ok = 0; fail = 0;
  for (const row of allocationRows) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/payment_allocations`, {
      method: "POST",
      headers: {
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const text = await res.text();
      if (text.includes("duplicate") || text.includes("already exists")) { ok++; }
      else { fail++; if (fail <= 3) console.log(`  ❌ ${text.substring(0, 150)}`); }
    } else { ok++; }
  }
  console.log(`  ✅ ${ok} ok, ${fail} failed`);

  // Final verification
  console.log("\n--- FINAL VERIFICATION ---");
  const serviceClient = createClient(SUPABASE_URL, SERVICE_KEY);
  for (const t of ["companies", "projects", "clients", "bookings", "payments", "units", "dealers", "adjustments", "installment_ledger", "payment_allocations", "payment_edit_history", "hr_employees", "office_expenses"]) {
    const { count } = await serviceClient.from(t).select("*", { count: "exact", head: true });
    console.log(`  ${t}: ${count} rows`);
  }

  console.log("\n🎉 ALL DATA IMPORTED SUCCESSFULLY!");
}

run().catch(e => console.error("Fatal:", e));

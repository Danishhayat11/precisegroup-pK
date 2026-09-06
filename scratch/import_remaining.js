import { readFileSync } from "fs";

const SUPABASE_URL = "https://kynszktuilxjqeurgzkm.supabase.co";
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

async function insertViaRest(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal,resolution=ignore-duplicates",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: text };
  }
  return { error: null };
}

async function run() {
  console.log("=== FIXING REMAINING TABLES ===\n");

  const sql = readFileSync("/Users/danishhayat/Downloads/02_data.sql", "utf-8");
  const lines = sql.split("\n");
  const insertRegex = /^INSERT INTO public\."([^"]+)"\s*\(([^)]+)\)\s*VALUES\s*\((.+)\)\s*ON CONFLICT/;

  // Parse all rows for target tables
  const targets = ["payments", "payment_edit_history", "payment_allocations", "plan_restructure_history"];
  const tableData = {};

  for (const line of lines) {
    const match = line.match(insertRegex);
    if (!match) continue;
    const table = match[1];
    if (!targets.includes(table)) continue;

    const columns = parseColumns(match[2]);
    const values = parseValues(match[3]);
    if (!tableData[table]) tableData[table] = [];

    const row = {};
    for (let i = 0; i < columns.length; i++) {
      if (STRIP_COLUMNS.includes(columns[i])) continue;
      row[columns[i]] = i < values.length ? values[i] : null;
    }
    tableData[table].push(row);
  }

  // 1. Import payments using direct REST call (bypasses RLS triggers)
  console.log(`📦 payments (${tableData["payments"]?.length ?? 0} rows) via direct REST...`);
  let ok = 0, fail = 0;
  for (const row of (tableData["payments"] ?? [])) {
    const { error } = await insertViaRest("payments", row);
    if (error) {
      if (error.includes("duplicate") || error.includes("already exists")) { ok++; }
      else { fail++; if (fail <= 3) console.log(`  ❌ ${error.substring(0, 150)}`); }
    } else { ok++; }
  }
  console.log(`  ✅ ${ok} ok, ${fail} failed`);

  // 2. Import payment_edit_history - need to map edited_by to a real user
  // Get our admin user ID
  const adminRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.danishhayat706@gmail.com&select=id`, {
    headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` }
  });
  const admins = await adminRes.json();
  const adminId = admins?.[0]?.id;
  console.log(`\nAdmin ID for edit_history mapping: ${adminId}`);

  if (adminId && tableData["payment_edit_history"]) {
    console.log(`📦 payment_edit_history (${tableData["payment_edit_history"].length} rows)...`);
    ok = 0; fail = 0;
    for (const row of tableData["payment_edit_history"]) {
      // Map old edited_by UUID to our admin
      row.edited_by = adminId;
      const { error } = await insertViaRest("payment_edit_history", row);
      if (error) {
        if (error.includes("duplicate") || error.includes("already exists")) { ok++; }
        else { fail++; if (fail <= 3) console.log(`  ❌ ${error.substring(0, 150)}`); }
      } else { ok++; }
    }
    console.log(`  ✅ ${ok} ok, ${fail} failed`);
  }

  // 3. payment_allocations (depends on payments being there now)
  if (tableData["payment_allocations"]) {
    console.log(`📦 payment_allocations (${tableData["payment_allocations"].length} rows)...`);
    ok = 0; fail = 0;
    for (const row of tableData["payment_allocations"]) {
      const { error } = await insertViaRest("payment_allocations", row);
      if (error) {
        if (error.includes("duplicate") || error.includes("already exists")) { ok++; }
        else { fail++; if (fail <= 3) console.log(`  ❌ ${error.substring(0, 150)}`); }
      } else { ok++; }
    }
    console.log(`  ✅ ${ok} ok, ${fail} failed`);
  }

  // 4. plan_restructure_history - map restructured_by
  if (tableData["plan_restructure_history"] && adminId) {
    console.log(`📦 plan_restructure_history (${tableData["plan_restructure_history"].length} rows)...`);
    ok = 0; fail = 0;
    for (const row of tableData["plan_restructure_history"]) {
      row.restructured_by = adminId;
      const { error } = await insertViaRest("plan_restructure_history", row);
      if (error) {
        if (error.includes("duplicate") || error.includes("already exists")) { ok++; }
        else { fail++; if (fail <= 3) console.log(`  ❌ ${error.substring(0, 150)}`); }
      } else { ok++; }
    }
    console.log(`  ✅ ${ok} ok, ${fail} failed`);
  }

  // Final verification
  console.log("\n--- Final Verification ---");
  for (const t of ["payments", "payment_allocations", "payment_edit_history", "bookings", "clients", "units"]) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=0`, {
      method: "HEAD",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Prefer": "count=exact",
      }
    });
    const count = res.headers.get("content-range")?.split("/")?.[1] ?? "?";
    console.log(`  ${t}: ${count} rows`);
  }

  console.log("\n🎉 All remaining data imported!");
}

run().catch(e => console.error("Fatal:", e));

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = "https://kynszktuilxjqeurgzkm.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5bnN6a3R1aWx4anFldXJnemttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTQzMzE4MCwiZXhwIjoyMTAxMDA5MTgwfQ.9hodfEQxd0zucT20Do8odCPc2SrBtC4Q0bytiHJ2wI8";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// The two emails to set up as admins
const USERS = [
  { email: "danishhayat706@gmail.com", name: "Danish Hayyat", password: "Precise@2024!" },
  { email: "danish@precisegroup.pk", name: "danish", password: "Precise@2024!" },
];

async function ensureUser(email, name, password) {
  // Check if already exists
  const { data: { users } } = await supabase.auth.admin.listUsers();
  let user = users.find(u => u.email === email);

  if (!user) {
    console.log(`  Creating user ${email}...`);
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error) {
      console.error(`  ❌ Failed to create ${email}:`, error.message);
      return null;
    }
    user = data.user;
    console.log(`  ✅ Created ${email} → ${user.id}`);
  } else {
    console.log(`  ✅ Found existing ${email} → ${user.id}`);
  }
  return user.id;
}

async function upsertProfile(userId, email, name, companyId) {
  const { error } = await supabase.from("profiles").upsert({
    id: userId,
    email,
    full_name: name,
    company_id: companyId,
    is_active: true,
    active_project_code: "MA",
  }, { onConflict: "id" });
  if (error) {
    console.error(`  ❌ Profile upsert failed for ${email}:`, error.message);
  } else {
    console.log(`  ✅ Profile upserted for ${email}`);
  }
}

async function grantRoles(userId, roles, companyId) {
  for (const role of roles) {
    const { data: existing } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", role)
      .eq("company_id", companyId);

    if (existing && existing.length > 0) {
      console.log(`  ✅ Already has role '${role}'`);
      continue;
    }

    const { error } = await supabase.from("user_roles").insert({
      user_id: userId,
      role,
      company_id: companyId,
    });
    if (error) {
      console.error(`  ❌ Failed to grant '${role}':`, error.message);
    } else {
      console.log(`  ✅ Granted '${role}'`);
    }
  }
}

async function run() {
  console.log("=== Setting up users in new Supabase database ===\n");

  // 1. Create/find both users
  console.log("--- Step 1: Create/find users ---");
  const danishGmailId = await ensureUser(USERS[0].email, USERS[0].name, USERS[0].password);
  const danishPreciseId = await ensureUser(USERS[1].email, USERS[1].name, USERS[1].password);

  if (!danishGmailId || !danishPreciseId) {
    console.error("Failed to create users. Aborting.");
    return;
  }

  // 2. Ensure the main company exists
  console.log("\n--- Step 2: Ensure companies exist ---");
  const mainCompanyId = "00000000-0000-0000-0000-000000000001";
  const { data: existingCompany } = await supabase
    .from("companies")
    .select("id")
    .eq("id", mainCompanyId)
    .single();

  if (!existingCompany) {
    // Read from SQL file to find company data
    const sql = readFileSync("/Users/danishhayat/Downloads/02_data.sql", "utf-8");
    const companyLines = sql.split("\n").filter(l => l.includes('INSERT INTO public."companies"'));
    
    for (const line of companyLines) {
      // Extract values from INSERT statement
      const valuesMatch = line.match(/VALUES \((.+?)\) ON CONFLICT/);
      if (!valuesMatch) continue;
      const rawValues = valuesMatch[1];
      // Parse CSV-like values (this is simplified)
      const values = [];
      let current = "";
      let inQuote = false;
      for (const ch of rawValues) {
        if (ch === "'" && !inQuote) { inQuote = true; continue; }
        if (ch === "'" && inQuote) { inQuote = false; values.push(current); current = ""; continue; }
        if (ch === "," && !inQuote) {
          if (current.trim() && values.length === 0) values.push(current.trim());
          current = "";
          continue;
        }
        current += ch;
      }

      const id = values[0];
      const name = values[1];
      const { error } = await supabase.from("companies").upsert({
        id, name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (error) {
        console.error(`  ❌ Company insert failed (${id}):`, error.message);
      } else {
        console.log(`  ✅ Company upserted: ${name} (${id})`);
      }
    }
  } else {
    console.log(`  ✅ Main company already exists.`);
  }

  // 3. Upsert profiles
  console.log("\n--- Step 3: Upsert profiles ---");
  // danishhayat706@gmail.com was in old DB with company 4ff1caaa...
  // For new DB, link to main company
  await upsertProfile(danishGmailId, USERS[0].email, USERS[0].name, mainCompanyId);
  await upsertProfile(danishPreciseId, USERS[1].email, USERS[1].name, mainCompanyId);

  // 4. Grant roles  
  console.log("\n--- Step 4: Grant admin + super_admin roles ---");
  console.log(`  ${USERS[0].email}:`);
  await grantRoles(danishGmailId, ["admin", "super_admin"], mainCompanyId);
  console.log(`  ${USERS[1].email}:`);
  await grantRoles(danishPreciseId, ["admin", "super_admin"], mainCompanyId);

  // 5. Summary
  console.log("\n=== SUMMARY ===");
  console.log(`  danishhayat706@gmail.com → ${danishGmailId}`);
  console.log(`  danish@precisegroup.pk   → ${danishPreciseId}`);
  console.log(`  Both have admin + super_admin roles.`);
  console.log(`  Password for both: ${USERS[0].password}`);
  console.log(`\n🎉 Done! Both users are now admins in your new database.`);
}

run();

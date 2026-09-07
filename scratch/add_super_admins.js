import { createClient } from "@supabase/supabase-js";

const SERVICE_KEY = process.argv[2];
if (!SERVICE_KEY) {
  console.error("Usage: node scratch/add_super_admins.js <service_role_key>");
  process.exit(1);
}

// Extract project ref from the JWT to build the URL
const payload = JSON.parse(Buffer.from(SERVICE_KEY.split(".")[1], "base64").toString());
const PROJECT_REF = payload.ref;
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

console.log(`Connecting to ${SUPABASE_URL}...`);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SUPER_ADMIN_EMAILS = [
  "danish@precisegroup.pk",
  "mushtaq@precisegroup.pk",
  "danishhayat706@gmail.com",
];

async function run() {
  // 1. List all auth users to find IDs by email
  console.log("\n📋 Looking up users...");
  const { data: authData, error: authErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (authErr) {
    console.error("❌ Failed to list users:", authErr.message);
    process.exit(1);
  }

  const allUsers = authData.users;
  console.log(`   Found ${allUsers.length} total users in auth.users`);

  // 2. Find the target users
  const targets = [];
  for (const email of SUPER_ADMIN_EMAILS) {
    const user = allUsers.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (user) {
      targets.push({ email, id: user.id });
      console.log(`   ✅ ${email} → ${user.id}`);
    } else {
      console.log(`   ⚠️  ${email} — not found in auth.users`);
    }
  }

  if (targets.length === 0) {
    console.log("\n❌ No matching users found. Nothing to do.");
    return;
  }

  // 3. Check existing super_admin roles
  console.log("\n📋 Checking existing super_admin roles...");
  const { data: existingRoles, error: rolesErr } = await supabase
    .from("user_roles")
    .select("user_id, role, company_id")
    .eq("role", "super_admin");

  if (rolesErr) {
    console.error("❌ Failed to query user_roles:", rolesErr.message);
    process.exit(1);
  }

  const existingSuperAdminIds = new Set((existingRoles || []).map((r) => r.user_id));
  console.log(`   Found ${existingSuperAdminIds.size} existing super_admin(s)`);

  // 4. For each target, get their company_id from their profile and add super_admin role
  let added = 0;
  let skipped = 0;
  for (const { email, id } of targets) {
    if (existingSuperAdminIds.has(id)) {
      console.log(`   ⏭️  ${email} — already a super_admin`);
      skipped++;
      continue;
    }

    // Get their company_id from profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", id)
      .maybeSingle();

    const companyId = profile?.company_id || null;

    // Also check if they have any existing role to get company_id
    let effectiveCompanyId = companyId;
    if (!effectiveCompanyId) {
      const { data: anyRole } = await supabase
        .from("user_roles")
        .select("company_id")
        .eq("user_id", id)
        .limit(1)
        .maybeSingle();
      effectiveCompanyId = anyRole?.company_id || "00000000-0000-0000-0000-000000000001";
    }

    const { error: insertErr } = await supabase.from("user_roles").insert({
      user_id: id,
      role: "super_admin",
      company_id: effectiveCompanyId,
    });

    if (insertErr) {
      if (insertErr.code === "23505") {
        console.log(`   ⏭️  ${email} — role already exists (unique constraint)`);
        skipped++;
      } else {
        console.error(`   ❌ ${email} — failed to insert: ${insertErr.message}`);
      }
    } else {
      console.log(`   ✅ ${email} — granted super_admin (company: ${effectiveCompanyId})`);
      added++;
    }
  }

  console.log(`\n🎯 Done! Added: ${added}, Skipped: ${skipped}`);

  // 5. Final verification
  console.log("\n📋 Final super_admin list:");
  const { data: finalRoles } = await supabase
    .from("user_roles")
    .select("user_id, role, company_id")
    .eq("role", "super_admin");

  for (const role of finalRoles || []) {
    const user = allUsers.find((u) => u.id === role.user_id);
    console.log(`   👑 ${user?.email || role.user_id} (company: ${role.company_id})`);
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

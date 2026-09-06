import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://kynszktuilxjqeurgzkm.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5bnN6a3R1aWx4anFldXJnemttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTQzMzE4MCwiZXhwIjoyMTAxMDA5MTgwfQ.9hodfEQxd0zucT20Do8odCPc2SrBtC4Q0bytiHJ2wI8";
const EMAIL = "danisahhayat706@gmail.com";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function run() {
  console.log(`Connecting to ${SUPABASE_URL} to setup Admin...`);

  // 1. Get the user from auth.users
  const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    console.error("Error fetching users:", usersError);
    return;
  }

  const targetUser = users.find(u => u.email === EMAIL);
  let userId;
  if (!targetUser) {
    console.log(`User ${EMAIL} not found. Creating user now...`);
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password: "password123",
      email_confirm: true,
    });
    if (createError) {
      console.error("❌ Error creating user:", createError);
      return;
    }
    userId = newUser.user.id;
    console.log(`✅ Created user: ${userId} (${EMAIL}) with password: password123`);
  } else {
    userId = targetUser.id;
    console.log(`✅ Found user: ${userId} (${EMAIL})`);
  }

  // 2. Check/Upsert profile
  const { data: existingProfile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (profileError && profileError.code !== "PGRST116") {
    console.error("Error checking profile:", profileError);
    return;
  }

  if (!existingProfile) {
    console.log("No profile found. Creating one...");
    const { error: insertProfileError } = await supabase.from("profiles").insert({
      id: userId,
      email: EMAIL,
      full_name: "Admin User",
    });
    if (insertProfileError) {
      console.error("❌ Error creating profile:", insertProfileError);
      return;
    }
    console.log("✅ Profile created.");
  } else {
    console.log("✅ Profile already exists.");
  }

  // 3. Give them admin role in user_roles
  const { data: existingRole, error: roleError } = await supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", userId)
    .eq("role", "admin")
    .single();

  if (roleError && roleError.code !== "PGRST116") {
    console.error("Error checking roles:", roleError);
    return;
  }

  if (!existingRole) {
    console.log("User does not have admin role. Granting admin...");
    
    // Fetch a company to assign
    const { data: companies } = await supabase.from("companies").select("id").limit(1);
    const companyId = companies && companies.length > 0 ? companies[0].id : null;
    
    if (!companyId) {
      console.error("❌ No companies found in the database. Cannot grant role without a company_id.");
      return;
    }

    const { error: insertRoleError } = await supabase.from("user_roles").insert({
      user_id: userId,
      role: "admin",
      company_id: companyId
    });
    if (insertRoleError) {
      console.error("❌ Error granting admin role:", insertRoleError);
      return;
    }
    console.log("✅ Admin role granted.");
  } else {
    console.log("✅ User is already an admin.");
  }
  
  console.log("🎉 Setup complete! You are now an Admin in the new database!");
}

run();

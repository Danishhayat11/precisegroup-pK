const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://kynszktuilyjqeurzgkm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5bnN6a3R1aWx4anFldXJnemttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTQzMzE4MCwiZXhwIjoyMTAxMDA5MTgwfQ.9hodfEQxd0zucT20Do8odCPc2SrBtC4Q0bytiHJ2wI8';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function main() {
  try {
    const emails = ['danish@precisegroup.pk', 'danishhayat706@gmail.com'];
    
    // 1. Get user IDs
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) throw authError;

    const users = authUsers.users.filter(u => emails.includes(u.email));
    console.log('Found users:', users.map(u => ({ email: u.email, id: u.id })));

    // 2. Find the tenant "Precise Realtors & Builders"
    const { data: tenants, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .ilike('name', '%precise%');
    
    if (tenantError) throw tenantError;
    
    if (tenants.length === 0) {
      console.log('No tenant found matching Precise');
      return;
    }
    
    const tenant = tenants[0];
    console.log('Found tenant:', tenant.name, tenant.id);

    // 3. Upsert into tenant_users
    for (const user of users) {
      const { error: upsertError } = await supabase
        .from('tenant_users')
        .upsert({
          tenant_id: tenant.id,
          user_id: user.id,
          role: 'admin' // Make them admin
        }, {
          onConflict: 'tenant_id,user_id'
        });

      if (upsertError) {
        console.error(`Error adding ${user.email} as admin:`, upsertError);
      } else {
        console.log(`Successfully added ${user.email} as admin to ${tenant.name}`);
      }
    }
    
    // 4. Verify Super Admin records
    for (const user of users) {
      const { data: saData, error: saError } = await supabase
        .from('super_admins')
        .select('*')
        .eq('user_id', user.id);
        
      if (saError) console.error(saError);
      if (!saData || saData.length === 0) {
        console.log(`User ${user.email} is NOT a super admin. Adding...`);
        await supabase.from('super_admins').insert({ user_id: user.id });
        console.log(`Added ${user.email} as super admin.`);
      } else {
        console.log(`User ${user.email} is already a super admin.`);
      }
    }
    
    console.log("Done checking admin controls.");
    process.exit(0);
  } catch (error) {
    console.error('Script failed:', error);
    process.exit(1);
  }
}

main();

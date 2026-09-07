-- Copy and paste this directly into the Supabase SQL Editor
-- This will make both emails super_admin. Because of the new role hierarchy
-- migration, 'super_admin' will inherently grant 'admin', 'manager', 'staff'
-- permissions across ALL companies in your database globally.

-- Grant super_admin role to both users on the default seed company (they act globally)
INSERT INTO public.user_roles (user_id, role, company_id)
SELECT u.id, 'super_admin'::public.app_role, '00000000-0000-0000-0000-000000000001'::uuid
FROM auth.users u
WHERE u.email IN ('danish@precisegroup.pk', 'danishhayat706@gmail.com')
ON CONFLICT (user_id, role) DO UPDATE SET company_id = EXCLUDED.company_id;

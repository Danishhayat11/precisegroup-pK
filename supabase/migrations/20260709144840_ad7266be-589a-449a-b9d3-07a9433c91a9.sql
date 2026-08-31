
-- Create a second test tenant + an open admin invitation with a fixed, known token.
INSERT INTO public.companies (id, name, plan, is_active, onboarding_completed_at)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Test Tenant Co (Isolation Check)',
  'starter',
  true,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = true,
  updated_at = now();

-- Invitation targeted for anyone; the signup form will collect the real email.
-- Token is fixed so we can share a stable /accept-invite/<token> URL.
INSERT INTO public.company_invitations (
  company_id, email, role, token, invited_by, expires_at, accepted_at
)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'test-tenant-admin@example.com',
  'admin',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  NULL,
  now() + interval '30 days',
  NULL
)
ON CONFLICT (token) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  role = EXCLUDED.role,
  expires_at = EXCLUDED.expires_at,
  accepted_at = NULL;

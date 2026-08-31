ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- Existing companies are considered already onboarded so they don't get
-- redirected into the wizard on next login.
UPDATE public.companies
   SET onboarding_completed_at = now()
 WHERE onboarding_completed_at IS NULL;
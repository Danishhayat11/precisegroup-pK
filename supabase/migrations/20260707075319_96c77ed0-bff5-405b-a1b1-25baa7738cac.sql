-- Enforce referential integrity: profiles.active_project_code must be either
-- NULL (no active project selected) or reference an existing project.
--
-- ON DELETE SET NULL rather than CASCADE — removing a project should not
-- delete a user's profile row; the user simply loses their "active" pointer
-- and the app UI falls back to the project picker.
--
-- ON UPDATE CASCADE so a project rename (project_code is a natural TEXT PK)
-- automatically propagates to every user pointing at it.
--
-- The backfill in 20260707071621_* already normalised every existing value
-- to a real project_code (or NULL when the projects table is empty), so
-- adding the constraint validated up-front is safe.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_active_project_code_fkey'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_active_project_code_fkey
      FOREIGN KEY (active_project_code)
      REFERENCES public.projects(project_code)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END $$;

-- Supporting index: FK columns need an index to keep ON DELETE SET NULL
-- and cascading updates fast, and to let `WHERE active_project_code = ?`
-- lookups (used by dashboards that filter by "my active project") avoid
-- a seq scan on profiles as the table grows.
CREATE INDEX IF NOT EXISTS idx_profiles_active_project_code
  ON public.profiles (active_project_code)
  WHERE active_project_code IS NOT NULL;

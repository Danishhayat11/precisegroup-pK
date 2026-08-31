
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_project_code text;

UPDATE public.profiles p
SET active_project_code = (
  SELECT project_code
  FROM public.projects
  ORDER BY project_name
  LIMIT 1
)
WHERE p.active_project_code IS NULL
  AND EXISTS (SELECT 1 FROM public.projects);

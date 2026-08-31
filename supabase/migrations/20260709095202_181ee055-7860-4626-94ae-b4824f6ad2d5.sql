
ALTER TABLE public.hr_employees ADD COLUMN IF NOT EXISTS photo_path TEXT;

-- Storage policies for the private employee-photos bucket. All authenticated
-- HR users can read/write/delete photos; the app scopes visibility because
-- only authenticated users reach the employees UI.
CREATE POLICY "Authenticated read employee photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'employee-photos');

CREATE POLICY "Authenticated upload employee photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'employee-photos');

CREATE POLICY "Authenticated update employee photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'employee-photos')
WITH CHECK (bucket_id = 'employee-photos');

CREATE POLICY "Authenticated delete employee photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'employee-photos');

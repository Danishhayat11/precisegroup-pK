
ALTER TABLE public.office_expenses
  ADD COLUMN IF NOT EXISTS receipt_attachment_path text;

-- Storage RLS for the expense-receipts bucket (bucket itself is created via the storage tool).
CREATE POLICY "expense receipts read"   ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-receipts');
CREATE POLICY "expense receipts insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts');
CREATE POLICY "expense receipts update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'expense-receipts');
CREATE POLICY "expense receipts delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'expense-receipts');

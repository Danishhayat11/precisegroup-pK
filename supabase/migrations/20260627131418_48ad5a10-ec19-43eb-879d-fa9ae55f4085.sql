
-- Booking documents table
CREATE TABLE public.booking_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id text NOT NULL REFERENCES public.bookings(booking_id) ON DELETE CASCADE,
  label text NOT NULL,
  custom_label text,
  doc_date date,
  notes text,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint NOT NULL,
  mime_type text,
  status text,
  tracking_no text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX booking_documents_booking_idx ON public.booking_documents(booking_id);
CREATE INDEX booking_documents_label_idx ON public.booking_documents(label);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_documents TO authenticated;
GRANT ALL ON public.booking_documents TO service_role;

ALTER TABLE public.booking_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read booking documents"
  ON public.booking_documents FOR SELECT TO authenticated USING (true);

CREATE POLICY "Writers can insert booking documents"
  ON public.booking_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_writer(auth.uid()));

CREATE POLICY "Writers can update booking documents"
  ON public.booking_documents FOR UPDATE TO authenticated
  USING (public.is_writer(auth.uid())) WITH CHECK (public.is_writer(auth.uid()));

CREATE POLICY "Writers can delete booking documents"
  ON public.booking_documents FOR DELETE TO authenticated
  USING (public.is_writer(auth.uid()));

CREATE TRIGGER booking_documents_set_updated_at
  BEFORE UPDATE ON public.booking_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage RLS for booking-documents bucket
CREATE POLICY "Authenticated can read booking-documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'booking-documents');

CREATE POLICY "Writers can upload booking-documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'booking-documents' AND public.is_writer(auth.uid()));

CREATE POLICY "Writers can update booking-documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'booking-documents' AND public.is_writer(auth.uid()));

CREATE POLICY "Writers can delete booking-documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'booking-documents' AND public.is_writer(auth.uid()));

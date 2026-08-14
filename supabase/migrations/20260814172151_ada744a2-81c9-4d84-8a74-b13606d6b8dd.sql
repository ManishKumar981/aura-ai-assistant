ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS pdf_url text;

-- Users can upload PDFs where the path starts with their own user ID
CREATE POLICY "Users can upload their own PDFs"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'consultation-pdfs'
    AND storage.foldername(name) @> ARRAY[(select auth.uid()::text)]
  );

-- Users can update their own PDFs
CREATE POLICY "Users can update their own PDFs"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'consultation-pdfs'
    AND storage.foldername(name) @> ARRAY[(select auth.uid()::text)]
  )
  WITH CHECK (
    bucket_id = 'consultation-pdfs'
    AND storage.foldername(name) @> ARRAY[(select auth.uid()::text)]
  );

-- Users can read their own PDFs
CREATE POLICY "Users can read their own PDFs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'consultation-pdfs'
    AND storage.foldername(name) @> ARRAY[(select auth.uid()::text)]
  );

-- Users can delete their own PDFs
CREATE POLICY "Users can delete their own PDFs"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'consultation-pdfs'
    AND storage.foldername(name) @> ARRAY[(select auth.uid()::text)]
  );

-- Service role can manage all files in the bucket
CREATE POLICY "Service role can manage PDFs"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'consultation-pdfs')
  WITH CHECK (bucket_id = 'consultation-pdfs');

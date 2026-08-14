# PDF Medical Consultation Report

Add a professional PDF report for every completed consultation, stored in Lovable Cloud storage and downloadable from the results page.

## What to build

1. Database & storage
   - Add `pdf_url` text column to `public.consultations`.
   - Create a Supabase storage bucket `consultation-pdfs` with RLS policies so users can only read/write their own PDFs.

2. PDF generation
   - Install `pdf-lib` (pure JS, Worker-safe).
   - Create `src/lib/pdf-report.server.ts` to generate a styled medical report PDF from the consultation, profile, summary, medical points and full transcript.
   - Include a header (patient name, date, report number), summary, categorized medical findings, and the full transcript.

3. Server function
   - Create `src/lib/pdf.functions.ts` with `generateConsultationPdf` (protected by `requireSupabaseAuth`).
   - The function generates PDF bytes, uploads to `consultation-pdfs/<consultation-id>.pdf` with `application/pdf`, updates `consultations.pdf_url`, and returns the public URL.

4. Finalization integration
   - Update `src/lib/consultation.functions.ts` so `finalizeConsultation` calls `generateConsultationPdf` automatically after extraction and summary.

5. Results UI
   - Update `src/routes/_authenticated/consultation.$id.tsx` to display a generated PDF link and a Download PDF button that opens the signed URL.

6. Verification
   - Run a 5-10 turn consultation, end it, and confirm the PDF is generated, stored, and downloadable. Verify the `pdf_url` column and storage bucket contents.

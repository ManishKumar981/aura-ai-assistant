import { generateConsultationPdf } from "./pdf-report.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ExtractionResult } from "./consultation-extraction";

type Profile = {
  full_name?: string | null;
  email?: string | null;
};

type Summary = {
  chief_complaint?: string | null;
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  overview?: string | null;
  follow_up?: string | null;
  generated_by?: string | null;
};

type MedicalPoint = {
  category: string;
  content: string;
  evidence?: string | null;
};

type Message = {
  role: string;
  content: string;
  timestamp: string;
};

type ConsultationInfo = {
  id: string;
  title: string;
  started_at: string;
  ended_at?: string | null;
};

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Generates a PDF for a completed consultation and stores it in the private
 * `consultation-pdfs` bucket under the user's own folder. Returns the signed
 * URL that is stored on the consultation record.
 */
export async function generateAndUploadPdf(
  supabase: SupabaseClient<Database>,
  userId: string,
  consultation: ConsultationInfo,
  profile: Profile | null,
  summary: (Summary & { extraction?: ExtractionResult | null }) | null,
  points: MedicalPoint[],
  transcript: Message[],
): Promise<string> {
  const pdfBytes = await generateConsultationPdf({
    consultationId: consultation.id,
    title: consultation.title,
    startedAt: consultation.started_at,
    endedAt: consultation.ended_at,
    profile,
    summary,
    extraction: summary?.extraction ?? null,
    points,
    transcript,
  });

  const path = `${userId}/${consultation.id}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("consultation-pdfs")
    .upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadError) throw new Error(uploadError.message);

  const { data: signedUrl, error: signedError } = await supabase.storage
    .from("consultation-pdfs")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedError) throw new Error(signedError.message);

  return signedUrl.signedUrl;
}

/**
 * Creates a fresh signed URL for an already-generated PDF report.
 */
export async function createFreshSignedUrl(
  supabase: SupabaseClient<Database>,
  userId: string,
  consultationId: string,
): Promise<string> {
  const path = `${userId}/${consultationId}.pdf`;
  const { data: signedUrl, error: signedError } = await supabase.storage
    .from("consultation-pdfs")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedError) throw new Error(signedError.message);
  return signedUrl.signedUrl;
}

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const IdSchema = z.object({ consultationId: z.string().uuid() });

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Generates the PDF report for a completed consultation, uploads it to the
 * private `consultation-pdfs` bucket under the user's own folder, and stores
 * a signed download URL on the consultation record.
 */
export const generateConsultationPdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { generateAndUploadPdf } = await import("./pdf.server");

    const { data: consultation, error: consultationError } = await supabase
      .from("consultations")
      .select("id, title, status, started_at, ended_at, user_id")
      .eq("id", data.consultationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (consultationError) throw new Error(consultationError.message);
    if (!consultation) throw new Error("Consultation not found.");
    if (consultation.status !== "completed") {
      throw new Error("The consultation must be completed before generating a PDF.");
    }
    if (!consultation.ended_at) {
      throw new Error("Consultation end time is missing.");
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);

    const { data: summary, error: summaryError } = await supabase
      .from("consultation_summaries")
      .select("chief_complaint, subjective, objective, assessment, plan, overview, follow_up, generated_by, extraction")
      .eq("consultation_id", data.consultationId)
      .maybeSingle();
    if (summaryError) throw new Error(summaryError.message);

    const { data: points, error: pointsError } = await supabase
      .from("medical_points")
      .select("category, content, evidence")
      .eq("consultation_id", data.consultationId)
      .order("created_at", { ascending: true });
    if (pointsError) throw new Error(pointsError.message);

    const { data: transcript, error: transcriptError } = await supabase
      .from("messages")
      .select("role, content, timestamp")
      .eq("consultation_id", data.consultationId)
      .order("timestamp", { ascending: true });
    if (transcriptError) throw new Error(transcriptError.message);

    const pdfUrl = await generateAndUploadPdf(
      supabase,
      userId,
      consultation,
      profile ?? null,
      summary ?? null,
      points ?? [],
      transcript ?? [],
    );

    const { error: updateError } = await supabase
      .from("consultations")
      .update({ pdf_url: pdfUrl })
      .eq("id", data.consultationId);
    if (updateError) throw new Error(updateError.message);

    return { pdfUrl };
  });

/**
 * Returns a fresh signed URL for an already-generated PDF. Useful when the
 * stored URL has expired or when a user wants to re-download.
 */
export const getConsultationPdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { createFreshSignedUrl } = await import("./pdf.server");

    const { data: consultation, error: consultationError } = await supabase
      .from("consultations")
      .select("id")
      .eq("id", data.consultationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (consultationError) throw new Error(consultationError.message);
    if (!consultation) throw new Error("Consultation not found.");

    const pdfUrl = await createFreshSignedUrl(supabase, userId, data.consultationId);
    return { pdfUrl };
  });

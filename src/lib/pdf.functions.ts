import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateConsultationPdf } from "./pdf-report.server";

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

    const pdfBytes = await generateConsultationPdf({
      consultationId: consultation.id,
      title: consultation.title,
      startedAt: consultation.started_at,
      endedAt: consultation.ended_at,
      profile: profile ?? null,
      summary: summary ?? null,
      extraction: summary?.extraction ? (summary.extraction as Record<string, unknown>) : null,
      points: points ?? [],
      transcript: transcript ?? [],
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

    const { error: updateError } = await supabase
      .from("consultations")
      .update({ pdf_url: signedUrl.signedUrl })
      .eq("id", data.consultationId);
    if (updateError) throw new Error(updateError.message);

    return { pdfUrl: signedUrl.signedUrl };
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
    const path = `${userId}/${data.consultationId}.pdf`;

    const { data: consultation, error: consultationError } = await supabase
      .from("consultations")
      .select("id")
      .eq("id", data.consultationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (consultationError) throw new Error(consultationError.message);
    if (!consultation) throw new Error("Consultation not found.");

    const { data: signedUrl, error: signedError } = await supabase.storage
      .from("consultation-pdfs")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signedError) throw new Error(signedError.message);

    return { pdfUrl: signedUrl.signedUrl };
  });

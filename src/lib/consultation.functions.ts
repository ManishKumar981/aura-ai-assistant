import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";



const IdSchema = z.object({ consultationId: z.string().uuid() });

/**
 * Ends a consultation: marks it COMPLETED, reads back the FULL preserved
 * transcript (never replaced), extracts structured medical information from it
 * and stores both the extracted points and the generated summary.
 */
export const finalizeConsultation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { analyseTranscript } = await import("./consultation-analysis.server");

    const { data: consultation, error: consultationError } = await supabase
      .from("consultations")
      .select("id, status")
      .eq("id", data.consultationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (consultationError) throw new Error(consultationError.message);
    if (!consultation) throw new Error("Consultation not found.");

    // 3. Mark as completed.
    const { error: updateError } = await supabase
      .from("consultations")
      .update({
        status: "completed",
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.consultationId);
    if (updateError) throw new Error(updateError.message);

    // 4/5. Retrieve the complete conversation — the transcript is left untouched.
    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("id, role, content, timestamp")
      .eq("consultation_id", data.consultationId)
      .order("timestamp", { ascending: true });
    if (messagesError) throw new Error(messagesError.message);

    const turns = messages ?? [];

    // 6/7. Analyse + extract.
    const { extraction, generatedBy } = await analyseTranscript(turns);

    // 8. Save extracted information as discrete medical points.
    await supabase.from("medical_points").delete().eq("consultation_id", data.consultationId);

    const rows: Array<{ consultation_id: string; category: string; content: string; evidence: string | null }> = [];
    const push = (category: string, content: string | null, evidence: string | null = null) => {
      if (!content) return;
      rows.push({ consultation_id: data.consultationId, category, content, evidence });
    };

    push("chief_complaint", extraction.chief_complaint);
    for (const symptom of extraction.symptoms) {
      const detail = [
        symptom.duration ? `duration: ${symptom.duration}` : null,
        symptom.severity ? `severity: ${symptom.severity}` : null,
        symptom.notes,
      ]
        .filter(Boolean)
        .join(" · ");
      push("symptom", detail ? `${symptom.name} (${detail})` : symptom.name);
    }
    push("duration", extraction.duration);
    push("severity", extraction.severity);
    for (const m of extraction.medications) push("medication", m);
    for (const a of extraction.allergies) push("allergy", a);
    for (const h of extraction.medical_history) push("medical_history", h);
    for (const n of extraction.negative_findings) push("negative_finding", n);
    for (const r of extraction.risk_indicators) push("risk_indicator", r);
    for (const r of extraction.recommendations) push("recommendation", r);
    push("follow_up", extraction.follow_up);

    if (rows.length > 0) {
      const { error: pointsError } = await supabase.from("medical_points").insert(rows);
      if (pointsError) throw new Error(pointsError.message);
    }

    // 9. Structured summary.
    const subjective = [
      extraction.chief_complaint ? `Chief complaint: ${extraction.chief_complaint}` : null,
      extraction.symptoms.length
        ? `Symptoms: ${extraction.symptoms
            .map((s) =>
              [s.name, s.duration ? `duration ${s.duration}` : null, s.severity ? `severity ${s.severity}` : null]
                .filter(Boolean)
                .join(", "),
            )
            .join("; ")}`
        : "Symptoms: Not reported",
      `Duration: ${extraction.duration ?? "Not reported"}`,
      `Severity: ${extraction.severity ?? "Not reported"}`,
      `Medications mentioned: ${extraction.medications.join(", ") || "Not reported"}`,
      `Allergies mentioned: ${extraction.allergies.join(", ") || "Not reported"}`,
      `Relevant medical history: ${extraction.medical_history.join(", ") || "Not reported"}`,
      `Important negative symptoms: ${extraction.negative_findings.join("; ") || "Not reported"}`,
    ]
      .filter(Boolean)
      .join("\n");

    const summaryRow = {
      consultation_id: data.consultationId,
      chief_complaint: extraction.chief_complaint,
      subjective,
      objective: "Not reported — no examination or measured findings were recorded in this conversation.",
      assessment:
        extraction.risk_indicators.length > 0
          ? `Risk indicators mentioned: ${extraction.risk_indicators.join(", ")}. No diagnosis has been made; clinician review required.`
          : "No risk indicators were reported. No diagnosis has been made; clinician review required.",
      plan: extraction.recommendations.join("\n") || "Not reported",
      overview: extraction.summary,
      follow_up: extraction.follow_up ?? "Not reported",
      extraction: JSON.parse(JSON.stringify(extraction)),
      generated_by: generatedBy,
      updated_at: new Date().toISOString(),
    };

    const { error: summaryError } = await supabase
      .from("consultation_summaries")
      .upsert(summaryRow, { onConflict: "consultation_id" });
    if (summaryError) throw new Error(summaryError.message);

    return { consultationId: data.consultationId, turns: turns.length, points: rows.length, generatedBy };
  });

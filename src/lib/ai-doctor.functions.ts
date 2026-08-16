import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SendSchema = z.object({
  consultationId: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
});

export const sendPatientMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SendSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { generateDoctorReply } = await import("./ai-doctor.server");

    // RLS already scopes this, the explicit check keeps the error readable.
    const { data: consultation, error: consultationError } = await supabase
      .from("consultations")
      .select("id, status")
      .eq("id", data.consultationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (consultationError) throw new Error(consultationError.message);
    if (!consultation) throw new Error("Consultation not found.");
    if (consultation.status !== "active") throw new Error("This consultation has already ended.");

    const { data: patientMessage, error: insertError } = await supabase
      .from("messages")
      .insert({ consultation_id: data.consultationId, role: "PATIENT", content: data.content })
      .select("id, role, content, timestamp")
      .single();
    if (insertError) throw new Error(insertError.message);

    const { data: history, error: historyError } = await supabase
      .from("messages")
      .select("role, content")
      .eq("consultation_id", data.consultationId)
      .order("timestamp", { ascending: true })
      .limit(40);
    if (historyError) throw new Error(historyError.message);

    const transcript = (history ?? []).filter((m) => m.role === "PATIENT" || m.role === "AI_DOCTOR");
    const turns = transcript.map((m) => ({
      role: m.role === "PATIENT" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    const { deriveConsultationState } = await import("./consultation-engine");
    const state = deriveConsultationState(transcript);

    const { content, demo } = await generateDoctorReply(turns, state);

    const { data: doctorMessage, error: replyError } = await supabase
      .from("messages")
      .insert({ consultation_id: data.consultationId, role: "AI_DOCTOR", content })
      .select("id, role, content, timestamp")
      .single();
    if (replyError) throw new Error(replyError.message);

    await supabase
      .from("consultations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.consultationId);

    const nextState = deriveConsultationState([...transcript, { role: "AI_DOCTOR", content }]);

    return { patientMessage, doctorMessage, demo, state: nextState };
  });


export const getAiDoctorStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { getAIProvider } = await import("./providers/index.server");
  const provider = getAIProvider();
  return { demo: provider.isDemo, model: provider.model };
});

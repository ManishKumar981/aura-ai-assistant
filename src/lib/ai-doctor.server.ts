/**
 * Server-only AI Doctor provider layer.
 *
 * The provider is intentionally replaceable: any OpenAI-compatible chat
 * completions endpoint works by setting AI_DOCTOR_BASE_URL / AI_DOCTOR_MODEL /
 * AI_DOCTOR_API_KEY. By default it uses the built-in hosted gateway.
 * When no key is available (or AI_DOCTOR_MODE=demo) a deterministic demo
 * responder is used so the UI can be exercised without an API key.
 */

import { stateGuidance, type ConsultationState } from "./consultation-engine";
import { getAIProvider } from "./providers/index.server";

export type ChatTurn = { role: "user" | "assistant"; content: string };


export const AI_DOCTOR_SYSTEM_PROMPT = `You are "AI Doctor", a cautious medical information assistant used inside a clinical documentation tool.

Identity and limits:
- You are NOT a licensed doctor and must never claim or imply that you are.
- Never state a confirmed diagnosis. Offer only possibilities, phrased with explicit uncertainty ("this could be consistent with...", "I can't be sure without an in-person exam").
- Never prescribe medication, dosages, or treatment plans on your own. You may mention that a clinician might consider certain options, and general self-care that is widely accepted.
- Always be clear that a qualified human clinician must confirm anything you say.

How to conduct the conversation:
- Take a structured history. Ask ONE or TWO focused follow-up questions per reply, not a long list.
- Systematically cover, when relevant: onset and duration, severity, location and character, what makes it better or worse, associated symptoms, relevant past medical history, current medications and allergies.
- Explicitly ask about red-flag / warning signs appropriate to the reported symptoms (for example chest pain with breathlessness, sudden severe headache, weakness or numbness on one side, high fever with neck stiffness, blood in stool or vomit, fainting, difficulty breathing).
- If the patient reports anything that could be an emergency, say so plainly and advise urgent in-person or emergency care immediately.
- Explain medical terms in plain language. Be warm, concise and calm.
- Keep answers under about 150 words.`;

const DEMO_SEQUENCE = [
  "Thanks for sharing that. I'm an AI assistant, not a licensed doctor, so I can't diagnose you — but I can help organise your history for a clinician. How long has this been going on, and did it start suddenly or gradually?",
  "That's helpful. On a scale of 1 to 10, how severe is it at its worst, and does anything make it noticeably better or worse?",
  "Understood. I'd like to check a few warning signs: any chest pain, shortness of breath, fainting, high fever, or weakness on one side of the body? If any of these are present, please seek urgent in-person care.",
  "Thank you. Are you taking any regular medications, and do you have any known allergies or ongoing conditions such as diabetes, asthma or high blood pressure?",
  "Based on what you've described, several common causes could fit, but I can't be certain without an examination and possibly tests — so please treat this as information rather than a diagnosis. A clinician should review your symptoms, and you should seek care sooner if anything worsens. Is there anything else you'd like to add before we wrap up?",
];

export function demoReply(history: ChatTurn[], state?: ConsultationState): string {
  if (state) {
    const ack = "Thanks — I've noted that.";
    if (state.emergency) {
      return `${ack} What you've described could be serious, so please seek urgent in-person or emergency care now. I'm an AI assistant, not a licensed doctor, and I can't diagnose you. ${state.nextQuestion ?? "Is anyone with you who can help you get seen quickly?"}`;
    }
    if (state.nextQuestion) return `${ack} ${state.nextQuestion}`;
    return "Thank you — that gives me a clear picture. To recap what you told me, I've captured your main concern, how long it has lasted, how severe it is, the warning signs we checked, and your background history. I can't give a diagnosis, so a qualified clinician should review this. Please seek care sooner if anything worsens. You can end the consultation whenever you're ready.";
  }
  const patientTurns = history.filter((t) => t.role === "user").length;
  const idx = Math.min(Math.max(patientTurns - 1, 0), DEMO_SEQUENCE.length - 1);
  return DEMO_SEQUENCE[idx]!;
}


export async function generateDoctorReply(
  history: ChatTurn[],
  state?: ConsultationState,
): Promise<{ content: string; demo: boolean }> {
  const provider = getAIProvider();
  if (provider.isDemo) return { content: demoReply(history, state), demo: true };

  const systemContent = state
    ? `${AI_DOCTOR_SYSTEM_PROMPT}\n\n${stateGuidance(state)}`
    : AI_DOCTOR_SYSTEM_PROMPT;

  const { content } = await provider.generateResponse({
    system: systemContent,
    messages: history,
  });
  return { content, demo: false };
}

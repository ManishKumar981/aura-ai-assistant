/**
 * Structured symptom-driven consultation engine (client + server safe).
 *
 * Derives the live state of a consultation from the preserved transcript only —
 * no invented content. It tracks which parts of a structured history have been
 * covered, which red flags have been screened, what the current stage is and
 * which single question should come next. Both the AI Doctor prompt and the UI
 * read from this one source of truth so the assistant never loops on questions
 * that were already answered.
 */

export type EngineTurn = { role: string; content: string };

export const CONSULTATION_STAGES = [
  "INTAKE",
  "SYMPTOM_DETAIL",
  "RED_FLAG_SCREEN",
  "BACKGROUND",
  "WRAP_UP",
  "COMPLETE",
] as const;

export type ConsultationStage = (typeof CONSULTATION_STAGES)[number];

export const STAGE_LABELS: Record<ConsultationStage, string> = {
  INTAKE: "Presenting complaint",
  SYMPTOM_DETAIL: "Symptom characterisation",
  RED_FLAG_SCREEN: "Red-flag screening",
  BACKGROUND: "Background history",
  WRAP_UP: "Wrap-up",
  COMPLETE: "History complete",
};

export type SlotId =
  | "chief_complaint"
  | "onset"
  | "duration"
  | "severity"
  | "character"
  | "modifiers"
  | "associated"
  | "red_flags"
  | "medical_history"
  | "medications"
  | "allergies";

type SlotDef = {
  id: SlotId;
  label: string;
  stage: ConsultationStage;
  question: string;
  /** Patterns that indicate the patient supplied this information. */
  patient: RegExp[];
  /** When true the slot can also be satisfied by the patient answering the doctor's question. */
  answeredIfAsked?: boolean;
};

const AFFIRM_OR_DENY =
  /\b(yes|yeah|yep|no|nope|none|not really|nothing|never|i (?:do|don't|dont|have|haven't|havent))\b/i;

const SLOTS: SlotDef[] = [
  {
    id: "chief_complaint",
    label: "Chief complaint",
    stage: "INTAKE",
    question: "What is the main problem that brought you here today?",
    patient: [/\S{3,}/],
  },
  {
    id: "onset",
    label: "Onset",
    stage: "SYMPTOM_DETAIL",
    question: "Did this start suddenly or come on gradually?",
    patient: [/\b(sudden\w*|gradual\w*|slowly|all at once|out of nowhere|after|since (?:i|the|a)\b|started\b)/i],
  },
  {
    id: "duration",
    label: "Duration",
    stage: "SYMPTOM_DETAIL",
    question: "How long has this been going on?",
    patient: [
      /\b(?:for|since|about|around|past|last)?\s*(?:\d+|a|an|couple of|few|several)\s*(?:minute|hour|day|week|month|year)s?\b/i,
      /\b(today|yesterday|this morning|last night|since (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
    ],
  },
  {
    id: "severity",
    label: "Severity",
    stage: "SYMPTOM_DETAIL",
    question: "On a scale of 1 to 10, how bad is it at its worst?",
    patient: [/\b\d{1,2}\s*(?:\/|out of)\s*10\b/i, /\b(mild|moderate|severe|unbearable|excruciating|slight|intense|bearable)\b/i],
  },
  {
    id: "character",
    label: "Location & character",
    stage: "SYMPTOM_DETAIL",
    question: "Where exactly do you feel it, and how would you describe it (sharp, dull, burning, throbbing)?",
    patient: [
      /\b(sharp|dull|burning|throbbing|stabbing|cramp\w*|aching|pressure|tight\w*|shooting|constant|comes and goes|intermittent)\b/i,
      /\b(left|right|front|back|behind|upper|lower|side|chest|head|stomach|abdomen|throat|leg|arm|neck|forehead|temple)\b/i,
    ],
  },
  {
    id: "modifiers",
    label: "Better / worse factors",
    stage: "SYMPTOM_DETAIL",
    question: "Is there anything that makes it noticeably better or worse?",
    patient: [/\b(better|worse|worsen\w*|improv\w*|relieve\w*|helps|eases|aggravat\w*|triggers?|when i)\b/i],
    answeredIfAsked: true,
  },
  {
    id: "associated",
    label: "Associated symptoms",
    stage: "SYMPTOM_DETAIL",
    question: "Have you noticed any other symptoms alongside it?",
    patient: [
      /\b(also|as well|along with|too|and i (?:have|feel|get))\b/i,
      /\b(fever|cough|nausea|vomit\w*|diarrh\w*|rash|chills|fatigue|tired|dizzy|dizziness|sweating|headache|appetite|sleep)\b/i,
    ],
    answeredIfAsked: true,
  },
  {
    id: "red_flags",
    label: "Red-flag screening",
    stage: "RED_FLAG_SCREEN",
    question:
      "A few safety checks: any chest pain, difficulty breathing, fainting, high fever, one-sided weakness, or blood in vomit or stool?",
    patient: [
      /\b(chest pain|shortness of breath|breathless\w*|can'?t breathe|faint\w*|blackout|passed out|high fever|neck stiffness|numbness|weakness on one side|slurred speech|blood in)\b/i,
    ],
    answeredIfAsked: true,
  },
  {
    id: "medical_history",
    label: "Medical history",
    stage: "BACKGROUND",
    question: "Do you have any ongoing medical conditions or past illnesses I should know about?",
    patient: [
      /\b(diabetes|asthma|blood pressure|hypertension|thyroid|migraine|epilepsy|cancer|heart|anaemia|anemia|arthritis|kidney|pregnan\w+|surgery|copd|cholesterol|no (?:medical )?(?:history|conditions)|nothing (?:else|like that))\b/i,
    ],
    answeredIfAsked: true,
  },
  {
    id: "medications",
    label: "Current medications",
    stage: "BACKGROUND",
    question: "Are you taking any regular medications right now?",
    patient: [/\b(taking|took|on)\s+[a-z]/i, /\b(no|not on|none)\b.{0,20}\b(medication|medicine|tablets|pills|drugs)\b/i],
    answeredIfAsked: true,
  },
  {
    id: "allergies",
    label: "Allergies",
    stage: "BACKGROUND",
    question: "Do you have any known allergies?",
    patient: [/\ballerg\w*/i],
    answeredIfAsked: true,
  },
];

export type SlotState = { id: SlotId; label: string; stage: ConsultationStage; filled: boolean; asked: boolean };

export type ConsultationState = {
  stage: ConsultationStage;
  stageLabel: string;
  slots: SlotState[];
  pending: SlotId[];
  nextFocus: SlotId | null;
  nextQuestion: string | null;
  completeness: number;
  patientTurns: number;
  redFlags: string[];
  emergency: boolean;
};

const RED_FLAG_TERMS: Array<{ re: RegExp; label: string; emergency: boolean }> = [
  { re: /\bchest pain\b/i, label: "Chest pain", emergency: true },
  { re: /\b(shortness of breath|breathless\w*|can'?t breathe|difficulty breathing)\b/i, label: "Breathlessness", emergency: true },
  { re: /\b(slurred speech)\b/i, label: "Slurred speech", emergency: true },
  { re: /\b(weakness on one side|one[- ]sided weakness)\b/i, label: "One-sided weakness", emergency: true },
  { re: /\bblood in (?:my )?(?:stool|vomit|urine)\b/i, label: "Visible bleeding", emergency: true },
  { re: /\b(seizure|unconscious|passed out|fainted|fainting)\b/i, label: "Loss of consciousness", emergency: true },
  { re: /\bsuicidal\b/i, label: "Suicidal thoughts", emergency: true },
  { re: /\bhigh fever\b/i, label: "High fever", emergency: false },
  { re: /\bneck stiffness\b/i, label: "Neck stiffness", emergency: false },
  { re: /\bnumbness\b/i, label: "Numbness", emergency: false },
  { re: /\bsevere (?:pain|headache|bleeding)\b/i, label: "Severe pain", emergency: false },
];

/** Rough negation guard so "no chest pain" is not read as a red flag. */
function isNegated(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - 30), index).toLowerCase();
  return /\b(no|not|never|without|denies|haven'?t|don'?t|any)\b[^.;!?]*$/.test(window);
}

function detectRedFlags(patientText: string): { flags: string[]; emergency: boolean } {
  const flags: string[] = [];
  let emergency = false;
  for (const term of RED_FLAG_TERMS) {
    const match = term.re.exec(patientText);
    if (!match || match.index === undefined) continue;
    if (isNegated(patientText, match.index)) continue;
    if (!flags.includes(term.label)) flags.push(term.label);
    if (term.emergency) emergency = true;
  }
  return { flags, emergency };
}

export function deriveConsultationState(turns: EngineTurn[]): ConsultationState {
  const patient = turns.filter((t) => t.role === "PATIENT");
  const doctor = turns.filter((t) => t.role === "AI_DOCTOR");
  const patientText = patient.map((t) => t.content).join("\n");
  const doctorText = doctor.map((t) => t.content).join("\n");
  const lastPatient = patient[patient.length - 1]?.content ?? "";
  const lastDoctor = doctor[doctor.length - 1]?.content ?? "";

  const slots: SlotState[] = SLOTS.map((slot) => {
    const asked =
      slot.id === "chief_complaint"
        ? patient.length > 0
        : slot.patient.some((re) => re.test(doctorText)) || askedMarker(slot.id, doctorText);
    let filled = slot.patient.some((re) => re.test(patientText));
    if (!filled && slot.answeredIfAsked) {
      // The patient answered the doctor's question directly ("no", "none", "yes").
      const doctorAskedLast = askedMarker(slot.id, lastDoctor) || slot.patient.some((re) => re.test(lastDoctor));
      if (doctorAskedLast && AFFIRM_OR_DENY.test(lastPatient)) filled = true;
    }
    if (slot.id === "chief_complaint") filled = patient.length > 0 && patientText.trim().length > 2;
    return { id: slot.id, label: slot.label, stage: slot.stage, filled, asked };
  });

  const pending = slots.filter((s) => !s.filled).map((s) => s.id);
  const nextSlot = SLOTS.find((s) => pending.includes(s.id)) ?? null;
  const { flags, emergency } = detectRedFlags(patientText);

  // Red flags jump the queue: screen them as soon as one is mentioned.
  const redFlagSlot = slots.find((s) => s.id === "red_flags");
  const focusSlot =
    flags.length > 0 && redFlagSlot && !redFlagSlot.filled ? SLOTS.find((s) => s.id === "red_flags")! : nextSlot;

  const filledCount = slots.filter((s) => s.filled).length;
  const completeness = Math.round((filledCount / slots.length) * 100);
  const stage: ConsultationStage = focusSlot ? focusSlot.stage : patient.length >= 3 ? "COMPLETE" : "WRAP_UP";

  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    slots,
    pending,
    nextFocus: focusSlot?.id ?? null,
    nextQuestion: focusSlot?.question ?? null,
    completeness,
    patientTurns: patient.length,
    redFlags: flags,
    emergency,
  };
}

/** Heuristic: did the doctor already ask about this topic? */
function askedMarker(id: SlotId, text: string): boolean {
  const markers: Record<SlotId, RegExp> = {
    chief_complaint: /\b(what brings|main (?:problem|concern)|how can i help)\b/i,
    onset: /\b(start(?:ed)? (?:suddenly|gradually)|come on|when did it (?:start|begin))\b/i,
    duration: /\b(how long|since when|duration)\b/i,
    severity: /\b(scale of 1|1 to 10|how (?:bad|severe))\b/i,
    character: /\b(where (?:exactly|do you)|describe it|sharp|dull|burning|throbbing)\b/i,
    modifiers: /\b(better or worse|makes it (?:better|worse)|relieve)\b/i,
    associated: /\b(other symptoms|anything else|alongside|associated)\b/i,
    red_flags: /\b(chest pain|shortness of breath|warning sign|red flag|fainting|one side)\b/i,
    medical_history: /\b(medical (?:history|conditions)|ongoing conditions|past illness|diabetes|asthma)\b/i,
    medications: /\b(medications?|medicines?|tablets|taking anything)\b/i,
    allergies: /\ballerg\w*/i,
  };
  return markers[id].test(text);
}

/** Guidance block injected into the AI Doctor system prompt each turn. */
export function stateGuidance(state: ConsultationState): string {
  const covered = state.slots.filter((s) => s.filled).map((s) => s.label);
  const remaining = state.slots.filter((s) => !s.filled).map((s) => s.label);
  const lines = [
    `CONSULTATION STATE (derived from the transcript — treat as fact):`,
    `- Current stage: ${STAGE_LABELS[state.stage]}`,
    `- Already covered (do NOT ask about these again): ${covered.length ? covered.join(", ") : "nothing yet"}`,
    `- Still missing: ${remaining.length ? remaining.join(", ") : "nothing — move to wrap-up"}`,
  ];
  if (state.nextQuestion) {
    lines.push(`- Your next reply MUST briefly acknowledge what the patient just said, then ask about: ${state.nextQuestion}`);
  } else {
    lines.push(
      `- The structured history is complete. Give a short factual recap of what was discussed, safety-netting advice, and remind the patient a clinician must review it. Do not state a diagnosis.`,
    );
  }
  if (state.redFlags.length) {
    lines.push(`- Red flags mentioned by the patient: ${state.redFlags.join(", ")}.`);
    if (state.emergency) {
      lines.push(`- This is potentially an emergency: open your reply by advising immediate in-person or emergency care.`);
    }
  }
  return lines.join("\n");
}

/**
 * Server-only analysis layer: turns a preserved consultation transcript into
 * structured medical information. Uses the same replaceable hosted provider as
 * the AI Doctor; falls back to a deterministic, strictly literal extractor when
 * no provider key is configured (demo mode).
 */
import { aiDoctorConfig } from "./ai-doctor.server";
import { EMPTY_EXTRACTION, RISK_LEVELS, deriveRiskLevel, type ExtractionResult, type RiskLevel } from "./consultation-extraction";

export type TranscriptTurn = { role: string; content: string; timestamp: string };

const EXTRACTION_SYSTEM_PROMPT = `You extract structured medical information from a consultation transcript between a PATIENT and an AI_DOCTOR assistant.

ABSOLUTE RULES:
- Extract ONLY information explicitly stated in the transcript.
- NEVER invent, infer, estimate or embellish. No vital signs, temperatures, lab values, diagnoses or medications unless the transcript literally contains them.
- If something was not mentioned, use null (for single values) or an empty array (for lists). Do not write placeholders.
- Quote or closely paraphrase the patient's own words.
- Recommendations may only come from what the AI_DOCTOR actually said.
- The summary must be a short factual recap of what was discussed. It must not contain a confirmed diagnosis.

Respond with ONLY a JSON object, no markdown fences, using exactly this shape:
{
  "chief_complaint": string|null,
  "symptoms": [{"name": string, "duration": string|null, "severity": string|null, "notes": string|null}],
  "duration": string|null,
  "severity": string|null,
  "medications": string[],
  "allergies": string[],
  "medical_history": string[],
  "negative_findings": string[],
  "risk_indicators": string[],
  "recommendations": string[],
  "follow_up": string|null,
  "risk_level": "low"|"moderate"|"high"|"emergency"|null,
  "summary": string
}`;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0 && v.toLowerCase() !== "not reported" && v.toLowerCase() !== "none");
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "not reported" || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

function asRiskLevel(value: unknown): RiskLevel | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (RISK_LEVELS as readonly string[]).includes(v) ? (v as RiskLevel) : null;
}

export function normaliseExtraction(raw: unknown): ExtractionResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const symptoms = Array.isArray(obj["symptoms"])
    ? (obj["symptoms"] as unknown[])
        .map((s) => {
          const item = (s ?? {}) as Record<string, unknown>;
          const name = asNullableString(item["name"]);
          if (!name) return null;
          return {
            name,
            duration: asNullableString(item["duration"]),
            severity: asNullableString(item["severity"]),
            notes: asNullableString(item["notes"]),
          };
        })
        .filter((s): s is ExtractionResult["symptoms"][number] => s !== null)
    : [];

  return {
    chief_complaint: asNullableString(obj["chief_complaint"]),
    symptoms,
    duration: asNullableString(obj["duration"]),
    severity: asNullableString(obj["severity"]),
    medications: asStringArray(obj["medications"]),
    allergies: asStringArray(obj["allergies"]),
    medical_history: asStringArray(obj["medical_history"]),
    negative_findings: asStringArray(obj["negative_findings"]),
    risk_indicators: asStringArray(obj["risk_indicators"]),
    recommendations: asStringArray(obj["recommendations"]),
    follow_up: asNullableString(obj["follow_up"]),
    risk_level: asRiskLevel(obj["risk_level"]),
    summary: asNullableString(obj["summary"]) ?? "",
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic literal extractor (demo / provider-less fallback)      */
/* ------------------------------------------------------------------ */

const DURATION_RE =
  /\b(?:for|since|about|around|past|last)?\s*(\d+|a|an|couple of|few|several)\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\b/i;
const SEVERITY_RE = /\b(\d{1,2})\s*(?:\/|out of)\s*10\b/i;
const SEVERITY_WORD_RE = /\b(mild|moderate|severe|unbearable|excruciating|slight|intense)\b/i;
const MED_RE =
  /\b(?:taking|took|take|on|using|used)\s+([a-z][a-z0-9\- ]{2,40}?)(?:\s+(?:for|twice|once|daily|every|since|at)\b|[.,;!?]|$)/gi;
const ALLERGY_RE = /\ballerg(?:ic|y|ies)\s*(?:to)?\s*([a-z][a-z0-9\-, ]{2,60})?/gi;
const HISTORY_RE =
  /\b(diabetes|asthma|high blood pressure|hypertension|thyroid|migraine|epilepsy|cancer|heart disease|anaemia|anemia|arthritis|kidney disease|pregnan\w+|surgery|copd|cholesterol)\b/gi;
const RISK_RE =
  /\b(chest pain|shortness of breath|breathless\w*|fainting|fainted|blood in (?:my )?(?:stool|vomit|urine)|numbness|weakness on one side|slurred speech|high fever|neck stiffness|unconscious|seizure|severe bleeding|suicidal)\b/gi;
const NEGATION_RE =
  /\b(?:no|not|don't|dont|haven't|havent|never|without|denies)\b[^.,;!?]{0,60}/gi;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

const SYMPTOM_TERMS = [
  "fever", "headache", "cough", "sore throat", "nausea", "vomiting", "diarrhoea", "diarrhea",
  "fatigue", "tired", "dizziness", "dizzy", "rash", "pain", "ache", "cramps", "chills",
  "runny nose", "congestion", "sneezing", "shortness of breath", "chest pain", "back pain",
  "stomach pain", "abdominal pain", "insomnia", "swelling", "itching", "blurred vision",
  "palpitations", "sweating", "weakness", "loss of appetite", "vomited",
];

function withRisk(extraction: ExtractionResult): ExtractionResult {
  return { ...extraction, risk_level: extraction.risk_level ?? deriveRiskLevel(extraction.risk_indicators) };
}

export function literalExtraction(turns: TranscriptTurn[]): ExtractionResult {
  const patient = turns.filter((t) => t.role === "PATIENT");
  const doctor = turns.filter((t) => t.role === "AI_DOCTOR");
  const patientText = patient.map((t) => t.content).join("\n");
  const result: ExtractionResult = { ...EMPTY_EXTRACTION, symptoms: [] };

  // Chief complaint: the patient's first statement, verbatim.
  const first = patient[0]?.content.trim();
  if (first) result.chief_complaint = sentences(first)[0] ?? first;

  const lower = patientText.toLowerCase();
  const negatedSpans = uniq((patientText.match(NEGATION_RE) ?? []).map((s) => s.trim()));
  const negatedText = negatedSpans.join(" | ").toLowerCase();

  const foundSymptoms = SYMPTOM_TERMS.filter(
    (term) => lower.includes(term) && !negatedText.includes(term),
  );

  const durationMatch = patientText.match(DURATION_RE);
  const duration = durationMatch ? durationMatch[0].trim() : null;
  const sevNum = patientText.match(SEVERITY_RE);
  const sevWord = patientText.match(SEVERITY_WORD_RE);
  const severity = sevNum ? `${sevNum[1]}/10` : sevWord ? sevWord[1]!.toLowerCase() : null;

  result.duration = duration;
  result.severity = severity;
  result.symptoms = uniq(foundSymptoms).map((name, index) => ({
    name,
    duration: index === 0 ? duration : null,
    severity: index === 0 ? severity : null,
    notes: null,
  }));

  for (const match of patientText.matchAll(MED_RE)) {
    const candidate = match[1]?.trim();
    if (candidate && candidate.split(/\s+/).length <= 4 && !/\b(it|this|that|them|care|rest)\b/i.test(candidate)) {
      result.medications.push(candidate);
    }
  }
  result.medications = uniq(result.medications);

  for (const match of patientText.matchAll(ALLERGY_RE)) {
    const subject = match[1]?.trim().replace(/[.,;]$/, "");
    if (/\bno\b|\bnone\b|\bnot\b/i.test(match[0])) continue;
    if (subject) result.allergies.push(subject);
  }
  result.allergies = uniq(result.allergies);

  result.medical_history = uniq((patientText.match(HISTORY_RE) ?? []).map((s) => s.toLowerCase()));
  result.risk_indicators = uniq(
    (patientText.match(RISK_RE) ?? [])
      .map((s) => s.toLowerCase())
      .filter((s) => !negatedText.includes(s)),
  );
  result.negative_findings = negatedSpans.slice(0, 8);

  for (const turn of doctor) {
    for (const sentence of sentences(turn.content)) {
      if (
        /\b(should|advise|recommend|please|seek|consider|make sure|try to|avoid|monitor)\b/i.test(sentence) &&
        sentence.length < 220
      ) {
        result.recommendations.push(sentence);
      }
    }
  }
  result.recommendations = uniq(result.recommendations).slice(0, 6);

  const followUp = doctor
    .flatMap((t) => sentences(t.content))
    .find((s) => /\b(follow[- ]up|see a (?:doctor|clinician|gp)|book|appointment|come back|review)\b/i.test(s));
  result.follow_up = followUp ?? null;

  const complaint = result.chief_complaint ?? "the reported concern";
  result.summary = [
    `The patient described: ${complaint}`,
    result.symptoms.length ? `Symptoms mentioned: ${result.symptoms.map((s) => s.name).join(", ")}.` : "",
    duration ? `Reported duration: ${duration}.` : "",
    severity ? `Reported severity: ${severity}.` : "",
    `The assistant took a structured history over ${turns.length} conversation turns. No diagnosis was made; a qualified clinician must review this transcript.`,
  ]
    .filter(Boolean)
    .join(" ");

  return result;
}

/* ------------------------------------------------------------------ */

function transcriptToText(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => `[${new Date(t.timestamp).toISOString()}] ${t.role}: ${t.content}`)
    .join("\n");
}

function parseJsonBlock(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function analyseTranscript(
  turns: TranscriptTurn[],
): Promise<{ extraction: ExtractionResult; generatedBy: string }> {
  const relevant = turns.filter((t) => t.role === "PATIENT" || t.role === "AI_DOCTOR");
  if (relevant.length === 0) {
    return { extraction: { ...EMPTY_EXTRACTION, summary: "No conversation was recorded." }, generatedBy: "empty" };
  }

  const { apiKey, baseUrl, model, demo } = aiDoctorConfig();
  if (demo) return { extraction: withRisk(literalExtraction(relevant)), generatedBy: "rules" };

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey!,
        Authorization: `Bearer ${apiKey!}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: `TRANSCRIPT:\n${transcriptToText(relevant)}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`provider ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonBlock(content);
    if (!parsed) throw new Error("unparsable extraction");
    const extraction = normaliseExtraction(parsed);
    if (!extraction.summary) extraction.summary = literalExtraction(relevant).summary;
    if (!extraction.risk_level) extraction.risk_level = deriveRiskLevel(extraction.risk_indicators);
    return { extraction, generatedBy: model };
  } catch (error) {
    console.error("Extraction failed, falling back to literal extractor", error);
    return { extraction: withRisk(literalExtraction(relevant)), generatedBy: "rules-fallback" };
  }
}

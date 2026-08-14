/** Shared (client + server safe) types for consultation medical extraction. */

export type ExtractedSymptom = {
  name: string;
  duration: string | null;
  severity: string | null;
  notes: string | null;
};

export type ExtractionResult = {
  chief_complaint: string | null;
  symptoms: ExtractedSymptom[];
  duration: string | null;
  severity: string | null;
  medications: string[];
  allergies: string[];
  medical_history: string[];
  negative_findings: string[];
  risk_indicators: string[];
  recommendations: string[];
  follow_up: string | null;
  summary: string;
};

export const EMPTY_EXTRACTION: ExtractionResult = {
  chief_complaint: null,
  symptoms: [],
  duration: null,
  severity: null,
  medications: [],
  allergies: [],
  medical_history: [],
  negative_findings: [],
  risk_indicators: [],
  recommendations: [],
  follow_up: null,
  summary: "",
};

export const NOT_REPORTED = "Not reported";

export const POINT_CATEGORIES = [
  "chief_complaint",
  "symptom",
  "duration",
  "severity",
  "medication",
  "allergy",
  "medical_history",
  "negative_finding",
  "risk_indicator",
  "recommendation",
  "follow_up",
] as const;

export type PointCategory = (typeof POINT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  chief_complaint: "Chief complaint",
  symptom: "Symptoms",
  duration: "Duration",
  severity: "Severity",
  medication: "Medications mentioned",
  allergy: "Allergies mentioned",
  medical_history: "Relevant medical history",
  negative_finding: "Important negative symptoms",
  risk_indicator: "Risk indicators",
  recommendation: "Recommendations",
  follow_up: "Follow-up",
};

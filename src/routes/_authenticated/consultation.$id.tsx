import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, ClipboardList, Download, FileText, Info, ShieldAlert, User as UserIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABELS, POINT_CATEGORIES, RISK_LABELS, type RiskLevel } from "@/lib/consultation-extraction";
import { useServerFn } from "@tanstack/react-start";
import { getConsultationPdfUrl, generateConsultationPdfUrl } from "@/lib/pdf.functions";
import { useState } from "react";


export const Route = createFileRoute("/_authenticated/consultation/$id")({
  head: () => ({
    meta: [
      { title: "Consultation results — MediScribe AI" },
      { name: "description", content: "Structured summary, extracted medical points and the full preserved transcript of a consultation." },
      { property: "og:title", content: "Consultation results — MediScribe AI" },
      { property: "og:description", content: "Summary, important points and full transcript of a recorded consultation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResultsPage,
});

const ROLE_META: Record<string, { label: string; icon: typeof Bot }> = {
  PATIENT: { label: "Patient", icon: UserIcon },
  AI_DOCTOR: { label: "AI Doctor", icon: Bot },
  SYSTEM: { label: "System", icon: Info },
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm">{value?.trim() || "Not reported"}</p>
    </div>
  );
}

function ResultsPage() {
  const { id } = Route.useParams();
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const getPdfUrl = useServerFn(getConsultationPdfUrl);
  const generatePdf = useServerFn(generateConsultationPdfUrl);

  const handleDownload = async () => {
    if (!id) return;
    setIsGeneratingPdf(true);
    try {
      let url = consultation.data?.pdf_url;
      if (!url) {
        const result = await generatePdf({ data: { consultationId: id } });
        url = result.pdfUrl;
      } else {
        const result = await getPdfUrl({ data: { consultationId: id } });
        url = result.pdfUrl;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setIsGeneratingPdf(false);
    }
  };


  const consultation = useQuery({
    queryKey: ["consultation", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultations")
        .select("id, title, status, started_at, ended_at, pdf_url")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });


  const summary = useQuery({
    queryKey: ["summary", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultation_summaries")
        .select("chief_complaint, subjective, objective, assessment, plan, overview, follow_up, risk_level, generated_by")
        .eq("consultation_id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const points = useQuery({
    queryKey: ["medical-points", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("medical_points")
        .select("id, category, content, evidence")
        .eq("consultation_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const transcript = useQuery({
    queryKey: ["messages", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, timestamp")
        .eq("consultation_id", id)
        .order("timestamp", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const grouped = POINT_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category] ?? category,
    items: (points.data ?? []).filter((p) => p.category === category),
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/history" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
            <ArrowLeft className="size-3" /> Back to history
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{consultation.data?.title ?? "Consultation results"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {consultation.data?.started_at ? new Date(consultation.data.started_at).toLocaleString() : ""}
            {consultation.data?.ended_at ? ` · ended ${new Date(consultation.data.ended_at).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {consultation.data && <Badge variant="secondary">{consultation.data.status}</Badge>}
          <Badge variant="outline">{transcript.data?.length ?? 0} turns preserved</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={isGeneratingPdf || consultation.data?.status !== "completed"}
            className="gap-2"
          >
            <Download className="size-4" />
            {isGeneratingPdf ? "Generating PDF…" : "Download PDF"}
          </Button>
        </div>
      </header>


      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/60 p-4">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Medical disclaimer:</span> this record was produced by an AI
          assistant, not a licensed clinician. Only information explicitly stated in the conversation is extracted —
          anything not mentioned is shown as “Not reported”. This document was generated by an AI system for
          informational and decision-support purposes. It is not a medical diagnosis or a substitute for professional
          medical care.
        </p>
      </div>

      <section className="clinical-panel p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <FileText className="size-4 text-muted-foreground" /> AI-generated consultation summary
        </h2>
        {summary.isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
        {!summary.isLoading && !summary.data && (
          <p className="mt-3 text-sm text-muted-foreground">
            No summary yet — end the consultation from the assistant to generate one.
          </p>
        )}
        {summary.data && (
          <div className="mt-4 space-y-4">
            <p className="whitespace-pre-wrap text-sm">{summary.data.overview || "Not reported"}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Consultation date"
                value={consultation.data?.started_at ? new Date(consultation.data.started_at).toLocaleString() : null}
              />
              <Field
                label="Risk / triage level"
                value={
                  summary.data.risk_level
                    ? RISK_LABELS[summary.data.risk_level as RiskLevel] ?? summary.data.risk_level
                    : null
                }
              />
              <Field label="Chief complaint" value={summary.data.chief_complaint} />
              <Field label="Follow-up" value={summary.data.follow_up} />
              <Field label="Subjective" value={summary.data.subjective} />
              <Field label="Objective" value={summary.data.objective} />
              <Field label="Assessment" value={summary.data.assessment} />
              <Field label="Recommended next steps" value={summary.data.plan} />
            </div>
          </div>
        )}
      </section>

      <section className="clinical-panel p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardList className="size-4 text-muted-foreground" /> Important points
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {grouped.map((group) => (
            <div key={group.category}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</p>
              {group.items.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">Not reported</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {group.items.map((item) => (
                    <li key={item.id} className="text-sm">
                      • {item.content}
                      {item.evidence && (
                        <span className="block pl-3 text-xs italic text-muted-foreground">“{item.evidence}”</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="clinical-panel p-6">
        <h2 className="text-lg font-semibold">Full transcript</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The original conversation, preserved turn by turn exactly as it was recorded.
        </p>
        <div className="mt-4 space-y-4">
          {transcript.data?.length === 0 && <p className="text-sm text-muted-foreground">No messages recorded.</p>}
          {transcript.data?.map((m) => {
            const meta = ROLE_META[m.role] ?? ROLE_META['SYSTEM']!;
            return (
              <div key={m.id} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <meta.icon className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {meta.label} · {new Date(m.timestamp).toLocaleString()}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{m.content}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

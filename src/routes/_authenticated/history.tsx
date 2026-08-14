import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, Stethoscope } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { RISK_LABELS, type RiskLevel } from "@/lib/consultation-extraction";

type SummaryRel = { chief_complaint: string | null; risk_level: string | null };

function summaryOf(row: { consultation_summaries: SummaryRel | SummaryRel[] | null }): SummaryRel | null {
  const rel = row.consultation_summaries;
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

function riskVariant(level: string | null | undefined) {
  if (level === "emergency" || level === "high") return "destructive" as const;
  return "outline" as const;
}

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "Consultation history — MediScribe AI" },
      { name: "description", content: "Browse every consultation you have recorded and open its transcript." },
      { property: "og:title", content: "Consultation history — MediScribe AI" },
      { property: "og:description", content: "Browse every consultation you have recorded." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const consultations = useQuery({
    queryKey: ["consultations", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultations")
        .select("id, title, status, created_at, ended_at, consultation_summaries(chief_complaint, risk_level)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Consultation history</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every encounter recorded under your account.</p>
      </header>

      <div className="clinical-panel divide-y divide-border">
        {consultations.isLoading && <p className="p-6 text-sm text-muted-foreground">Loading…</p>}
        {consultations.data?.length === 0 && (
          <div className="p-12 text-center">
            <Stethoscope className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">Nothing here yet.</p>
          </div>
        )}
        {consultations.data?.map((c) => (
          <Link
            key={c.id}
            {...(c.status === "active"
              ? ({ to: "/assistant", search: { consultation: c.id } } as const)
              : ({ to: "/consultation/$id", params: { id: c.id } } as const))}
            className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-secondary"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{c.title}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                Chief complaint: {summaryOf(c)?.chief_complaint?.trim() || "Not reported"}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" />
                {new Date(c.created_at).toLocaleString()}
                {c.ended_at ? ` · ended ${new Date(c.ended_at).toLocaleTimeString()}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={riskVariant(summaryOf(c)?.risk_level)}>
                Risk: {summaryOf(c)?.risk_level ? RISK_LABELS[summaryOf(c)!.risk_level as RiskLevel] ?? summaryOf(c)!.risk_level : "—"}
              </Badge>
              <Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

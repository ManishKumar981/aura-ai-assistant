import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, Stethoscope } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

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
        .select("id, title, status, created_at, ended_at")
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
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" />
                {new Date(c.created_at).toLocaleString()}
                {c.ended_at ? ` · ended ${new Date(c.ended_at).toLocaleTimeString()}` : ""}
              </p>
            </div>
            <Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}

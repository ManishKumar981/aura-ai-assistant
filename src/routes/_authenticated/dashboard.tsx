import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Stethoscope, FileText, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — MediScribe AI" },
      { name: "description", content: "Your clinical dashboard: start a new consultation and review recent encounters." },
      { property: "og:title", content: "Dashboard — MediScribe AI" },
      { property: "og:description", content: "Start consultations and review recent encounters." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const profile = useQuery({
    queryKey: ["profile", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const consultations = useQuery({
    queryKey: ["consultations", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultations")
        .select("id, title, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const startConsultation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("consultations")
        .insert({ user_id: user.id, title: `Consultation ${new Date().toLocaleDateString()}` })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      navigate({ to: "/assistant", search: { consultation: data.id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const displayName = profile.data?.full_name || user.email?.split("@")[0] || "Clinician";

  return (
    <div className="space-y-8">
      <section className="clinical-panel overflow-hidden">
        <div className="flex flex-col gap-6 p-8 md:flex-row md:items-center md:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3">Clinical console</Badge>
            <h1 className="text-3xl font-semibold">Welcome back, {displayName}</h1>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">
              Capture a patient encounter by voice or text, then let the assistant structure it into an AI-generated clinical summary with a downloadable PDF report.
            </p>
          </div>
          <Button size="lg" onClick={() => startConsultation.mutate()} disabled={startConsultation.isPending}>
            <Plus className="size-4" />
            {startConsultation.isPending ? "Starting…" : "Start new consultation"}
          </Button>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="clinical-panel p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent consultations</h2>
            <Link to="/history" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>

          <div className="mt-4 space-y-2">
            {consultations.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {consultations.data?.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <Stethoscope className="mx-auto size-6 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">No consultations yet. Start your first one.</p>
              </div>
            )}
            {consultations.data?.map((c) => (
              <Link
                key={c.id}
                to="/assistant"
                search={{ consultation: c.id }}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3 transition-colors hover:bg-secondary"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    {new Date(c.created_at).toLocaleString()}
                  </p>
                </div>
                <Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge>
              </Link>
            ))}
          </div>
        </section>

        <section className="clinical-panel p-6">
          <h2 className="text-lg font-semibold">Profile</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">{profile.data?.full_name || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium break-all">{user.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Role</dt>
              <dd className="font-medium capitalize">{profile.data?.role || "clinician"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Specialty</dt>
              <dd className="font-medium">{profile.data?.specialty || "Not set"}</dd>
            </div>
          </dl>
          <Button asChild variant="outline" className="mt-5 w-full">
            <Link to="/profile">
              <FileText className="size-4" /> Edit profile
            </Link>
          </Button>
        </section>
      </div>
    </div>
  );
}

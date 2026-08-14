import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Mic, Send, Square, Bot, User as UserIcon, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type AssistantSearch = { consultation?: string };

export const Route = createFileRoute("/_authenticated/assistant")({
  validateSearch: (search: Record<string, unknown>): AssistantSearch =>
    typeof search['consultation'] === "string" ? { consultation: search['consultation'] } : {},
  head: () => ({
    meta: [
      { title: "AI Doctor consultation — MediScribe AI" },
      { name: "description", content: "Run a guided consultation with the AI Doctor assistant and capture the transcript." },
      { property: "og:title", content: "AI Doctor consultation — MediScribe AI" },
      { property: "og:description", content: "Guided consultation workspace with transcript capture." },
    ],
  }),
  component: AssistantPage,
});

const ROLE_META = {
  PATIENT: { label: "Patient", icon: UserIcon },
  AI_DOCTOR: { label: "AI Doctor", icon: Bot },
  SYSTEM: { label: "System", icon: Info },
} as const;

function AssistantPage() {
  const { consultation: consultationId } = Route.useSearch();
  const navigate = useNavigate();

  const consultation = useQuery({
    queryKey: ["consultation", consultationId],
    enabled: Boolean(consultationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultations")
        .select("id, title, status")
        .eq("id", consultationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const messages = useQuery({
    queryKey: ["messages", consultationId],
    enabled: Boolean(consultationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, timestamp")
        .eq("consultation_id", consultationId!)
        .order("timestamp", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  async function endConsultation() {
    if (!consultationId) return;
    const { error } = await supabase
      .from("consultations")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", consultationId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Consultation ended");
    navigate({ to: "/history" });
  }

  const disabled = !consultationId;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{consultation.data?.title ?? "AI Doctor"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {disabled
              ? "Start a consultation from the dashboard to begin capturing an encounter."
              : "Voice capture and clinical reasoning arrive in the next phase."}
          </p>
        </div>
        {consultation.data && <Badge variant="secondary">{consultation.data.status}</Badge>}
      </header>

      <section className="clinical-panel flex min-h-[28rem] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {!disabled && messages.data?.length === 0 && (
            <div className="flex h-full min-h-[18rem] flex-col items-center justify-center text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Bot className="size-5" />
              </span>
              <p className="mt-3 text-sm font-medium">Conversation area</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Patient, AI Doctor and system turns will stream here once the assistant is connected.
              </p>
            </div>
          )}

          {disabled && (
            <div className="flex h-full min-h-[18rem] items-center justify-center">
              <p className="text-sm text-muted-foreground">No active consultation selected.</p>
            </div>
          )}

          {messages.data?.map((m) => {
            const meta = ROLE_META[m.role as keyof typeof ROLE_META] ?? ROLE_META.SYSTEM;
            return (
              <div key={m.id} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <meta.icon className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {meta.label} · {new Date(m.timestamp).toLocaleTimeString()}
                  </p>
                  <p className="mt-1 text-sm">{m.content}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-border p-4">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" disabled title="Voice capture coming soon">
              <Mic className="size-4" />
            </Button>
            <Input placeholder="Describe the symptoms…" disabled />
            <Button type="button" size="icon" disabled title="Sending coming soon">
              <Send className="size-4" />
            </Button>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Input, microphone and AI replies are placeholders in this build.</p>
            <Button type="button" variant="destructive" size="sm" onClick={endConsultation} disabled={disabled || consultation.data?.status !== "active"}>
              <Square className="size-4" /> End consultation
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

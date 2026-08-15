import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Square, Bot, User as UserIcon, Info, ShieldAlert, Loader2, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { sendPatientMessage, getAiDoctorStatus } from "@/lib/ai-doctor.functions";
import { finalizeConsultation } from "@/lib/consultation.functions";
import { useVoiceConversation, type VoiceState } from "@/hooks/use-voice-conversation";
import { deriveConsultationState, STAGE_LABELS, CONSULTATION_STAGES } from "@/lib/consultation-engine";


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

const VOICE_STATE_META: Record<VoiceState, { label: string; hint: string; tone: string }> = {
  IDLE: { label: "Idle", hint: "Tap the microphone to speak.", tone: "bg-muted text-muted-foreground" },
  LISTENING: { label: "Listening", hint: "Listening — speak now, then pause.", tone: "bg-primary text-primary-foreground" },
  PROCESSING: { label: "Processing", hint: "Sending your words to the AI Doctor…", tone: "bg-secondary text-secondary-foreground" },
  SPEAKING: { label: "Speaking", hint: "AI Doctor is speaking.", tone: "bg-accent text-accent-foreground" },
  ENDED: { label: "Ended", hint: "Voice session ended.", tone: "bg-muted text-muted-foreground" },
  ERROR: { label: "Error", hint: "Voice unavailable — use the text box.", tone: "bg-destructive text-destructive-foreground" },
};

const ROLE_META = {
  PATIENT: { label: "Patient", icon: UserIcon },
  AI_DOCTOR: { label: "AI Doctor", icon: Bot },
  SYSTEM: { label: "System", icon: Info },
} as const;

function AssistantPage() {
  const { consultation: consultationId } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const send = useServerFn(sendPatientMessage);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const status = useQuery({ queryKey: ["ai-doctor-status"], queryFn: () => getAiDoctorStatus() });

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.data?.length, pending]);

  const finalize = useServerFn(finalizeConsultation);
  const [ending, setEnding] = useState(false);

  async function endConsultation() {
    if (!consultationId || ending) return;
    setEnding(true);
    // 1 + 2: stop voice input and AI speech immediately.
    voiceRef.current.endSession();
    try {
      const result = await finalize({ data: { consultationId } });
      toast.success(`Consultation completed — ${result.turns} turns preserved, ${result.points} points extracted.`);
      await queryClient.invalidateQueries({ queryKey: ["consultations", "all"] });
      navigate({ to: "/consultation/$id", params: { id: consultationId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not finish the consultation.");
    } finally {
      setEnding(false);
    }
  }

  const voice = useVoiceConversation({
    onTranscript: (text) => {
      void sendMessage(text, true);
    },
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  async function sendMessage(content: string, spoken = false) {
    const text = content.trim();
    if (!text || !consultationId || pending) return;
    setPending(true);
    if (!spoken) setDraft("");
    try {
      const result = await send({ data: { consultationId, content: text } });
      await queryClient.invalidateQueries({ queryKey: ["messages", consultationId] });
      if (spoken || voiceRef.current.autoMode) {
        voiceRef.current.speak(result.doctorMessage.content);
      }
    } catch (error) {
      // The patient turn may already be persisted (the AI reply is what failed) —
      // refetch so the transcript stays accurate and the user doesn't resend a duplicate.
      await queryClient.invalidateQueries({ queryKey: ["messages", consultationId] });
      voiceRef.current.setVoiceState("ERROR");
      toast.error(error instanceof Error ? error.message : "Could not reach the AI Doctor.");
    } finally {
      setPending(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await sendMessage(draft);
  }

  const disabled = !consultationId;
  // Only treat the consultation as ended once we actually have its row — while the
  // query is loading `consultation.data` is undefined, which used to disable input.
  const ended = Boolean(consultation.data) && consultation.data?.status !== "active";
  const loadingConsultation = Boolean(consultationId) && consultation.isPending;

  const engine = deriveConsultationState(messages.data ?? []);
  const activeStageIndex = CONSULTATION_STAGES.indexOf(engine.stage);



  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{consultation.data?.title ?? "AI Doctor"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {disabled
              ? "Start a consultation from the dashboard to begin capturing an encounter."
              : "Describe the symptoms in plain language — the AI Doctor will take a structured history."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.data?.demo && <Badge variant="outline">Demo mode</Badge>}
          {consultation.data && <Badge variant="secondary">{consultation.data.status}</Badge>}
        </div>
      </header>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/60 p-4">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Medical disclaimer:</span> the AI Doctor is an information
          assistant, not a licensed clinician. It does not provide a confirmed diagnosis and does not prescribe
          medication. Always have a qualified clinician review this conversation, and seek emergency care immediately
          for severe or worsening symptoms.
        </p>
      </div>

      <section className="clinical-panel flex min-h-[28rem] flex-col">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-6">
          {!disabled && messages.data?.length === 0 && (
            <div className="flex h-full min-h-[18rem] flex-col items-center justify-center text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Bot className="size-5" />
              </span>
              <p className="mt-3 text-sm font-medium">Start the conversation</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Describe the presenting complaint — the assistant will ask about duration, severity and warning signs.
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
                  <p className="mt-1 whitespace-pre-wrap text-sm">{m.content}</p>
                </div>
              </div>
            );
          })}

          {pending && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                <Bot className="size-4" />
              </span>
              <span className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" /> AI Doctor is thinking…
              </span>
            </div>
          )}
        </div>

        <div className="border-t border-border p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge className={VOICE_STATE_META[voice.state].tone}>{VOICE_STATE_META[voice.state].label}</Badge>
            <span className="text-xs text-muted-foreground">{VOICE_STATE_META[voice.state].hint}</span>
            {!voice.supported && (
              <span className="text-xs text-muted-foreground">
                Speech recognition unavailable in this browser — text input is used instead.
              </span>
            )}
          </div>

          {(voice.transcript || voice.error) && (
            <div className="mb-3 rounded-md border border-border bg-muted/50 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">
                {voice.error ? "Voice error" : "Transcript preview"}
              </p>
              <p className="mt-1 text-sm">{voice.error ?? voice.transcript}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={voice.state === "LISTENING" ? "default" : "outline"}
              size="icon"
              title={voice.state === "LISTENING" ? "Stop listening" : "Start speaking"}
              aria-label={voice.state === "LISTENING" ? "Stop listening" : "Start speaking"}
              disabled={disabled || ended || pending || loadingConsultation || !voice.supported}
              onClick={() => {
                if (voice.state === "LISTENING") {
                  voice.stopListening();
                } else {
                  voice.reset();
                  voice.setAutoMode(true);
                  voice.startListening();
                }
              }}
            >
              {voice.state === "LISTENING" ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="icon"
              title={voice.muted ? "Unmute AI voice" : "Mute AI voice"}
              aria-label={voice.muted ? "Unmute AI voice" : "Mute AI voice"}
              onClick={() => voice.setMuted(!voice.muted)}
            >
              {voice.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                voice.setAutoMode(false);
                voice.stopSpeaking();
                voice.cancelListening();
              }}
              disabled={voice.state !== "SPEAKING" && voice.state !== "LISTENING"}
            >
              Stop speaking
            </Button>

            <form onSubmit={submit} className="flex min-w-[16rem] flex-1 items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  ended ? "This consultation has ended." : loadingConsultation ? "Loading consultation…" : "Type the symptoms…"
                }
                disabled={disabled || ended || pending}
              />
              <Button
                type="submit"
                size="icon"
                disabled={disabled || ended || pending || loadingConsultation || !draft.trim()}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </form>

          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {status.data?.demo
                ? "Demo mode: scripted history-taking replies, no external AI provider is called."
                : "Responses are generated server-side; nothing is sent from your browser to the AI provider."}
            </p>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={endConsultation}
              disabled={disabled || ended || ending}
            >
              {ending ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
              {ending ? "Finalising…" : "End consultation"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

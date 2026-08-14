import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Mic, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MediScribe AI — Voice Consultations & Clinical Notes" },
      {
        name: "description",
        content: "MediScribe AI captures medical consultations and turns them into structured, reviewable clinical notes for clinicians.",
      },
      { property: "og:title", content: "MediScribe AI — Voice Consultations & Clinical Notes" },
      { property: "og:description", content: "Capture consultations and generate structured clinical notes." },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  { icon: Mic, title: "Voice-first encounters", body: "Capture the consultation as it happens instead of typing during the visit." },
  { icon: FileText, title: "Structured notes", body: "Turns each encounter into a reviewable subjective, objective, assessment and plan." },
  { icon: ShieldCheck, title: "Private by default", body: "Row-level security means every record is scoped to the clinician who created it." },
];

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="size-4" />
          </span>
          <span className="font-display text-sm font-semibold">MediScribe AI</span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/register">Get started</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4">
        <section className="py-20 text-center md:py-28">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Clinical documentation</p>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold md:text-6xl">
            Consultations in, clinical notes out.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
            A focused workspace for capturing patient encounters and generating structured clinical documentation — without the after-hours paperwork.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/register">Create your account</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 pb-24 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="clinical-panel p-6">
              <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <f.icon className="size-5" />
              </span>
              <h2 className="mt-4 text-base font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        MediScribe AI · Foundation build. Not for clinical decision-making.
      </footer>
    </div>
  );
}

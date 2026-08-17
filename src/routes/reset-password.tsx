import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password — MediScribe AI" },
      { name: "description", content: "Choose a new password for your MediScribe AI clinical console account." },
      { property: "og:title", content: "Set a new password — MediScribe AI" },
      { property: "og:description", content: "Choose a new password for your clinical console account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) setReady(true);
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="size-4" />
          </span>
          <span className="font-display text-base font-semibold">MediScribe AI</span>
        </Link>

        <div className="clinical-panel p-8">
          <h1 className="text-2xl font-semibold">Set a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ready ? "Choose a password of at least 8 characters." : "Open this page from the reset link in your email."}
          </p>

          {ready && (
            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            <Link to="/login" className="font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

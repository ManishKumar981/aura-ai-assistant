import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/voice-transcription")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { transcribeVoiceRequest } = await import("@/lib/voice-transcription.server");
        return transcribeVoiceRequest(request);
      },
    },
  },
});

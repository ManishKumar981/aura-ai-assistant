const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MIN_AUDIO_BYTES = 2048;
const ACCEPTED_AUDIO_TYPES = new Set(["audio/wav", "audio/wave", "audio/x-wav"]);

async function isAuthenticated(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  const backendUrl = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!authorization?.startsWith("Bearer ") || !backendUrl || !publishableKey) return false;
  const response = await fetch(`${backendUrl}/auth/v1/user`, { headers: { apikey: publishableKey, Authorization: authorization } });
  return response.ok;
}

export async function transcribeVoiceRequest(request: Request): Promise<Response> {
  if (!(await isAuthenticated(request))) return new Response("Unauthorized", { status: 401 });
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) return new Response("Expected a multipart audio upload.", { status: 400 });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_AUDIO_BYTES + 64 * 1024) return new Response("The recording is too large to transcribe.", { status: 413 });

  const body = await request.formData();
  const audio = body.get("audio");
  if (!(audio instanceof File) || audio.size < MIN_AUDIO_BYTES) return new Response("That recording was empty. Please try again.", { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return new Response("The recording is too large to transcribe.", { status: 413 });
  if (!ACCEPTED_AUDIO_TYPES.has(audio.type.toLowerCase())) return new Response("Only complete WAV recordings are accepted.", { status: 415 });

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return new Response("Voice transcription is not configured.", { status: 503 });
  const upstreamBody = new FormData();
  upstreamBody.append("model", "openai/gpt-4o-mini-transcribe");
  upstreamBody.append("file", audio, "recording.wav");
  upstreamBody.append("stream", "true");
  const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: upstreamBody,
  });
  if (!upstream.ok) {
    const message = await upstream.text().catch(() => "Transcription failed.");
    return new Response(message || "Transcription failed.", { status: upstream.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(upstream.body, { headers: { "content-type": upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
}

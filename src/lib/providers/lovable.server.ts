/**
 * Lovable AI Gateway implementation of the AIProvider / STTProvider interfaces.
 * This is one interchangeable provider — nothing outside this file talks to the
 * gateway directly.
 */

import {
  ProviderError,
  type AIProvider,
  type GenerateRequest,
  type GenerateResult,
  type STTProvider,
  type TranscribeRequest,
  type TranscribeResult,
} from "./types";

const DEFAULT_BASE_URL = "https://ai.gateway.lovable.dev/v1";
const DEFAULT_CHAT_MODEL = "google/gemini-3.5-flash";
const DEFAULT_STT_MODEL = "openai/gpt-4o-mini-transcribe";

export type OpenAICompatibleOptions = {
  id: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Gateway also accepts the Lovable-API-Key header. */
  sendLovableHeader?: boolean;
};

/**
 * Generic OpenAI-compatible chat provider. The Lovable gateway, a local
 * llama.cpp / Ollama-compatible server, or any hosted OpenAI-style endpoint all
 * speak this protocol, so a future local provider can reuse this class.
 */
export class OpenAICompatibleAIProvider implements AIProvider {
  readonly isDemo = false;
  constructor(private readonly options: OpenAICompatibleOptions) {}

  get id() {
    return this.options.id;
  }
  get model() {
    return this.options.model;
  }

  async generateResponse(request: GenerateRequest): Promise<GenerateResult> {
    const { apiKey, baseUrl, model, sendLovableHeader } = this.options;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      if (sendLovableHeader) headers["Lovable-API-Key"] = apiKey;
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        ...(request.json ? { response_format: { type: "json_object" } } : {}),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        messages: [
          ...(request.system ? [{ role: "system", content: request.system }] : []),
          ...request.messages,
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("AI provider error", this.id, res.status, detail);
      if (res.status === 429)
        throw new ProviderError("The AI Doctor is rate limited right now. Please try again in a moment.", 429);
      if (res.status === 402)
        throw new ProviderError("AI credits are exhausted. Add credits to continue the consultation.", 402);
      throw new ProviderError("The AI Doctor is unavailable right now. Please try again.", res.status);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new ProviderError("The AI Doctor returned an empty response. Please try again.");
    return { content, model };
  }
}

export function createLovableAIProvider(): AIProvider | null {
  const apiKey = process.env["AI_API_KEY"] ?? process.env["AI_DOCTOR_API_KEY"] ?? process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;
  return new OpenAICompatibleAIProvider({
    id: "lovable",
    apiKey,
    baseUrl: process.env["AI_BASE_URL"] ?? process.env["AI_DOCTOR_BASE_URL"] ?? DEFAULT_BASE_URL,
    model: process.env["AI_MODEL"] ?? process.env["AI_DOCTOR_MODEL"] ?? DEFAULT_CHAT_MODEL,
    sendLovableHeader: true,
  });
}

/**
 * Generic OpenAI-compatible `/audio/transcriptions` STT provider. Streams the
 * upstream SSE body straight back to the browser.
 */
export class OpenAICompatibleSTTProvider implements STTProvider {
  readonly configured = true;
  constructor(
    readonly id: string,
    private readonly options: { apiKey: string; baseUrl: string; model: string; stream?: boolean },
  ) {}

  async transcribe({ audio, language }: TranscribeRequest): Promise<TranscribeResult> {
    const { apiKey, baseUrl, model, stream = true } = this.options;
    const body = new FormData();
    body.append("model", model);
    body.append("file", audio, "recording.wav");
    if (language) body.append("language", language);
    if (stream) body.append("stream", "true");

    const upstream = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body,
    });

    if (!upstream.ok || !upstream.body) {
      const message = await upstream.text().catch(() => "Transcription failed.");
      throw new ProviderError(message || "Transcription failed.", upstream.status || 502);
    }

    return {
      kind: "stream",
      body: upstream.body,
      contentType: upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
    };
  }
}

export function createLovableSTTProvider(): STTProvider | null {
  const apiKey = process.env["STT_API_KEY"] ?? process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;
  return new OpenAICompatibleSTTProvider("lovable", {
    apiKey,
    baseUrl: process.env["STT_BASE_URL"] ?? DEFAULT_BASE_URL,
    model: process.env["STT_MODEL"] ?? DEFAULT_STT_MODEL,
    stream: (process.env["STT_STREAM"] ?? "true").toLowerCase() !== "false",
  });
}

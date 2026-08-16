/**
 * Provider-independent AI + speech interfaces.
 *
 * The consultation engine, AI Doctor and extraction pipeline depend ONLY on
 * these interfaces. Swapping the Lovable AI Gateway for a local model (or any
 * other backend) means adding a new implementation and pointing the
 * AI_PROVIDER / STT_PROVIDER environment variables at it — no application
 * code changes.
 */

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = { role: ChatRole; content: string };

export type GenerateRequest = {
  /** System prompt (already composed by the caller). */
  system?: string;
  messages: ChatMessage[];
  /** Ask the provider for a strict JSON object response when supported. */
  json?: boolean;
  temperature?: number;
};

export type GenerateResult = {
  content: string;
  /** Identifier used for audit fields such as `generated_by`. */
  model: string;
};

export interface AIProvider {
  /** Stable provider id, e.g. "lovable", "demo", "local". */
  readonly id: string;
  /** True when no real model is reachable and deterministic canned logic must be used. */
  readonly isDemo: boolean;
  /** Model identifier this provider will use. */
  readonly model: string;
  generateResponse(request: GenerateRequest): Promise<GenerateResult>;
}

export type TranscribeRequest = {
  /** Complete, decodable audio file (the app always uploads WAV). */
  audio: File;
  /** Optional ISO-639-1 hint. */
  language?: string;
};

export type TranscribeResult =
  | { kind: "stream"; body: ReadableStream<Uint8Array>; contentType: string }
  | { kind: "text"; text: string };

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number = 502,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface STTProvider {
  readonly id: string;
  /** False when the provider cannot run (missing configuration). */
  readonly configured: boolean;
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
}

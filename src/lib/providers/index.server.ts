/**
 * Provider registry / configuration.
 *
 * AI_PROVIDER  = lovable | openai-compatible | demo   (default: lovable, else demo)
 * STT_PROVIDER = lovable | openai-compatible | none   (default: lovable)
 *
 * To move off Lovable later: set AI_PROVIDER=openai-compatible with
 * AI_BASE_URL / AI_MODEL / AI_API_KEY pointing at a local server, and
 * STT_PROVIDER=openai-compatible with STT_BASE_URL / STT_MODEL. No other file
 * in the application changes.
 */

import { DemoAIProvider } from "./demo.server";
import {
  OpenAICompatibleAIProvider,
  OpenAICompatibleSTTProvider,
  createLovableAIProvider,
  createLovableSTTProvider,
} from "./lovable.server";
import type { AIProvider, STTProvider } from "./types";

function envName(key: string): string {
  return (process.env[key] ?? "").trim().toLowerCase();
}

export function getAIProvider(): AIProvider {
  const mode = envName("AI_DOCTOR_MODE");
  const requested = envName("AI_PROVIDER") || (mode === "demo" ? "demo" : "");

  if (requested === "demo" || mode === "demo") return new DemoAIProvider();

  if (requested === "openai-compatible" || requested === "local") {
    const baseUrl = process.env["AI_BASE_URL"] ?? process.env["AI_DOCTOR_BASE_URL"];
    const model = process.env["AI_MODEL"] ?? process.env["AI_DOCTOR_MODEL"];
    if (baseUrl && model) {
      return new OpenAICompatibleAIProvider({
        id: requested,
        apiKey: process.env["AI_API_KEY"] ?? process.env["AI_DOCTOR_API_KEY"] ?? "",
        baseUrl,
        model,
      });
    }
    console.warn("AI_PROVIDER set but AI_BASE_URL/AI_MODEL missing — falling back to demo mode.");
    return new DemoAIProvider();
  }

  return createLovableAIProvider() ?? new DemoAIProvider();
}

export function getSTTProvider(): STTProvider | null {
  const requested = envName("STT_PROVIDER");
  if (requested === "none") return null;

  if (requested === "openai-compatible" || requested === "local") {
    const baseUrl = process.env["STT_BASE_URL"];
    const model = process.env["STT_MODEL"];
    if (!baseUrl || !model) {
      console.warn("STT_PROVIDER set but STT_BASE_URL/STT_MODEL missing — transcription disabled.");
      return null;
    }
    return new OpenAICompatibleSTTProvider(requested, {
      apiKey: process.env["STT_API_KEY"] ?? "",
      baseUrl,
      model,
      stream: (process.env["STT_STREAM"] ?? "true").toLowerCase() !== "false",
    });
  }

  return createLovableSTTProvider();
}

export type { AIProvider, STTProvider } from "./types";
export { ProviderError } from "./types";

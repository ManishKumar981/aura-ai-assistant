/**
 * Demo AI provider: used when no provider is configured or AI_PROVIDER=demo.
 * Callers that own richer deterministic logic (the AI Doctor's state machine,
 * the rules-based extractor) check `isDemo` and use their own fallback.
 */

import type { AIProvider, GenerateRequest, GenerateResult } from "./types";

export class DemoAIProvider implements AIProvider {
  readonly id = "demo";
  readonly isDemo = true;
  readonly model = "demo";

  async generateResponse(_request: GenerateRequest): Promise<GenerateResult> {
    return {
      content:
        "Demo mode is active, so no AI model was called. Configure an AI provider to enable live responses.",
      model: this.model,
    };
  }
}

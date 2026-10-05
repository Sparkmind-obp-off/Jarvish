import type { LLMProvider, LLMRequest, LLMResponse } from "./index.js";

export class ProviderRouter {
  constructor(private readonly providers: LLMProvider[]) {}

  async generate(request: LLMRequest): Promise<LLMResponse> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await provider.generate(request);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`No LLM provider available: ${String(lastError)}`);
  }
}
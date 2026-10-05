import {
  RuntimeError,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from "./index.js";
export class ProviderRouter {
  constructor(private readonly providers: LLMProvider[]) {}
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const failures: string[] = [];
    for (const provider of this.providers) {
      const start = Date.now();
      try {
        const result = await provider.generate(request);
        if (
          !result ||
          typeof result.content !== "string" ||
          !result.content.trim() ||
          !result.provider ||
          !result.model
        ) {
          throw new RuntimeError(
            "MALFORMED_RESPONSE",
            "Provider returned an invalid response",
          );
        }
        console.log(
          JSON.stringify({
            event: "provider",
            provider: provider.id,
            status: "ok",
            latency: Date.now() - start,
          }),
        );
        return result;
      } catch (error) {
        const code =
          error instanceof RuntimeError ? error.code : "PROVIDER_ERROR";
        failures.push(`${provider.id}:${code}`);
        console.log(
          JSON.stringify({
            event: "provider",
            provider: provider.id,
            status: "failed",
            code,
            latency: Date.now() - start,
          }),
        );
      }
    }
    throw new RuntimeError(
      "NO_PROVIDER",
      `No LLM provider available (${failures.join(", ")})`,
      true,
    );
  }
}

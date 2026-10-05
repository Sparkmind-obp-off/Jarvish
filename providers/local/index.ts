import {
  RuntimeError,
  type LLMProvider,
  type LLMRequest,
} from "../../core/src/index.js";
// A Cloudflare Worker cannot execute Ollama/llama.cpp binaries. No simulated inference.
export class UnavailableLocalProvider implements LLMProvider {
  readonly id = "local";
  readonly name = "local";
  readonly capabilities: string[] = [];
  async health() {
    return {
      available: false,
      reason: "Local inference runtime is not connected",
    };
  }
  async generate(_request: LLMRequest): Promise<never> {
    throw new RuntimeError(
      "NOT_CONFIGURED",
      "Local inference runtime is not connected",
    );
  }
}
